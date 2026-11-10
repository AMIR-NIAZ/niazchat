import {
    BadRequestException,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Attachment } from 'src/modules/attachments/entities/attachment.entity';
import { AttachmentStatus } from 'src/modules/attachments/enums/attachmentStatus.enum';
import { AttachmentService } from 'src/modules/attachments/services/attachment.service';
import { ChatMember } from 'src/modules/chats/entities/chat_members.entity';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { ChatId, MessageId, UserId } from 'src/common/types/brands.type';
import { JwtPayload } from 'src/common/types/jwt-payload.type';
import { ForwardMessagesDto } from '../dtos/forwardMessages.dto';
import { Message } from '../entities/message.entity';
import { User } from 'src/modules/auth/entities/user.entity';
import { ForwardRequestStore } from './forward-request.store';

export type ForwardTargetResult =
    | { chatId: number; ok: true; messageIds: number[] }
    | { chatId: number; ok: false; message: string };

export interface ForwardAckData {
    results: ForwardTargetResult[];
}

export interface ForwardTargetMessages {
    chatId: number;
    messages: Message[];
}

export interface ForwardExecution {
    data: ForwardAckData;
    /** Fresh targets to broadcast; empty for an idempotent replay. */
    targets: ForwardTargetMessages[];
}

@Injectable()
export class MessageForwardService {
    constructor(
        @InjectRepository(Message)
        private readonly messageRepository: Repository<Message>,
        @InjectRepository(ChatMember)
        private readonly memberRepository: Repository<ChatMember>,
        @InjectDataSource()
        private readonly dataSource: DataSource,
        private readonly attachments: AttachmentService,
        private readonly store: ForwardRequestStore,
    ) {}

    async forward(
        user: JwtPayload,
        dto: ForwardMessagesDto,
    ): Promise<ForwardExecution> {
        await this.store.assertRateLimit(Number(user.sub));

        // Source authorization rejects the WHOLE request before any target is
        // attempted.
        await this.assertChatAccess(
            dto.fromChatId,
            user.sub,
            'source chat',
            true,
        );

        const requestKey = `forward:req:${user.sub}:${dto.requestId}`;
        return this.store
            .runIdempotent<ForwardExecution>(requestKey, () =>
                this.execute(user, dto),
            )
            .then(({ value, cached }) => ({
                data: value.data,
                targets: cached ? [] : value.targets,
            }));
    }

    private async execute(
        user: JwtPayload,
        dto: ForwardMessagesDto,
    ): Promise<ForwardExecution> {
        const sources = await this.loadSources(dto.fromChatId, dto.messageIds);
        const results: ForwardTargetResult[] = [];
        const targets: ForwardTargetMessages[] = [];

        for (const targetChatId of dto.toChatIds) {
            try {
                await this.assertChatAccess(
                    targetChatId,
                    user.sub,
                    'target chat',
                    false,
                );
                const messages = await this.forwardToChat(
                    targetChatId,
                    sources,
                    user,
                );
                targets.push({ chatId: Number(targetChatId), messages });
                results.push({
                    chatId: Number(targetChatId),
                    ok: true,
                    messageIds: messages.map((message) => Number(message.id)),
                });
            } catch (error) {
                results.push({
                    chatId: Number(targetChatId),
                    ok: false,
                    message: this.errorMessage(error),
                });
            }
        }

        return { data: { results }, targets };
    }

    /** ONE query for the whole source selection. */
    private async loadSources(
        fromChatId: ChatId,
        ids: MessageId[],
    ): Promise<Message[]> {
        const messages = await this.messageRepository.find({
            where: {
                id: In(ids),
                chat: { id: fromChatId },
                isDeleted: false,
            },
            relations: {
                sender: { profile: true },
                type: true,
                attachments: true,
            },
            select: {
                id: true,
                content: true,
                isDeleted: true,
                forwardedFromUserId: true,
                forwardedFromName: true,
                chat: { id: true },
                sender: {
                    id: true,
                    profile: {
                        id: true,
                        name: true,
                        username: true,
                    },
                },
                type: { id: true, name: true },
                attachments: {
                    id: true,
                    originalName: true,
                    storageKey: true,
                    mimeType: true,
                    size: true,
                    width: true,
                    height: true,
                    duration: true,
                    posterPath: true,
                    voice: true,
                    waveform: true,
                },
            },
        });

        if (messages.length !== ids.length) {
            throw new BadRequestException(
                'One or more messages were not found in this chat or have been deleted',
            );
        }
        return messages.sort((a, b) => Number(a.id) - Number(b.id));
    }

    private async forwardToChat(
        chatId: ChatId,
        sources: Message[],
        user: JwtPayload,
    ): Promise<Message[]> {
        const copiedFiles: Array<{
            storageKey: string;
            posterPath: string | null;
        }> = [];
        let committed = false;
        try {
            const ids = await this.dataSource.transaction(
                async (manager): Promise<number[]> => {
                    const messageRepo = manager.getRepository(Message);
                    const attachmentRepo = manager.getRepository(Attachment);
                    const createdIds: number[] = [];

                    for (const source of sources) {
                        const origin = this.originOf(source);
                        const saved = await messageRepo.save({
                            content: source.content ?? '',
                            sender: { id: user.sub },
                            chat: { id: chatId },
                            type: { id: source.type.id },
                            forwardedFromUserId: origin.userId,
                            forwardedFromName: origin.name,
                        });
                        createdIds.push(Number(saved.id));

                        for (const attachment of source.attachments ?? []) {
                            const files =
                                await this.attachments.copyFilesForForward(
                                    attachment,
                                    chatId,
                                );
                            copiedFiles.push(files);
                            await attachmentRepo.save({
                                originalName: attachment.originalName,
                                storageKey: files.storageKey,
                                mimeType: attachment.mimeType,
                                size: Number(attachment.size),
                                width: attachment.width ?? null,
                                height: attachment.height ?? null,
                                duration: attachment.duration ?? null,
                                voice: attachment.voice ?? null,
                                waveform: attachment.waveform ?? null,
                                posterPath: files.posterPath,
                                uploader: { id: user.sub },
                                chat: { id: chatId },
                                message: { id: saved.id },
                                status: AttachmentStatus.ATTACHED,
                            });
                        }
                    }
                    return createdIds;
                },
            );

            committed = true;
            const loaded = await this.messageRepository.find({
                where: { id: In(ids) },
                relations: {
                    sender: { profile: true },
                    chat: true,
                    type: true,
                    attachments: true,
                },
                select: {
                    id: true,
                    content: true,
                    createdAt: true,
                    updatedAt: true,
                    isEdited: true,
                    isDeleted: true,
                    forwardedFromUserId: true,
                    forwardedFromName: true,
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
                        createdAt: true,
                    },
                },
            });
            const byId = new Map(
                loaded.map((message) => [Number(message.id), message]),
            );
            return ids
                .map((id) => byId.get(Number(id)))
                .filter((message): message is Message => message !== undefined)
                .map((message) => ({
                    ...message,
                    attachments: [...(message.attachments ?? [])].sort(
                        (a, b) => Number(a.id) - Number(b.id),
                    ),
                }));
        } catch (error) {
            // A committed target owns its files: never delete them because a
            // post-commit serialization query failed.
            if (!committed) {
                for (const files of copiedFiles) {
                    await this.attachments.deleteFile(
                        files.storageKey,
                        files.posterPath,
                    );
                }
            }
            throw error;
        }
    }

    /**
     * Keeps the FIRST origin: a forwarded source reuses its stored snapshot;
     * an ordinary source snapshots its current sender name. A missing user is
     * represented by a null id and the stored (or empty) name.
     */
    private originOf(source: Message): {
        userId: number | null;
        name: string;
    } {
        const hasOrigin =
            source.forwardedFromUserId != null ||
            source.forwardedFromName != null;
        if (hasOrigin) {
            return {
                userId:
                    source.forwardedFromUserId == null
                        ? null
                        : Number(source.forwardedFromUserId),
                name: (source.forwardedFromName ?? '').slice(0, 100),
            };
        }
        const sender = source.sender as
            | (User & {
                  profile?: { name?: string | null; username?: string | null };
              })
            | null
            | undefined;
        const name = (
            sender?.profile?.name ??
            sender?.profile?.username ??
            ''
        ).slice(0, 100);
        return {
            userId: sender?.id == null ? null : Number(sender.id),
            name,
        };
    }

    private async assertChatAccess(
        chatId: ChatId,
        userId: UserId,
        label: string,
        wholeRequest: boolean,
    ): Promise<void> {
        const member = await this.memberRepository.findOne({
            where: { chat: { id: chatId }, user: { id: userId } },
            relations: { chat: true, role: true },
        });
        if (member === null || member === undefined) {
            const message = `You are not a member of the ${label}`;
            if (wholeRequest) throw new ForbiddenException(message);
            throw new ForbiddenException(message);
        }
        if ((member.role?.name as RoleChatEnum) === RoleChatEnum.BAN) {
            throw new ForbiddenException(
                `You have been banned from the ${label}`,
            );
        }
        if (member.chat.isBan) {
            throw new ForbiddenException(`The ${label} has been banned`);
        }
    }

    private errorMessage(error: unknown): string {
        if (
            error instanceof BadRequestException ||
            error instanceof ForbiddenException
        ) {
            const response = error.getResponse();
            if (typeof response === 'string') return response;
            if (
                typeof response === 'object' &&
                response !== null &&
                'message' in response
            ) {
                const message = (response as { message?: unknown }).message;
                if (typeof message === 'string') return message;
                if (Array.isArray(message)) return message.join(', ');
            }
        }
        return 'Could not forward to this chat';
    }
}
