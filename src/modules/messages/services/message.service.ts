import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import { Message } from '../entities/message.entity';
import { CreateMessageDto } from '../dtos/createMessage.dto';
import { ChatMember } from 'src/modules/chats/entities/chat_members.entity';
import { EditMessageDto } from '../dtos/EditMessage.dto';
import { JwtPayload } from 'src/common/types/jwt-payload.type';
import { deleteMessageDto } from '../dtos/deleteMessage.dto';
import { Chat } from 'src/modules/chats/entities/chat.entity';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { User } from 'src/modules/auth/entities/user.entity';
import { WsException } from '@nestjs/websockets';
import { TypeMessageEnum } from 'src/common/enums/typeMessage.enum';
import { TypeMessage } from '../entities/typeMessage.entity';
import {
    ChatId,
    MessageId,
    UserId,
    AttachmentId,
} from 'src/common/types/brands.type';
import { ContentResolverService } from './content-resolver.service';
import { toUserResponse } from 'src/modules/auth/utils/user-response.util';
import { AttachmentService } from 'src/modules/attachments/services/attachment.service';
import { ChatAccessService } from 'src/modules/chats/services/chat-access.service';

@Injectable()
export class MessageService {
    constructor(
        @InjectRepository(Message)
        private readonly messageRepository: Repository<Message>,
        @InjectRepository(ChatMember)
        private readonly memberRepository: Repository<ChatMember>,
        @InjectRepository(Chat)
        private readonly chatRepository: Repository<Chat>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(TypeMessage)
        private readonly typeMessageRepository: Repository<TypeMessage>,
        @InjectDataSource()
        private readonly dataSource: DataSource,
        private readonly contentResolver: ContentResolverService,
        private readonly attachmentService: AttachmentService,
        private readonly access: ChatAccessService,
    ) {}

    async create(user: JwtPayload, dto: CreateMessageDto): Promise<Message> {
        const { chatId, reply, userId, type } = dto;

        // A message must have text, attachments, or both.
        const hasAttachments = !!dto.attachments?.length;
        const hasText = !!dto.content?.trim();
        const textContent: string = hasText ? (dto.content as string) : '';
        if (!hasText && !hasAttachments) {
            throw new BadRequestException('message content is required');
        }

        if (chatId) {
            return this.sendChat(
                chatId,
                user,
                reply,
                textContent,
                type,
                hasAttachments ? dto.attachments : undefined,
            );
        }

        if (userId) {
            return this.sendPv(
                userId,
                user,
                reply,
                textContent,
                type,
                hasAttachments ? dto.attachments : undefined,
            );
        }

        throw new BadRequestException();
    }

    private async sendChat(
        chatId: ChatId,
        user: JwtPayload,
        reply: MessageId | undefined,
        content: string,
        type: TypeMessageEnum,
        attachmentIds?: AttachmentId[],
    ) {
        const isMember = await this.memberRepository.findOne({
            where: {
                chat: { id: chatId },
                user: { id: user.sub },
            },
        });
        if (!isMember) throw new BadRequestException('user not exit in chat');

        const typeData = await this.typeMessageRepository.findOneOrFail({
            where: { name: type },
        });

        return this.persistMessage(
            chatId,
            user,
            reply,
            content,
            typeData.id,
            attachmentIds,
        );
    }

    private async sendPv(
        userId: UserId,
        user: JwtPayload,
        reply: MessageId | undefined,
        content: string,
        type: TypeMessageEnum,
        attachmentIds?: AttachmentId[],
    ) {
        const hasUserReceiver = await this.userRepository.findOne({
            where: { id: userId },
        });

        if (!hasUserReceiver) throw new NotFoundException('receiver not Found');

        const chats = await this.chatRepository.find({
            where: {
                type: TypeChatEnum.PRIVATE,
                members: {
                    user: { id: user.sub },
                },
            },
            relations: ['members', 'members.user'],
        });
        const existingChat = chats.find((chat) =>
            chat.members.some((m) => m.user.id === userId),
        );

        let finalChatId: ChatId;
        if (existingChat) {
            finalChatId = existingChat.id;
        } else {
            const newPrivateChat = await this.chatRepository.save({
                type: TypeChatEnum.PRIVATE,
            });
            await this.memberRepository.save([
                {
                    chat: { id: newPrivateChat.id },
                    user: { id: user.sub },
                },
                {
                    chat: { id: newPrivateChat.id },
                    user: { id: userId },
                },
            ]);

            finalChatId = newPrivateChat.id;
        }

        const typeData = await this.typeMessageRepository.findOneOrFail({
            where: { name: type },
        });

        return this.persistMessage(
            finalChatId,
            user,
            reply,
            content,
            typeData.id,
            attachmentIds,
        );
    }

    /**
     * Persists the message and binds its attachments in a single transaction:
     * either both happen or neither. The pending->attached transition is done
     * with a status guard so an attachment can never be used twice.
     */
    private async persistMessage(
        chatId: ChatId,
        user: JwtPayload,
        reply: MessageId | undefined,
        content: string,
        typeMessageId: number,
        attachmentIds?: AttachmentId[],
    ): Promise<Message> {
        // The replied-to message must exist in THIS chat and not be deleted.
        const replyId = await this.validateReply(reply, chatId);

        // Authorization for attachments happens before the transaction; the
        // status transition inside it is still guarded against races.
        if (attachmentIds?.length) {
            await this.attachmentService.findUsable(
                attachmentIds,
                user.sub,
                chatId,
            );
        }

        const message = await this.dataSource.transaction(async (manager) => {
            const saved = await manager.getRepository(Message).save({
                content,
                sender: { id: user.sub },
                chat: { id: chatId },
                replyTo: { id: replyId },
                type: { id: typeMessageId },
            });

            if (attachmentIds?.length) {
                await this.attachmentService.bindToMessage(
                    manager,
                    attachmentIds,
                    saved.id,
                );
            }

            return saved;
        });

        return this.loadMessage(message.id as MessageId);
    }

    /**
     * Normalizes the wire `reply` field: a positive integer (or numeric string)
     * is a reply id; anything else means "no reply".
     */
    private toReplyId(reply: unknown): MessageId | undefined {
        const parsed =
            typeof reply === 'number'
                ? reply
                : typeof reply === 'string' && reply.trim() !== ''
                  ? Number(reply)
                  : Number.NaN;
        return Number.isInteger(parsed) && parsed > 0
            ? (parsed as MessageId)
            : undefined;
    }

    /**
     * Server-side reply validation (not just UI): the original must exist in the
     * same chat and must not be soft-deleted. Missing/non-numeric ids mean no reply.
     */
    private async validateReply(
        reply: unknown,
        chatId: ChatId,
    ): Promise<MessageId | undefined> {
        const replyId = this.toReplyId(reply);
        if (replyId === undefined) {
            return undefined;
        }
        const original = await this.messageRepository.findOne({
            where: {
                id: replyId,
                chat: { id: chatId },
                isDeleted: false,
            },
            select: { id: true },
        });
        if (!original) {
            throw new BadRequestException(
                'reply message not found in this chat (or deleted)',
            );
        }
        return replyId;
    }

    private async loadMessage(id: MessageId): Promise<Message> {
        const message = await this.messageRepository.findOne({
            where: { id },
            relations: {
                sender: { profile: true },
                type: true,
                attachments: true,
                chat: true,
                // The ack/echo must carry the quoted preview immediately.
                replyTo: {
                    sender: { profile: true },
                    type: true,
                    attachments: true,
                },
            },
        });

        if (!message) throw new NotFoundException('message not found');

        return message;
    }

    async edit(dto: EditMessageDto, user: JwtPayload) {
        const { messageId, newContent, chatId } = dto;

        if (typeof newContent !== 'string' || newContent.trim() === '') {
            throw new WsException('message content is required');
        }

        // One query enforces every rule server-side: the message must exist
        // in the GIVEN chat, belong to the caller, not be soft-deleted. A
        // miss can mean "not mine" or "another chat" — report it neutrally.
        const message = await this.messageRepository.findOne({
            where: {
                id: messageId,
                chat: { id: chatId },
                sender: { id: user.sub },
                isDeleted: false,
            },
            relations: {
                type: true,
                sender: { profile: true },
                chat: true,
                replyTo: {
                    sender: { profile: true },
                    type: true,
                    attachments: true,
                },
            },
        });
        if (!message) throw new WsException('message not found');

        if (message.type.name !== (TypeMessageEnum.TEXT as string)) {
            throw new WsException('only text messages can be edited');
        }

        message.content = newContent;
        message.isEdited = true;

        return this.serializeSender(await this.messageRepository.save(message));
    }

    /**
     * Soft-delete a message.
     *
     * Senders may always delete their own message. In a GROUP, the owner may
     * additionally delete any member's message. Ownership here is the chat role
     * `manager` only: chat `admin` is NOT the owner and cannot moderate messages.
     * The message is always looked up inside the supplied chat id, so a message
     * from an unrelated conversation can never be deleted.
     */
    async delete(dto: deleteMessageDto, user: JwtPayload) {
        const { chatId, messageId } = dto;

        // One neutral miss for "does not exist", "another chat" and "already
        // soft-deleted" — no cross-chat or cross-user information leak.
        const message = await this.messageRepository.findOne({
            where: {
                id: messageId,
                chat: { id: chatId },
                isDeleted: false,
            },
            relations: { sender: true },
        });
        if (!message) throw new WsException('message not found');

        const isOwnMessage = Number(message.sender?.id) === Number(user.sub);
        if (!isOwnMessage) {
            const caller = await this.access.getCallerContext(chatId, user.sub);
            if (
                !caller.isManager ||
                caller.chat.type !== TypeChatEnum.GRUPE
            ) {
                throw new WsException(
                    "only the group owner can delete other members' messages",
                );
            }
        }

        await this.messageRepository.update(messageId, { isDeleted: true });
    }

    /**
     * The chat's newest non-deleted message, or null for an empty chat —
     * used after a DELETE to refresh other member's chat-list previews so
     * they never keep showing the deleted text.
     */
    async lastNonDeletedMessage(chatId: ChatId): Promise<Message | null> {
        return this.messageRepository.findOne({
            where: { chat: { id: chatId }, isDeleted: false },
            relations: {
                sender: { profile: true },
                attachments: true,
                type: true,
            },
            order: { id: 'DESC' },
        });
    }

    /**
     * One page of non-deleted chat history, newest first.
     *
     * `beforeId` is exclusive (`id < beforeId`) and is the previous page's
     * `nextCursor`. `limit + 1` rows are fetched only to compute `hasMore`;
     * the extra row is never returned. Relations are joined (no N+1), the same
     * set `getMessages` has always serialized, plus `replyTo` for its id.
     */
    async getPage(
        chatId: ChatId,
        beforeId?: number,
        limit: number = 30,
    ): Promise<{
        messages: Message[];
        hasMore: boolean;
        nextCursor: number | null;
    }> {
        const messages = await this.messageRepository.find({
            where: {
                chat: { id: chatId },
                isDeleted: false,
                ...(beforeId !== undefined ? { id: LessThan(beforeId) } : {}),
            },
            relations: {
                sender: { profile: true },
                attachments: true,
                type: true,
                // Joined regardless of the original's isDeleted flag: replies to
                // soft-deleted messages must still carry a (content-less) preview.
                replyTo: {
                    sender: { profile: true },
                    type: true,
                    attachments: true,
                },
            },
            select: {
                id: true,
                createdAt: true,
                updatedAt: true,
                content: true,
                isEdited: true,
                isDeleted: true,
                sender: {
                    id: true,
                    phone: true,
                    isOnline: true,
                    lastSeen: true,
                    status: true,
                    createdAt: true,
                    updatedAt: true,
                    profile: {
                        id: true,
                        name: true,
                        username: true,
                        biografy: true,
                        avatars: true,
                    },
                },
                attachments: {
                    id: true,
                    originalName: true,
                    mimeType: true,
                    size: true,
                    createdAt: true,
                },
                replyTo: {
                    id: true,
                    content: true,
                    isDeleted: true,
                    sender: { id: true, profile: { id: true, name: true } },
                    type: { id: true, name: true },
                    attachments: { id: true },
                },
            },
            order: { id: 'DESC' },
            take: limit + 1,
        });

        const hasMore = messages.length > limit;
        const page = hasMore ? messages.slice(0, limit) : messages;
        const oldest = page[page.length - 1];

        return {
            messages: page,
            hasMore,
            nextCursor: oldest === undefined ? null : Number(oldest.id),
        };
    }

    private serializeSender(message: Message): Message {
        if (message.sender) {
            message.sender = toUserResponse(message.sender) as unknown as User;
        }
        return message;
    }

    private async loadSender(userId: UserId): Promise<User> {
        const sender = await this.userRepository.findOne({
            where: { id: userId },
            relations: { profile: true },
            select: {
                id: true,
                phone: true,
                isOnline: true,
                lastSeen: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                profile: {
                    id: true,
                    name: true,
                    username: true,
                    biografy: true,
                    avatars: true,
                },
            },
        });

        if (!sender) throw new NotFoundException('sender not found');

        return toUserResponse(sender) as unknown as User;
    }
}
