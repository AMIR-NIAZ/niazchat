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
import { PinMessageDto } from '../dtos/pinMessage.dto';
import { GetPinnedMessagesDto } from '../dtos/getPinnedMessages.dto';
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
import { ReactionsService } from 'src/modules/reactions/services/reactions.service';
import { VisibilityService } from 'src/modules/visibility/visibility.service';
import type { MessageReactionSummary } from 'src/modules/reactions/reaction.types';

/** A message serialized for one viewer (blockers' details hidden). */
function serializeMessageForViewer(
    message: Message,
    hiddenUserIds: ReadonlySet<number>,
    reactions: MessageReactionSummary[] = [],
) {
    return serializeMessage(message, reactions, undefined, { hiddenUserIds });
}

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
        private readonly reactions: ReactionsService,
        private readonly visibility: VisibilityService,
    ) {}

    @SubscribeMessage('sendMessage')
    async sendMessage(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: CreateMessageDto,
    ) {
        const message = await this.messageService.create(client.data.user, dto);
        const chatId = message.chat?.id ?? dto.chatId;

        // Per-viewer payloads: a sender who blocked a member is sanitized for
        // THAT member only (same for quoted/forwarded users).
        await this.emitChatMessage(chatId, 'sendMessage:list', message, client);
        void this.notifyChatList(chatId, message).catch((): void => undefined);

        return {
            ok: true,
            data: serializeMessageForViewer(
                message,
                await this.hiddenIdsForViewer(
                    Number(client.data.user.sub),
                    message,
                ),
            ),
        };
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
                await this.emitChatMessage(
                    target.chatId as ChatId,
                    'sendMessage:list',
                    message,
                    client,
                );
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
        // An edit echo must carry the current chips, otherwise editing wipes them.
        const summaries = await this.reactions.summariesFor([
            Number(message.id),
        ]);
        const summariesForMessage = summaries.get(Number(message.id)) ?? [];
        await this.emitChatMessage(
            dto.chatId,
            'editMessage:list',
            message,
            client,
            summariesForMessage,
        );
        const wireMessage = serializeMessageForViewer(
            message,
            await this.hiddenIdsForViewer(
                Number(client.data.user.sub),
                message,
            ),
            summariesForMessage,
        );
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
        const { wasPinned } = await this.messageService.delete(
            dto,
            client.data.user,
        );

        this.server
            .to(chatRoom(dto.chatId))
            .emit('deleteMessage:list', num(dto.messageId));
        // Deleting a pinned message also unpins it server-side; tell the room
        // so every banner drops it immediately (offline clients resync from
        // `getPinnedMessages` on their next join/reconnect).
        if (wasPinned) {
            this.server.to(chatRoom(dto.chatId)).emit('unpinMessage:list', {
                chatId: num(dto.chatId),
                messageId: num(dto.messageId),
            });
        }

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

    /**
     * Pin / unpin one message. Authorization and the row lock live in the
     * service; the gateway only serializes and broadcasts a real transition
     * (idempotent repeats emit nothing).
     */
    @SubscribeMessage('pinMessage')
    @UseGuards(wsIsMemberChat)
    async pinMessage(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: PinMessageDto,
    ) {
        const { message, changed } = await this.messageService.pin(
            dto,
            client.data.user,
        );
        const summaries = await this.reactions.summariesFor([
            Number(message.id),
        ]);
        const wireMessage = serializeMessageForViewer(
            message,
            await this.hiddenIdsForViewer(
                Number(client.data.user.sub),
                message,
            ),
            summaries.get(Number(message.id)) ?? [],
        );

        if (changed) {
            await this.emitChatMessage(
                dto.chatId,
                'pinMessage:list',
                message,
                client,
                summaries.get(Number(message.id)) ?? [],
                (wire) => ({ chatId: num(dto.chatId), message: wire }),
            );
        }

        return {
            ok: true,
            data: { message: wireMessage, alreadyPinned: !changed },
        };
    }

    @SubscribeMessage('unpinMessage')
    @UseGuards(wsIsMemberChat)
    async unpinMessage(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: PinMessageDto,
    ) {
        const { messageId, changed } = await this.messageService.unpin(
            dto,
            client.data.user,
        );

        if (changed) {
            const payload = {
                chatId: num(dto.chatId),
                messageId: num(messageId),
            };
            this.server
                .to(chatRoom(dto.chatId))
                .emit('unpinMessage:list', payload);
            if (!client.rooms.has(chatRoom(dto.chatId))) {
                client.emit('unpinMessage:list', payload);
            }
        }

        return {
            ok: true,
            data: { messageId: num(messageId), alreadyUnpinned: !changed },
        };
    }

    /** Offline/reconnect synchronization of the full pinned list. */
    @SubscribeMessage('getPinnedMessages')
    @UseGuards(wsIsMemberChat)
    async getPinnedMessages(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: GetPinnedMessagesDto,
    ) {
        const pinned = await this.messageService.getPinned(dto.chatId);
        const ids = pinned.map((message) => Number(message.id));
        const summaries = await this.reactions.summariesFor(ids);
        const hidden = await this.hiddenIdsForMessages(
            Number(client.data.user.sub),
            pinned,
        );

        return {
            ok: true,
            data: pinned.map((message) =>
                serializeMessageForViewer(
                    message,
                    hidden,
                    summaries.get(Number(message.id)) ?? [],
                ),
            ),
        };
    }

    @SubscribeMessage('getMessages')
    @UseGuards(wsIsMemberChat)
    async getMessages(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: GetMessagesDto,
    ) {
        const page = await this.messageService.getPage(
            dto.chatId,
            dto.beforeId,
            dto.limit ?? DEFAULT_MESSAGES_PAGE_SIZE,
            client.data.user.sub,
        );
        const ids = page.messages.map((message) => Number(message.id));
        // Exactly two reaction queries for the whole page, regardless of size.
        const [summaries, mine] = await Promise.all([
            this.reactions.summariesFor(ids),
            this.reactions.myReactionsFor(ids, client.data.user.sub),
        ]);

        const hidden = await this.hiddenIdsForMessages(
            Number(client.data.user.sub),
            page.messages,
        );
        return {
            ok: true,
            data: {
                // Newest first WITHIN the page, exactly like the old ack.
                messages: page.messages.map((message) =>
                    serializeMessage(
                        message,
                        summaries.get(Number(message.id)) ?? [],
                        mine.get(Number(message.id)) ?? null,
                        { hiddenUserIds: hidden },
                    ),
                ),
                hasMore: page.hasMore,
                // Id of the OLDEST message in this page; null when empty.
                nextCursor: page.nextCursor,
            },
        };
    }

    /**
     * Emits one message to the chat room with per-recipient sanitization.
     *
     * When no block relation exists inside the chat the fast path is a single
     * room broadcast (unchanged contract). Otherwise every socket gets its own
     * payload with the blockers hidden, and the caller still receives its ack
     * echo even when it is not in the room.
     */
    private async emitChatMessage(
        chatId: ChatId,
        event: string,
        message: Message,
        client?: SocketAuth,
        reactions: MessageReactionSummary[] = [],
        wrap: (wire: unknown) => unknown = (wire) => wire,
    ): Promise<void> {
        const relations = await this.visibility.blockedRelationsInChat(
            Number(chatId),
        );
        const room = chatRoom(chatId);

        if (relations.length === 0) {
            const wire = wrap(serializeMessage(message, reactions));
            this.server.to(room).emit(event, wire);
            if (client !== undefined && !client.rooms.has(room)) {
                client.emit(event, wire);
            }
            return;
        }

        let deliveredCaller = false;
        const sockets = await this.server.in(room).fetchSockets();
        for (const socket of sockets) {
            const viewerId = Number(
                (socket.data as SocketAuth['data'] | undefined)?.user?.sub ?? 0,
            );
            const wire = wrap(
                serializeMessage(message, reactions, undefined, {
                    hiddenUserIds: this.visibility.hiddenUserIdsFor(
                        viewerId,
                        relations,
                    ),
                }),
            );
            socket.emit(event, wire);
            if (socket.id === client?.id) {
                deliveredCaller = true;
            }
        }

        if (client !== undefined && !deliveredCaller) {
            client.emit(
                event,
                wrap(
                    serializeMessage(message, reactions, undefined, {
                        hiddenUserIds: this.visibility.hiddenUserIdsFor(
                            Number(client.data.user.sub),
                            relations,
                        ),
                    }),
                ),
            );
        }
    }

    /** Blocked user ids for one viewer across the message's embedded users. */
    private async hiddenIdsForViewer(
        viewerId: number,
        message: Message,
    ): Promise<Set<number>> {
        return this.hiddenIdsForMessages(viewerId, [message]);
    }

    /** One query for a whole page: senders, quoted senders, forward origins. */
    private async hiddenIdsForMessages(
        viewerId: number,
        messages: Message[],
    ): Promise<Set<number>> {
        const ids = new Set<number>();
        for (const message of messages) {
            if (message.sender?.id !== undefined) {
                ids.add(Number(message.sender.id));
            }
            if (message.replyTo?.sender?.id !== undefined) {
                ids.add(Number(message.replyTo.sender.id));
            }
            if (message.forwardedFromUserId != null) {
                ids.add(Number(message.forwardedFromUserId));
            }
        }
        ids.delete(Number(viewerId));
        if (ids.size === 0) {
            return new Set();
        }
        return this.visibility.blockersOfViewer(viewerId, [...ids]);
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
