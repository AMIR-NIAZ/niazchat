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
import { UserBlockService } from '../services/user-block.service';
import { PrivateChatService } from '../services/private-chat.service';
import { wsPayload } from 'src/common/guards/wsGuards/wsPayload.guard';
import { wsIsMemberChat } from 'src/common/guards/wsGuards/wsIsmemberChat.guard';
import { wsIsBanMember } from 'src/common/guards/wsGuards/wsIsBanMember.guard';
import { SocketAuth } from 'src/common/types/SocketAuth.type';
import { JwtPayload } from 'src/common/types/jwt-payload.type';
import { chatRoom, userRoom } from 'src/common/utils/roomCreator.utils';
import { ChatId, UserId } from 'src/common/types/brands.type';
import { Chat } from '../entities/chat.entity';
import { WsExceptionFilter } from 'src/common/filters/ws-exception.filter';
import { num, serializeChat } from 'src/common/utils/ws-serializer.utils';
import { MarkSeenDto } from '../dtos/markSeen.dto';
import { ChatActionDto } from '../dtos/chatAction.dto';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';

@WebSocketGateway()
@UseGuards(wsPayload)
@UseFilters(new WsExceptionFilter())
export class ChatGateway implements OnGatewayDisconnect, OnGatewayInit {
    constructor(
        private readonly chatService: ChatService,
        private readonly groupRealtime: GroupRealtimeService,
        private readonly userBlocks: UserBlockService,
        private readonly privateChats: PrivateChatService,
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
        const userId = client.data.user.sub;
        const chats = await this.chatService.getUserChats(client.data.user);

        // Private rows carry the caller's directional block state so the app
        // can offer Block or Unblock without an extra request. ONE query.
        const privateIds = chats
            .filter((chat) => chat.type === TypeChatEnum.PRIVATE)
            .map((chat) => chat.id);
        const blockStates = await this.userBlocks.getBlockStates(
            privateIds,
            userId,
        );

        // Serialized wire rows: numeric ids + lastMessage/preview in the exact
        // shape `chatlist:updated` emits.
        return {
            ok: true,
            data: chats.map((chat) => {
                const state = blockStates.get(String(chat.id));
                return {
                    ...serializeChat(chat),
                    ...(state === undefined
                        ? {}
                        : {
                              blockedByMe: state.blockedByMe,
                              blockedMe: state.blockedMe,
                          }),
                };
            }),
        };
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
        // Resolve everything that can fail BEFORE mutating room/state: a
        // rejected info query must leave this socket exactly as it was.
        // One entity load per join; typing later uses only the socket cache.
        const chat = await this.chatService.getInfoChat(chatId);
        const info = await this.chatInfo(chatId, user.sub, chat);
        const userName = await this.chatService.getUserDisplayName(user.sub);

        if (prev === chatId) {
            // Idempotent: ALWAYS re-add the room (a socket can keep
            // `data.chatId` while its room membership was lost), then refresh
            // the cached typing context and answer.
            await client.join(chatRoom(chatId));
            this.cacheChatContext(client, chat, userName);
            // Legacy per-client event, kept for compatibility; the ack is the
            // completion signal.
            client.emit('chatInfo', info);
            return { ok: true, data: info };
        }
        if (prev) await this.leaveCurrentChat(client);

        // State is committed only after the membership exists, so a failure at
        // any point leaves the socket in NO chat instead of claiming a room it
        // is not in (private and group take the same path).
        await client.join(chatRoom(chatId));
        client.data.chatId = chatId;
        this.cacheChatContext(client, chat, userName);

        // Joining no longer marks everything read: the app calls `markSeen`
        // only while the chat is focused, foregrounded and near the bottom.
        // The online count is advisory and can never fail the join.
        await this.emitOnlineCount(chatId);

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
        // Private chat info carries the other participant (presence included)
        // and the caller's directional block state (drives the composer/UI).
        const peer = await this.chatService.getPeerForChat(chatId, userId);
        const blockState =
            peer === null
                ? null
                : await this.userBlocks.getBlockState(chatId, userId);
        return {
            ...info,
            peer,
            ...(blockState === null
                ? {}
                : {
                      blockedByMe: blockState.blockedByMe,
                      blockedMe: blockState.blockedMe,
                  }),
            ...summary,
            ...seen,
        };
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
     * Directional block of the private chat's other participant. Blocking does
     * not delete any history and is not symmetric; the ack carries the new
     * state, and every device of the CALLER is told so its UI updates. The
     * blocked user is never notified (no block/unblock events to their room).
     */
    @SubscribeMessage('blockUser')
    @UseGuards(wsIsMemberChat)
    @UsePipes(new ValidationPipe({ whitelist: true }))
    async blockUser(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: ChatActionDto,
    ) {
        const userId = client.data.user.sub;
        const result = await this.userBlocks.block(dto.chatId, userId);

        this.server.to(userRoom(userId)).emit('chat:blocked', {
            chatId: result.chatId,
            blockedByMe: true,
            blockedMe: result.blockedMe,
            blocked: true,
        });
        return { ok: true, data: result };
    }

    @SubscribeMessage('unblockUser')
    @UseGuards(wsIsMemberChat)
    @UsePipes(new ValidationPipe({ whitelist: true }))
    async unblockUser(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: ChatActionDto,
    ) {
        const userId = client.data.user.sub;
        const result = await this.userBlocks.unblock(dto.chatId, userId);

        this.server.to(userRoom(userId)).emit('chat:blocked', {
            chatId: result.chatId,
            blockedByMe: false,
            blockedMe: result.blockedMe,
            blocked: result.blocked,
        });
        return { ok: true, data: result };
    }

    /**
     * "Delete chat for me": hides the conversation for the caller only. No
     * event reaches the other participant; the caller's own devices get
     * `chat:removed` so a second device drops the row too.
     */
    @SubscribeMessage('deleteChatForMe')
    @UseGuards(wsIsMemberChat)
    @UsePipes(new ValidationPipe({ whitelist: true }))
    async deleteChatForMe(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: ChatActionDto,
    ) {
        const userId = client.data.user.sub;
        const result = await this.privateChats.deleteForMe(dto.chatId, userId);

        this.server.to(userRoom(userId)).emit('chat:removed', {
            chatId: result.chatId,
            reason: 'deleted_for_me',
        });
        return { ok: true, data: result };
    }

    /**
     * "Delete chat for both": the chat row is gone for everybody. Both
     * participants are told through their personal rooms (offline users simply
     * get the already-deleted state from `getAllChats` on reconnect), and any
     * socket still in the chat room is kicked out of it.
     */
    @SubscribeMessage('deleteChatForBoth')
    @UseGuards(wsIsMemberChat)
    @UsePipes(new ValidationPipe({ whitelist: true }))
    async deleteChatForBoth(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: ChatActionDto,
    ) {
        const userId = client.data.user.sub;
        const result = await this.privateChats.deleteForBoth(
            dto.chatId,
            userId,
        );

        this.server.to(chatRoom(dto.chatId)).emit('chat:deleted', {
            chatId: result.chatId,
        });
        for (const memberId of result.memberIds) {
            this.server.to(userRoom(memberId as UserId)).emit('chat:deleted', {
                chatId: result.chatId,
            });
        }
        this.server.in(chatRoom(dto.chatId)).socketsLeave(chatRoom(dto.chatId));

        return { ok: true, data: result };
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
        // A blocked private conversation never shows typing either side.
        if (
            client.data.chatType === TypeChatEnum.PRIVATE &&
            (await this.userBlocks.isChatBlocked(chatId))
        ) {
            return;
        }

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
    private cacheChatContext(
        client: SocketAuth,
        chat: Chat | null,
        userName: string,
    ): void {
        client.data.chatType = chat?.type;
        client.data.userName = userName;
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

    /** Presence count is advisory: a failure must never fail join/leave. */
    private async emitOnlineCount(chatId: ChatId): Promise<void> {
        try {
            const sockets = await this.server
                .in(chatRoom(chatId))
                .fetchSockets();
            const count = new Set(
                sockets.map((s) => (s.data as SocketAuth['data']).user.sub),
            ).size;
            this.server.to(chatRoom(chatId)).emit('countUsersOnline', count);
        } catch {
            // Ignored: the next join/leave recomputes it.
        }
    }
}
