import {
    ConnectedSocket,
    MessageBody,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import {
    UseGuards,
    UseFilters,
    UsePipes,
    ValidationPipe,
} from '@nestjs/common';
import { Server } from 'socket.io';
import { MessageService } from '../services/message.service';
import { MessageForwardService } from '../services/message-forward.service';
import { ForwardMessagesDto } from '../dtos/forwardMessages.dto';
import { ChatService } from 'src/modules/chats/services/chat.service';
import { CreateMessageDto } from '../dtos/createMessage.dto';
import { Message } from '../entities/message.entity';
import { EditMessageDto } from '../dtos/EditMessage.dto';
import {
    DEFAULT_MESSAGES_PAGE_SIZE,
    GetMessagesDto,
} from '../dtos/getMessages.dto';
import { deleteMessageDto } from '../dtos/deleteMessage.dto';
import { SocketAuth } from 'src/common/types/SocketAuth.type';
import { wsPayload } from 'src/common/guards/wsGuards/wsPayload.guard';
import { wsIsMemberChat } from 'src/common/guards/wsGuards/wsIsmemberChat.guard';
import { wsIsBanMember } from 'src/common/guards/wsGuards/wsIsBanMember.guard';
import { WsExceptionFilter } from 'src/common/filters/ws-exception.filter';
import { ChatId } from 'src/common/types/brands.type';
import { chatRoom, userRoom } from 'src/common/utils/roomCreator.utils';
import {
    serializeLastMessage,
    serializeMessage,
} from 'src/common/utils/ws-serializer.utils';
import { num } from 'src/common/utils/ws-serializer.utils';

@WebSocketGateway({ maxHttpBufferSize: 1e6 })
@UseGuards(wsPayload, wsIsBanMember)
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseFilters(new WsExceptionFilter())
export class MessageGateway {
    @WebSocketServer()
    private server: Server;

    constructor(
        private readonly messageService: MessageService,
        private readonly forwardService: MessageForwardService,
        private readonly chatService: ChatService,
    ) {}

    @SubscribeMessage('sendMessage')
    async sendMessage(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: CreateMessageDto,
    ) {
        const message = await this.messageService.create(client.data.user, dto);
        const chatId = message.chat?.id ?? dto.chatId;
        const wireMessage = serializeMessage(message);

        this.server.to(chatRoom(chatId)).emit('sendMessage:list', wireMessage);
        // The socket may legitimately not be in the room (stale leave, reconnect
        // before re-join); the ack alone cannot confirm the optimistic bubble, so
        // deliver the echo straight to the sender in that case.
        if (!client.rooms.has(chatRoom(chatId))) {
            client.emit('sendMessage:list', wireMessage);
        }
        void this.notifyChatList(chatId, message).catch((): void => undefined);

        return { ok: true, data: wireMessage };
    }

    @SubscribeMessage('forwardMessages')
    @UseGuards(wsIsMemberChat)
    async forwardMessages(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: ForwardMessagesDto,
    ) {
        const execution = await this.forwardService.forward(
            client.data.user,
            dto,
        );

        // Broadcast only fresh successes; an idempotent replay stored the ack
        // result and must never create or announce the messages twice.
        for (const target of execution.targets) {
            for (const message of target.messages) {
                const wireMessage = serializeMessage(message);
                this.server
                    .to(chatRoom(target.chatId as ChatId))
                    .emit('sendMessage:list', wireMessage);
                if (!client.rooms.has(chatRoom(target.chatId as ChatId))) {
                    client.emit('sendMessage:list', wireMessage);
                }
            }
            const last = target.messages[target.messages.length - 1];
            if (last !== undefined) {
                void this.notifyChatList(target.chatId as ChatId, last).catch(
                    (): void => undefined,
                );
            }
        }

        return { ok: true, data: execution.data };
    }

    @SubscribeMessage('editMessage')
    @UseGuards(wsIsMemberChat)
    async editMessage(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: EditMessageDto,
    ) {
        const message = await this.messageService.edit(dto, client.data.user);
        const wireMessage = serializeMessage(message);

        this.server
            .to(chatRoom(dto.chatId))
            .emit('editMessage:list', wireMessage);
        if (!client.rooms.has(chatRoom(dto.chatId))) {
            client.emit('editMessage:list', wireMessage);
        }
        void this.notifyChatList(dto.chatId, message).catch((error) =>
            console.error('notifyChatList failed', error),
        );

        return { ok: true, data: wireMessage };
    }

    @SubscribeMessage('deleteMessage')
    @UseGuards(wsIsMemberChat)
    async deleteMessage(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: deleteMessageDto,
    ) {
        await this.messageService.delete(dto, client.data.user);

        this.server
            .to(chatRoom(dto.chatId))
            .emit('deleteMessage:list', num(dto.messageId));

        // The deleted message may have been the chat's last one: push the new
        // last message (or null) so previews never keep the deleted text.
        const lastMessage = await this.messageService.lastNonDeletedMessage(
            dto.chatId,
        );
        void this.notifyChatList(dto.chatId, lastMessage).catch((error) =>
            console.error('notifyChatList failed', error),
        );

        return { ok: true, data: null };
    }

    @SubscribeMessage('getMessages')
    @UseGuards(wsIsMemberChat)
    async getMessages(@MessageBody() dto: GetMessagesDto) {
        const page = await this.messageService.getPage(
            dto.chatId,
            dto.beforeId,
            dto.limit ?? DEFAULT_MESSAGES_PAGE_SIZE,
        );

        return {
            ok: true,
            data: {
                // Newest first WITHIN the page, exactly like the old ack.
                messages: page.messages.map(serializeMessage),
                hasMore: page.hasMore,
                // Id of the OLDEST message in this page; null when empty.
                nextCursor: page.nextCursor,
            },
        };
    }

    private async notifyChatList(chatId: ChatId, message: Message | null) {
        const memberIds = await this.chatService.getMemberIds(chatId);
        // Attachment-only messages have no text; their metadata is included
        // so chat-list previews can still show something meaningful. A null
        // message (e.g. the last message was just deleted) clears the preview.
        // Reuse the exact serializer `getAllChats` uses, so both sources
        // produce an identical preview shape.
        const payload = {
            chatId: num(chatId),
            lastMessage:
                message === null ? null : serializeLastMessage(message),
        };

        // A member can be registered twice in chat_members; one update each.
        for (const id of new Set(memberIds)) {
            this.server.to(userRoom(id)).emit('chatlist:updated', payload);
        }
    }
}
