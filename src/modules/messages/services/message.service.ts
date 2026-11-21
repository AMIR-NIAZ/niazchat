import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
    And,
    DataSource,
    EntityManager,
    FindOptionsWhere,
    In,
    LessThan,
    MoreThan,
    Repository,
} from 'typeorm';
import { Message } from '../entities/message.entity';
import { CreateMessageDto } from '../dtos/createMessage.dto';
import { ChatMember } from 'src/modules/chats/entities/chat_members.entity';
import { EditMessageDto } from '../dtos/EditMessage.dto';
import { JwtPayload } from 'src/common/types/jwt-payload.type';
import { deleteMessageDto } from '../dtos/deleteMessage.dto';
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
import { MessageLinkService } from './message-link.service';
import { AttachmentService } from 'src/modules/attachments/services/attachment.service';
import { Attachment } from 'src/modules/attachments/entities/attachment.entity';
import { ChatAccessService } from 'src/modules/chats/services/chat-access.service';
import { PrivateChatService } from 'src/modules/chats/services/private-chat.service';
import { UserBlockService } from 'src/modules/chats/services/user-block.service';
import { ChatService } from 'src/modules/chats/services/chat.service';
import { ReactionsService } from 'src/modules/reactions/services/reactions.service';
import { attachmentKindOf } from 'src/common/utils/attachment-kind.util';
import { canPinMessages } from 'src/modules/chats/utils/message-pin.util';
import { hasPermission } from 'src/modules/chats/utils/group-permissions.util';
import {
    callerMemberPermissions,
    memberPermissionAllowed,
} from 'src/modules/chats/services/chat-permission.service';
import type { ChatCallerContext } from 'src/modules/chats/services/chat-access.service';
import {
    attachmentMemberPermission,
    MEMBER_PERMISSION_FORBIDDEN,
    messageContainsLink,
    type MemberPermission,
} from 'src/modules/chats/utils/member-permissions.util';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { PinMessageDto } from '../dtos/pinMessage.dto';

@Injectable()
export class MessageService {
    constructor(
        @InjectRepository(Message)
        private readonly messageRepository: Repository<Message>,
        @InjectRepository(ChatMember)
        private readonly memberRepository: Repository<ChatMember>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(TypeMessage)
        private readonly typeMessageRepository: Repository<TypeMessage>,
        @InjectDataSource()
        private readonly dataSource: DataSource,
        private readonly contentResolver: ContentResolverService,
        private readonly attachmentService: AttachmentService,
        private readonly access: ChatAccessService,
        private readonly privateChats: PrivateChatService,
        private readonly reactions: ReactionsService,
        private readonly userBlocks: UserBlockService,
        private readonly chats: ChatService,
        private readonly messageLinks: MessageLinkService,
    ) {}

    async create(user: JwtPayload, dto: CreateMessageDto): Promise<Message> {
        const { chatId, reply, userId, type } = dto;

        // `system` messages are written by membership services only; a client
        // can never author one (and never fake a join/ban announcement).
        if (type === TypeMessageEnum.SYSTEM) {
            throw new BadRequestException(
                'system messages cannot be sent by clients',
            );
        }

        // A message must have text, attachments, or both.
        const hasAttachments = !!dto.attachments?.length;
        const hasText = !!dto.content?.trim();
        const textContent: string = hasText ? (dto.content as string) : '';
        if (!hasText && !hasAttachments) {
            throw new BadRequestException(
                'message needs text or at least one attachment',
            );
        }

        let message: Message;
        if (chatId) {
            message = await this.sendChat(
                chatId,
                user,
                reply,
                textContent,
                type,
                hasAttachments ? dto.attachments : undefined,
            );
        } else if (userId) {
            message = await this.sendPv(
                userId,
                user,
                reply,
                textContent,
                type,
                hasAttachments ? dto.attachments : undefined,
            );
        } else {
            throw new BadRequestException();
        }

        // Transient echo-only field: never persisted, history pages omit it.
        if (dto.clientMessageId !== undefined) {
            (
                message as Message & { clientMessageId?: string }
            ).clientMessageId = dto.clientMessageId;
        }
        return message;
    }

    private async sendChat(
        chatId: ChatId,
        user: JwtPayload,
        reply: MessageId | undefined,
        content: string,
        type: TypeMessageEnum,
        attachmentIds?: AttachmentId[],
    ) {
        // The full caller context (membership + role + admin grants + chat) is
        // the authorization base for the member-permission policy below.
        const caller = await this.access.getCallerContext(chatId, user.sub);
        this.access.assertRole(caller, RoleChatEnum.USER);

        // Server-side blocking: the chat id route is guarded exactly like the
        // user-id route, so the raw socket event cannot bypass a block.
        await this.userBlocks.assertCanCommunicate(chatId, user.sub);

        const typeData = await this.typeMessageRepository.findOneOrFail({
            where: { name: type },
        });

        return this.persistMessage(
            chatId,
            user,
            reply,
            content,
            typeData.id,
            type,
            attachmentIds,
            caller,
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

        // Directional block check BEFORE the chat lookup: a blocked pair can
        // never create (or reuse) a conversation just to try again.
        await this.userBlocks.assertCanMessageUser(user.sub, userId);

        // Same pair-key path as `POST /chats/private`: one chat per unordered
        // pair, both members on the normal `user` role, race-safe.
        const { chatId: finalChatId } = await this.privateChats.ensureChat(
            Number(user.sub),
            Number(userId),
        );

        const typeData = await this.typeMessageRepository.findOneOrFail({
            where: { name: type },
        });

        return this.persistMessage(
            finalChatId,
            user,
            reply,
            content,
            typeData.id,
            type,
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
        typeName: TypeMessageEnum,
        attachmentIds?: AttachmentId[],
        caller: ChatCallerContext | null = null,
    ): Promise<Message> {
        // The replied-to message must exist in THIS chat and not be deleted.
        const replyId = await this.validateReply(reply, chatId);

        // Authorization for attachments happens before the transaction; the
        // status transition inside it is still guarded against races.
        let attachmentRows: Attachment[] = [];
        if (attachmentIds?.length) {
            attachmentRows = await this.attachmentService.findUsable(
                attachmentIds,
                user.sub,
                chatId,
            );
        }

        // Member policy is enforced at the operation boundary, before the row
        // is written: a member cannot bypass the mobile UI with a raw socket
        // event, and the check uses the server-side attachment metadata (never
        // the declared MIME or a client-supplied permission).
        this.assertMemberSendPermissions(
            caller,
            content,
            typeName,
            attachmentRows,
        );

        const message = await this.dataSource.transaction(async (manager) => {
            // Voice composition is a server rule, checked inside the same
            // transaction as the claim: a voice id can never be combined with
            // text or another attachment, whatever the client sends.
            if (attachmentIds?.length) {
                await this.assertVoiceComposition(
                    manager,
                    attachmentIds,
                    content,
                );
                if (typeName === TypeMessageEnum.MUSIC) {
                    await this.assertMusicComposition(manager, attachmentIds);
                }
            }

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

            // Links are extracted once, at write time, so the Links tab is an
            // indexed lookup. Same transaction: a message and its links are
            // either both stored or neither is.
            await this.messageLinks.syncForMessage(
                Number(saved.id),
                Number(chatId),
                content,
                saved.createdAt,
                manager,
            );

            return saved;
        });

        const loaded = await this.loadMessage(message.id as MessageId);
        // TypeORM joins attachments without a stable order. The ack/echo must
        // present them exactly in the order the client sent the ids (photo then
        // PDF must not come back reversed).
        return attachmentIds?.length
            ? this.orderAttachments(loaded, attachmentIds)
            : loaded;
    }

    /**
     * Member-policy gate for CREATE. Owners/admins and private chats are
     * unaffected; a regular member must hold every switch implied by what is
     * actually being sent (text, attachment kind, link in the text).
     */
    private assertMemberSendPermissions(
        caller: ChatCallerContext | null,
        content: string,
        typeName: TypeMessageEnum,
        attachments: Attachment[],
    ): void {
        if (caller === null) return;
        if (caller.chat.type !== TypeChatEnum.GRUPE) return;
        if (caller.isManager || caller.isAdmin) return;
        const config = callerMemberPermissions(caller);

        const required = new Set<MemberPermission>();
        if (attachments.length === 0) {
            required.add('send_messages');
        } else {
            for (const attachment of attachments) {
                required.add(
                    attachmentMemberPermission(
                        attachmentKindOf(attachment.mimeType, attachment.voice),
                    ),
                );
            }
            if (typeName === TypeMessageEnum.VOICE) {
                required.add('send_voice');
            }
        }
        if (messageContainsLink(content)) {
            required.add('send_links');
        }

        const rules = {
            isOwner: caller.isManager,
            isAdmin: caller.isAdmin,
        };
        for (const key of required) {
            if (!memberPermissionAllowed(rules, config, key)) {
                throw new WsException(MEMBER_PERMISSION_FORBIDDEN[key]);
            }
        }
    }

    /**
     * A music message carries exactly one audio attachment (never a generic
     * file or a voice recording); an optional text caption is allowed.
     */
    private async assertMusicComposition(
        manager: EntityManager,
        attachmentIds: AttachmentId[],
    ): Promise<void> {
        if (attachmentIds.length !== 1) {
            throw new BadRequestException(
                'a music message must have exactly one attachment',
            );
        }
        const row = await manager.getRepository(Attachment).findOne({
            where: { id: attachmentIds[0] },
            select: { id: true, mimeType: true, voice: true },
        });
        if (
            row === null ||
            attachmentKindOf(row.mimeType, row.voice) !== 'music'
        ) {
            throw new BadRequestException(
                'a music message must reference an audio track',
            );
        }
    }

    /**
     * A voice message is exactly one voice attachment and no text. Any other
     * combination is rejected before the message row is written.
     */
    private async assertVoiceComposition(
        manager: EntityManager,
        attachmentIds: AttachmentId[],
        content: string,
    ): Promise<void> {
        const rows = await manager.getRepository(Attachment).find({
            where: { id: In(attachmentIds) },
            select: { id: true, voice: true },
        });
        if (!rows.some((row) => row.voice === true)) {
            return;
        }
        if (rows.length !== 1 || attachmentIds.length !== 1) {
            throw new BadRequestException(
                'a voice message must have exactly one attachment',
            );
        }
        if (content.trim() !== '') {
            throw new BadRequestException('voice messages cannot include text');
        }
    }

    private orderAttachments(
        message: Message,
        attachmentIds: AttachmentId[],
    ): Message {
        const rank = new Map(
            attachmentIds.map((id, index) => [Number(id), index]),
        );
        message.attachments = [...(message.attachments ?? [])].sort(
            (a, b) =>
                (rank.get(Number(a.id)) ?? attachmentIds.length) -
                (rank.get(Number(b.id)) ?? attachmentIds.length),
        );
        return message;
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
            relations: { type: true },
            select: { id: true, type: { id: true, name: true } },
        });
        if (!original) {
            throw new BadRequestException(
                'reply message not found in this chat (or deleted)',
            );
        }
        if (original.type?.name === (TypeMessageEnum.SYSTEM as string)) {
            throw new BadRequestException(
                'system messages cannot be replied to',
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
            // Only what the message payload serializes: the sender is snapped to
            // { id, name, username, avatars[0] }, so no phone/lastSeen/status and
            // no unrelated profile columns leave the database for a send.
            select: {
                id: true,
                content: true,
                createdAt: true,
                updatedAt: true,
                isEdited: true,
                isDeleted: true,
                isPinned: true,
                pinnedAt: true,
                forwardedFromUserId: true,
                forwardedFromName: true,
                meta: true,
                chat: { id: true },
                sender: {
                    id: true,
                    profile: {
                        id: true,
                        name: true,
                        username: true,
                        avatars: true,
                    },
                },
                type: { id: true, name: true },
                attachments: {
                    id: true,
                    originalName: true,
                    mimeType: true,
                    size: true,
                    width: true,
                    height: true,
                    duration: true,
                    posterPath: true,
                    voice: true,
                    waveform: true,
                    title: true,
                    artist: true,
                    durationSeconds: true,
                    coverPath: true,
                    createdAt: true,
                },
                replyTo: {
                    id: true,
                    content: true,
                    isDeleted: true,
                    sender: { id: true, profile: { id: true, name: true } },
                    type: { id: true, name: true },
                    attachments: {
                        id: true,
                        mimeType: true,
                        duration: true,
                        voice: true,
                        title: true,
                        durationSeconds: true,
                    },
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

        // The message must exist in the GIVEN chat and not be soft-deleted.
        // Ownership is checked below so a non-owner gets a readable error
        // instead of a generic "not found".
        const message = await this.messageRepository.findOne({
            where: {
                id: messageId,
                chat: { id: chatId },
                isDeleted: false,
            },
            relations: {
                type: true,
                sender: { profile: true },
                chat: true,
                attachments: true,
                replyTo: {
                    sender: { profile: true },
                    type: true,
                    attachments: true,
                },
            },
            // Same minimal sender projection as history: no phone/lastSeen.
            select: {
                id: true,
                content: true,
                createdAt: true,
                updatedAt: true,
                isEdited: true,
                isDeleted: true,
                forwardedFromUserId: true,
                forwardedFromName: true,
                meta: true,
                chat: { id: true, type: true },
                sender: {
                    id: true,
                    profile: {
                        id: true,
                        name: true,
                        username: true,
                        avatars: true,
                    },
                },
                type: { id: true, name: true },
                attachments: {
                    id: true,
                    originalName: true,
                    mimeType: true,
                    size: true,
                    width: true,
                    height: true,
                    duration: true,
                    posterPath: true,
                    voice: true,
                    waveform: true,
                    title: true,
                    artist: true,
                    durationSeconds: true,
                    coverPath: true,
                    createdAt: true,
                },
                replyTo: {
                    id: true,
                    content: true,
                    isDeleted: true,
                    sender: { id: true, profile: { id: true, name: true } },
                    type: { id: true, name: true },
                    attachments: {
                        id: true,
                        mimeType: true,
                        duration: true,
                        voice: true,
                        title: true,
                        durationSeconds: true,
                    },
                },
            },
        });
        if (!message) throw new WsException('message not found');

        if (message.type?.name === (TypeMessageEnum.SYSTEM as string)) {
            throw new WsException('system messages cannot be edited');
        }
        // Editing is a MEMBER capability in groups: the switch is checked
        // server-side, so a raw `editMessage` event cannot bypass it.
        if (message.chat?.type === TypeChatEnum.GRUPE) {
            const caller = await this.access.getCallerContext(chatId, user.sub);
            if (caller.roleName === RoleChatEnum.BAN) {
                throw new WsException('you have been banned from this group');
            }
            if (
                !memberPermissionAllowed(
                    { isOwner: caller.isManager, isAdmin: caller.isAdmin },
                    callerMemberPermissions(caller),
                    'edit_own_messages',
                )
            ) {
                throw new WsException(
                    MEMBER_PERMISSION_FORBIDDEN.edit_own_messages,
                );
            }
        }
        if (Number(message.sender?.id) !== Number(user.sub)) {
            throw new WsException('you can only edit your own messages');
        }
        if (message.content === null || message.content.trim() === '') {
            throw new WsException('messages without text cannot be edited');
        }
        const isVoice =
            message.type.name === (TypeMessageEnum.VOICE as string) ||
            (message.attachments ?? []).some(
                (attachment) => attachment.voice === true,
            );
        if (isVoice) {
            throw new WsException('voice messages cannot be edited');
        }
        if (
            message.forwardedFromUserId != null ||
            message.forwardedFromName != null
        ) {
            throw new WsException('forwarded messages cannot be edited');
        }

        message.content = newContent;
        message.isEdited = true;
        await this.messageRepository.save(message);
        // An edit can add, change or remove URLs: replace this message's rows.
        await this.messageLinks.syncForMessage(
            Number(messageId),
            Number(chatId),
            newContent,
            message.createdAt,
        );

        // The edit echo must carry the full attachment metadata, reply preview
        // and forward origin, not a light row with no relations.
        return await this.loadMessage(message.id as MessageId);
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
            relations: { sender: true, type: true, chat: true },
        });
        if (!message) throw new WsException('message not found');
        if (message.type?.name === (TypeMessageEnum.SYSTEM as string)) {
            throw new WsException('system messages cannot be deleted');
        }

        const isOwnMessage = Number(message.sender?.id) === Number(user.sub);
        if (message.chat?.type === TypeChatEnum.GRUPE) {
            const caller = await this.access.getCallerContext(chatId, user.sub);
            if (caller.roleName === RoleChatEnum.BAN) {
                throw new WsException('you have been banned from this group');
            }
            if (isOwnMessage) {
                // The group's member policy governs deleting one's own message;
                // owners and admins always pass.
                if (
                    !memberPermissionAllowed(
                        { isOwner: caller.isManager, isAdmin: caller.isAdmin },
                        callerMemberPermissions(caller),
                        'delete_own_messages',
                    )
                ) {
                    throw new WsException(
                        MEMBER_PERMISSION_FORBIDDEN.delete_own_messages,
                    );
                }
            } else {
                const role = caller.isManager
                    ? 'owner'
                    : caller.isAdmin
                      ? 'admin'
                      : 'member';
                if (
                    !hasPermission(
                        role,
                        caller.permissions,
                        'delete_other_messages',
                    )
                ) {
                    throw new WsException(
                        "You don't have permission to do this",
                    );
                }
            }
        } else if (!isOwnMessage) {
            throw new WsException("You don't have permission to do this");
        }

        const wasPinned = message.isPinned === true;
        // A deleted message can never stay pinned: clear both pin fields with
        // the soft delete so history, `getPinnedMessages` and the banner can
        // never show tombstoned content. The broadcast for the unpin is emitted
        // by the gateway only when the message really was pinned.
        await this.messageRepository.update(messageId, {
            isDeleted: true,
            isPinned: false,
            pinnedAt: null,
        });
        // Soft delete keeps the row, so its reactions would otherwise linger.
        await this.reactions.clearForMessage(Number(messageId));
        // Deleted-for-everyone messages must disappear from the Links tab too.
        await this.messageLinks.clearForMessage(Number(messageId));

        return { wasPinned };
    }

    /**
     * Pin a message. Idempotent: a repeated request (or a second client racing
     * the first) never duplicates state or emits a second broadcast — the ack
     * reports `alreadyPinned`. The row is locked inside the transaction, so
     * concurrent pin/unpin calls serialize and the final state is the last one.
     * The message itself (and its attachments) is never copied.
     */
    async pin(
        dto: PinMessageDto,
        user: JwtPayload,
    ): Promise<{ message: Message; changed: boolean }> {
        await this.assertCanPinMessages(dto.chatId, user.sub);
        const { messageId, changed } = await this.setPinned(
            dto.chatId,
            dto.messageId,
            true,
        );
        return {
            message: await this.loadMessage(messageId),
            changed,
        };
    }

    /** Unpin a message. Idempotent, exactly like `pin`. */
    async unpin(
        dto: PinMessageDto,
        user: JwtPayload,
    ): Promise<{ messageId: MessageId; changed: boolean }> {
        await this.assertCanPinMessages(dto.chatId, user.sub);
        const { messageId, changed } = await this.setPinned(
            dto.chatId,
            dto.messageId,
            false,
        );
        return { messageId, changed };
    }

    /**
     * Every currently pinned message of a chat, newest pin first. Backs both
     * `getPinnedMessages` (offline/reconnect sync) and the banner preview; the
     * message records are the originals, never duplicates.
     */
    async getPinned(chatId: ChatId): Promise<Message[]> {
        return this.messageRepository.find({
            where: {
                chat: { id: chatId },
                isPinned: true,
                isDeleted: false,
            },
            relations: {
                sender: { profile: true },
                attachments: true,
                type: true,
                replyTo: {
                    sender: { profile: true },
                    type: true,
                    attachments: true,
                },
            },
            order: { pinnedAt: 'DESC', id: 'DESC' },
        });
    }

    /**
     * The one authorization gate for pin AND unpin: the caller must be a
     * member, and `canPinMessages` decides the role/permission layer (private
     * → either participant, group → owner always, admin/member only with the
     * explicit `pin_message` grant or `all`).
     */
    private async assertCanPinMessages(
        chatId: ChatId,
        userId: JwtPayload['sub'],
    ): Promise<void> {
        const caller = await this.access.getCallerContext(chatId, userId);

        // Groups: a regular member follows the group's member policy, which
        // protects BOTH pin and unpin. Owners/admins keep the admin grant
        // rules below (owner always, admin with `pin_messages`/`all`).
        if (
            caller.chat.type === TypeChatEnum.GRUPE &&
            !caller.isManager &&
            !caller.isAdmin
        ) {
            if (caller.roleName === RoleChatEnum.BAN) {
                throw new WsException('you have been banned from this group');
            }
            if (
                !memberPermissionAllowed(
                    { isOwner: caller.isManager, isAdmin: caller.isAdmin },
                    callerMemberPermissions(caller),
                    'pin_messages',
                )
            ) {
                throw new WsException(MEMBER_PERMISSION_FORBIDDEN.pin_messages);
            }
            return;
        }

        if (
            !canPinMessages({
                chatType: caller.chat.type,
                isChatBanned: caller.chat.isBan === true,
                roleName: caller.roleName,
                isManager: caller.isManager,
                isAdmin: caller.isAdmin,
                permissions: caller.permissions,
            })
        ) {
            throw new WsException(
                "you don't have permission to pin or unpin messages",
            );
        }
    }

    /**
     * Locks the message row inside one transaction and flips the pin state.
     * The lookup is scoped to the supplied chat, so a message from another
     * conversation answers the same neutral "message not found" as a missing
     * id (no cross-chat information leak).
     *
     * PostgreSQL rejects `FOR UPDATE` when the statement's outer joins are
     * nullable ("FOR UPDATE cannot be applied to the nullable side of an outer
     * join"), and TypeORM emits LEFT JOINs for relation filters and `relations`.
     * The lock query therefore touches the `messages` table only; the chat and
     * type relations are read afterwards, still inside the transaction, and the
     * chat ownership is validated explicitly. The row lock is kept until commit,
     * so a concurrent pin/unpin waits and then observes the committed state.
     */
    private async setPinned(
        chatId: ChatId,
        messageId: MessageId,
        pinned: boolean,
    ): Promise<{ messageId: MessageId; changed: boolean }> {
        return this.dataSource.transaction(async (manager) => {
            const repository = manager.getRepository(Message);

            // Step 1: lock the message row by primary key. No relations and no
            // relation-based filter, so the statement is a plain
            // `SELECT ... FROM messages WHERE id = $1 FOR UPDATE`.
            const locked = await repository.findOne({
                where: { id: messageId, isDeleted: false },
                select: { id: true, isPinned: true, pinnedAt: true },
                lock: { mode: 'pessimistic_write' },
            });
            if (!locked) throw new WsException('message not found');

            // Step 2: load the relations without a lock, inside the same
            // transaction, and enforce chat ownership here. A message from
            // another chat (or a deleted one) is indistinguishable from a
            // missing id to the caller.
            const message = await repository.findOne({
                where: { id: messageId },
                relations: { type: true, chat: true },
            });
            if (
                !message ||
                message.isDeleted ||
                Number(message.chat?.id) !== Number(chatId)
            ) {
                throw new WsException('message not found');
            }
            if (message.type?.name === (TypeMessageEnum.SYSTEM as string)) {
                throw new WsException('system messages cannot be pinned');
            }

            // Idempotency is decided from the locked row; a second request that
            // waited for the lock sees the committed state and writes nothing.
            if (locked.isPinned === pinned) {
                return { messageId, changed: false };
            }

            await repository.update(
                messageId,
                pinned
                    ? { isPinned: true, pinnedAt: new Date() }
                    : { isPinned: false, pinnedAt: null },
            );
            return { messageId, changed: true };
        });
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
        viewerId?: UserId,
    ): Promise<{
        messages: Message[];
        hasMore: boolean;
        nextCursor: number | null;
    }> {
        // "Delete chat for me": the viewer's own history starts after their
        // deletion marker; everybody else's history is untouched.
        const clearedBefore =
            viewerId === undefined
                ? null
                : await this.chats.getClearedBeforeId(chatId, viewerId);

        const where: FindOptionsWhere<Message> = {
            chat: { id: chatId },
            isDeleted: false,
        };
        if (clearedBefore !== null) {
            where.id =
                beforeId === undefined
                    ? MoreThan(clearedBefore)
                    : And(MoreThan(clearedBefore), LessThan(beforeId));
        } else if (beforeId !== undefined) {
            where.id = LessThan(beforeId);
        }

        const messages = await this.messageRepository.find({
            where,
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
                isPinned: true,
                pinnedAt: true,
                forwardedFromUserId: true,
                forwardedFromName: true,
                meta: true,
                sender: {
                    id: true,
                    profile: {
                        id: true,
                        name: true,
                        username: true,
                        avatars: true,
                    },
                },
                attachments: {
                    id: true,
                    originalName: true,
                    mimeType: true,
                    size: true,
                    width: true,
                    height: true,
                    duration: true,
                    posterPath: true,
                    voice: true,
                    waveform: true,
                    title: true,
                    artist: true,
                    durationSeconds: true,
                    coverPath: true,
                    createdAt: true,
                },
                replyTo: {
                    id: true,
                    content: true,
                    isDeleted: true,
                    sender: { id: true, profile: { id: true, name: true } },
                    type: { id: true, name: true },
                    attachments: {
                        id: true,
                        mimeType: true,
                        duration: true,
                        voice: true,
                        title: true,
                        durationSeconds: true,
                    },
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
}
