import {
    ConnectedSocket,
    MessageBody,
    OnGatewayDisconnect,
    OnGatewayInit,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import {
    UseFilters,
    UseGuards,
    UsePipes,
    ValidationPipe,
} from '@nestjs/common';
import { Server } from 'socket.io';
import { ChatService } from '../services/chat.service';
import { GroupRealtimeService } from '../services/group-realtime.service';
import { wsPayload } from 'src/common/guards/wsGuards/wsPayload.guard';
import { wsIsMemberChat } from 'src/common/guards/wsGuards/wsIsmemberChat.guard';
import { wsIsBanMember } from 'src/common/guards/wsGuards/wsIsBanMember.guard';
import { SocketAuth } from 'src/common/types/SocketAuth.type';
import { JwtPayload } from 'src/common/types/jwt-payload.type';
import { chatRoom, userRoom } from 'src/common/utils/roomCreator.utils';
import { ChatId } from 'src/common/types/brands.type';
import { Chat } from '../entities/chat.entity';
import { WsExceptionFilter } from 'src/common/filters/ws-exception.filter';
import { num, serializeChat } from 'src/common/utils/ws-serializer.utils';
import { MarkSeenDto } from '../dtos/markSeen.dto';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';

@WebSocketGateway()
@UseGuards(wsPayload)
@UseFilters(new WsExceptionFilter())
export class ChatGateway implements OnGatewayDisconnect, OnGatewayInit {
    constructor(
        private readonly chatService: ChatService,
        private readonly groupRealtime: GroupRealtimeService,
    ) {}

    /** REST-side group mutations fire room events through this server too. */
    afterInit(server: Server): void {
        this.groupRealtime.setServer(server);
    }

    @WebSocketServer()
    private server: Server;

    async handleDisconnect(client: SocketAuth) {
        const user = client.data.user;
        if (!user) return;

        const chatId = client.data.chatId;
        if (chatId) {
            // The disconnected socket can no longer send `userEndTyping`.
            this.server.to(chatRoom(chatId)).emit('typing:stop', {
                chatId: num(chatId),
                userId: num(user.sub),
                userName: client.data.userName ?? '',
            });
            await this.onChatLeft(chatId);
        }
    }

    @SubscribeMessage('getAllChats')
    async getAllChats(@ConnectedSocket() client: SocketAuth) {
        const chats = await this.chatService.getUserChats(client.data.user);

        // Serialized wire rows: numeric ids + lastMessage/preview in the exact
        // shape `chatlist:updated` emits.
        return { ok: true, data: chats.map(serializeChat) };
    }

    @SubscribeMessage('joinChat')
    @UseGuards(wsIsMemberChat)
    async joinChat(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: { chatId: ChatId },
    ) {
        const chatId = dto.chatId;
        const user = client.data.user;
        const prev = client.data.chatId;
        // One entity load per join; typing later uses only the socket cache.
        const chat = await this.chatService.getInfoChat(chatId);

        if (prev === chatId) {
            // Self-healing: a socket that kept `data.chatId` but lost the room
            // (server restart / reconnect) must be re-added before it expects
            // room broadcasts again.
            await client.join(chatRoom(chatId));
            await this.cacheChatContext(client, chat);
            const info = await this.chatInfo(chatId, user.sub, chat);
            // Legacy per-client event, kept for compatibility; the ack is the
            // completion signal.
            client.emit('chatInfo', info);
            return { ok: true, data: info };
        }
        if (prev) await this.leaveCurrentChat(client);

        await client.join(chatRoom(chatId));
        client.data.chatId = chatId;
        await this.cacheChatContext(client, chat);

        // Joining no longer marks everything read: the app calls `markSeen`
        // only while the chat is focused, foregrounded and near the bottom.
        await this.emitOnlineCount(chatId);

        const info = await this.chatInfo(chatId, user.sub, chat);
        client.emit('chatInfo', info);

        return { ok: true, data: info };
    }

    @SubscribeMessage('leaveChat')
    async leaveChat(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto?: { chatId?: ChatId },
    ) {
        const chatId = dto?.chatId;
        // A late/duplicate leave from a previously open chat must not remove
        // the user from the chat they just joined.
        if (typeof chatId === 'number' && client.data.chatId !== chatId) {
            return { ok: true };
        }
        await this.leaveCurrentChat(client);
        return { ok: true };
    }

    @SubscribeMessage('userTyping')
    typingStart(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: { chatId: ChatId },
    ) {
        void this.broadcastTyping(client, dto.chatId, 'typing:start').catch(
            () => undefined,
        );
        return { ok: true };
    }

    @SubscribeMessage('userEndTyping')
    typingStop(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: { chatId: ChatId },
    ) {
        void this.broadcastTyping(client, dto.chatId, 'typing:stop').catch(
            () => undefined,
        );
        return { ok: true };
    }

    /** Serialized chat + per-caller role/permission/count/seen extras. */
    private async chatInfo(
        chatId: ChatId,
        userId: JwtPayload['sub'],
        chat?: Chat | null,
    ) {
        const info = serializeChat(
            chat !== undefined && chat !== null
                ? chat
                : ((await this.chatService.getInfoChat(chatId)) as Chat),
        );
        const summary = await this.chatService.getChatSummary(chatId, userId);
        const seen = await this.chatService.getChatSeenState(chatId, userId);
        // Private chat info carries the other participant (presence included).
        const peer = await this.chatService.getPeerForChat(chatId, userId);
        return { ...info, peer, ...summary, ...seen };
    }

    /**
     * Advance the caller's read position. Monotonic; no-op calls emit nothing.
     * On a real change every member in the room learns the new position and the
     * caller's other devices get `chat:read` so they can clear the badge.
     */
    @SubscribeMessage('markSeen')
    @UseGuards(wsIsBanMember, wsIsMemberChat)
    @UsePipes(new ValidationPipe({ whitelist: true }))
    async markSeen(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: MarkSeenDto,
    ) {
        const userId = client.data.user.sub;
        const result = await this.chatService.markSeen(
            dto.chatId,
            userId,
            dto.lastSeenId,
        );

        if (result.changed) {
            this.server.to(chatRoom(dto.chatId)).emit('seen', {
                chatId: num(dto.chatId),
                userId: num(userId),
                lastSeenId: num(result.lastSeenId),
            });
            this.server.to(userRoom(userId)).emit('chat:read', {
                chatId: num(dto.chatId),
                unreadCount: 0,
            });
        }

        return { ok: true, data: { lastSeenId: num(result.lastSeenId) } };
    }

    /**
     * Group AND private chats, current room only, active (non-banned) members
     * only. A start is throttled to one per second per socket; stop is always
     * sent. Never throws to the caller (handlers swallow rejections).
     */
    private async broadcastTyping(
        client: SocketAuth,
        chatId: ChatId,
        event: 'typing:start' | 'typing:stop',
    ): Promise<void> {
        if (client.data.chatId !== chatId) return;
        if (
            client.data.chatType !== TypeChatEnum.GRUPE &&
            client.data.chatType !== TypeChatEnum.PRIVATE
        ) {
            return;
        }

        const userId = client.data.user?.sub;
        if (userId === undefined) return;
        if (!(await this.chatService.isActiveMember(chatId, userId))) return;

        if (event === 'typing:start') {
            const now = Date.now();
            if (
                client.data.typingChatId === chatId &&
                now - (client.data.typingAt ?? 0) < 1000
            ) {
                return;
            }
            client.data.typingChatId = chatId;
            client.data.typingAt = now;
        }

        client.to(chatRoom(chatId)).emit(event, {
            chatId: num(chatId),
            userId: num(userId),
            userName: client.data.userName ?? '',
        });
    }

    /** Cache display name/type once per join so typing never queries per event. */
    private async cacheChatContext(
        client: SocketAuth,
        chat: Chat | null,
    ): Promise<void> {
        client.data.chatType = chat?.type;
        client.data.userName = await this.chatService.getUserDisplayName(
            client.data.user.sub,
        );
        client.data.typingAt = undefined;
        client.data.typingChatId = undefined;
    }

    private async leaveCurrentChat(client: SocketAuth) {
        const chatId = client.data.chatId;
        if (!chatId) return;

        await client.leave(chatRoom(chatId));
        client.data.chatId = undefined;

        this.server.to(chatRoom(chatId)).emit('typing:stop', {
            chatId: num(chatId),
            userId: client.data.user.sub,
            userName: client.data.userName ?? '',
        });
        client.data.chatType = undefined;
        client.data.typingAt = undefined;
        client.data.typingChatId = undefined;
        await this.onChatLeft(chatId);
    }

    private async onChatLeft(chatId: ChatId) {
        await this.emitOnlineCount(chatId);
    }

    private async emitOnlineCount(chatId: ChatId) {
        const sockets = await this.server.in(chatRoom(chatId)).fetchSockets();
        const count = new Set(
            sockets.map((s) => (s.data as SocketAuth['data']).user.sub),
        ).size;
        this.server.to(chatRoom(chatId)).emit('countUsersOnline', count);
    }
}
