import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
    IMAGE_MIME_TYPES,
    MEDIA_MIME_TYPES,
    MUSIC_MIME_TYPES,
    VIDEO_MIME_TYPES,
    type AttachmentKind,
} from 'src/common/utils/attachment-kind.util';
import { linkSnippet } from 'src/common/utils/link-extractor.util';
import { serializeAttachmentMeta } from 'src/common/utils/ws-serializer.utils';
import { ChatId, UserId } from 'src/common/types/brands.type';
import { Attachment } from 'src/modules/attachments/entities/attachment.entity';
import { AttachmentStatus } from 'src/modules/attachments/enums/attachmentStatus.enum';
import { ChatService } from 'src/modules/chats/services/chat.service';
import { VisibilityService } from 'src/modules/visibility/visibility.service';
import type { Message } from '../entities/message.entity';
import { MessageLink } from '../entities/message-link.entity';
import type { ChatMediaType } from '../dtos/getChatMedia.dto';
import {
    DEFAULT_CHAT_MEDIA_PAGE_SIZE,
    MAX_CHAT_MEDIA_PAGE_SIZE,
} from '../dtos/getChatMedia.dto';

/** Minimal sender projection for a shared-content row. */
export interface SharedContentSender {
    id: number;
    /** Empty when this sender blocked the viewer (details hidden). */
    name: string;
    /** Absolute/current avatar path, or null. */
    avatarUrl: string | null;
}

/** One attachment-backed shared-content item (media, voice, music, files). */
export interface SharedAttachmentItem {
    /** Attachment wire metadata, identical to message payloads. */
    attachment: ReturnType<typeof serializeAttachmentMeta> & {
        kind: AttachmentKind;
    };
    messageId: number;
    sender: SharedContentSender;
    /** Message creation time (the tabs group by this month). */
    createdAt: string;
}

/** One extracted link item. */
export interface SharedLinkItem {
    id: number;
    messageId: number;
    url: string;
    domain: string;
    /** Text around the URL (message body is never returned in full). */
    snippet: string;
    sender: SharedContentSender;
    createdAt: string;
}

export interface SharedContentPage<T> {
    items: T[];
    /** Pass back as `cursor`; null when there is no older page. */
    nextCursor: string | null;
}

/** `createdAt|id` for links, `createdAt|messageId|attachmentId` otherwise. */
interface ParsedCursor {
    createdAt: Date;
    id: number;
    /** Only for attachment-backed items (the attachment id). */
    attachmentId: number | null;
}

function encodeAttachmentCursor(
    createdAt: Date,
    messageId: number,
    attachmentId: number,
): string {
    return `${createdAt.toISOString()}|${messageId}|${attachmentId}`;
}

function encodeLinkCursor(createdAt: Date, linkId: number): string {
    return `${createdAt.toISOString()}|${linkId}`;
}

function parseCursor(raw: string | undefined): ParsedCursor | null {
    if (raw === undefined || raw.trim() === '') return null;
    const parts = raw.trim().split('|');
    if (parts.length !== 2 && parts.length !== 3) {
        throw new BadRequestException('invalid cursor');
    }
    const [iso, mainId, attachmentId] = parts;
    const date = new Date(iso ?? '');
    const id = Number(mainId);
    const extra = attachmentId === undefined ? null : Number(attachmentId);
    if (
        Number.isNaN(date.getTime()) ||
        !Number.isInteger(id) ||
        id <= 0 ||
        (extra !== null && (!Number.isInteger(extra) || extra <= 0))
    ) {
        throw new BadRequestException('invalid cursor');
    }
    return { createdAt: date, id, attachmentId: extra };
}

function senderOf(
    message: Message,
    hidden: ReadonlySet<number>,
): SharedContentSender {
    const sender = message.sender;
    const id = Number(sender?.id ?? 0);
    if (hidden.has(id)) {
        return { id, name: '', avatarUrl: null };
    }
    const profile = sender?.profile ?? null;
    return {
        id,
        name: profile?.name ?? 'بدون نام',
        avatarUrl: (profile?.avatars ?? [])[0] ?? null,
    };
}

/**
 * Read model of the chat "shared content" tabs.
 *
 * Everything is paginated newest-first with a stable `(createdAt, id)` cursor
 * and filtered inside SQL by:
 *   - the caller's `clearedBeforeId` ("delete chat for me"),
 *   - `messages.isDeleted` (deleted for everyone),
 *   - the caller's chat membership (enforced by the WS guard before this runs).
 *
 * Sender details are blanked for users who blocked the viewer, matching the
 * message serializer.
 */
@Injectable()
export class MessageMediaService {
    constructor(
        @InjectDataSource()
        private readonly dataSource: DataSource,
        private readonly chats: ChatService,
        private readonly visibility: VisibilityService,
    ) {}

    async getPage(
        viewerId: UserId,
        chatId: ChatId,
        type: ChatMediaType,
        cursor?: string,
        limit: number = DEFAULT_CHAT_MEDIA_PAGE_SIZE,
    ): Promise<
        | SharedContentPage<SharedAttachmentItem>
        | SharedContentPage<SharedLinkItem>
    > {
        const pageSize = Math.min(Math.max(1, limit), MAX_CHAT_MEDIA_PAGE_SIZE);
        const clearedBefore =
            (await this.chats.getClearedBeforeId(chatId, viewerId)) ?? 0;
        const parsed = parseCursor(cursor);

        if (type === 'links') {
            return this.getLinksPage(
                viewerId,
                chatId,
                clearedBefore,
                parsed,
                pageSize,
            );
        }
        return this.getAttachmentsPage(
            viewerId,
            chatId,
            type,
            clearedBefore,
            parsed,
            pageSize,
        );
    }

    private async getAttachmentsPage(
        viewerId: UserId,
        chatId: ChatId,
        type: Exclude<ChatMediaType, 'links'>,
        clearedBefore: number,
        cursor: ParsedCursor | null,
        limit: number,
    ): Promise<SharedContentPage<SharedAttachmentItem>> {
        const repo = this.dataSource.getRepository(Attachment);
        const query = repo
            .createQueryBuilder('a')
            .innerJoinAndSelect('a.message', 'm')
            .innerJoinAndSelect('m.sender', 's')
            .leftJoinAndSelect('s.profile', 'sp')
            .innerJoin('a.chat', 'c')
            .where('c.id = :chatId', { chatId: Number(chatId) })
            .andWhere('m.isDeleted = false')
            .andWhere('m.id > :clearedBefore', { clearedBefore })
            .andWhere('a.status = :status', {
                status: AttachmentStatus.ATTACHED,
            });

        if (type === 'media') {
            query
                .andWhere('a.voice IS NOT TRUE')
                .andWhere('a.mimeType IN (:...mediaMimes)', {
                    mediaMimes: [...MEDIA_MIME_TYPES],
                });
        } else if (type === 'voice') {
            query.andWhere('a.voice = true');
        } else if (type === 'music') {
            query
                .andWhere('a.voice IS NOT TRUE')
                .andWhere('a.mimeType IN (:...musicMimes)', {
                    musicMimes: [...MUSIC_MIME_TYPES],
                });
        } else {
            query
                .andWhere('a.voice IS NOT TRUE')
                .andWhere('a.mimeType NOT IN (:...mediaMimes)', {
                    mediaMimes: [...MEDIA_MIME_TYPES],
                })
                .andWhere('a.mimeType NOT IN (:...musicMimes)', {
                    musicMimes: [...MUSIC_MIME_TYPES],
                });
        }

        if (
            cursor !== null &&
            cursor.attachmentId !== null &&
            !Number.isNaN(cursor.createdAt.getTime())
        ) {
            query.andWhere(
                '(m.createdAt, m.id, a.id) < (:cursorAt, :cursorId, :cursorAttachmentId)',
                {
                    cursorAt: cursor.createdAt,
                    cursorId: cursor.id,
                    cursorAttachmentId: cursor.attachmentId,
                },
            );
        }

        const rows = await query
            .orderBy('m.createdAt', 'DESC')
            .addOrderBy('m.id', 'DESC')
            .addOrderBy('a.id', 'DESC')
            .limit(limit + 1)
            .getMany();

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const pageMessages = page
            .map((attachment) => attachment.message)
            .filter((message): message is Message => message !== undefined);
        const hidden = await this.hiddenSenders(viewerId, pageMessages);

        const items: SharedAttachmentItem[] = page.map((attachment) => {
            // The query inner-joins the message, so it is always loaded.
            const message = attachment.message as Message;
            return {
                attachment: {
                    ...serializeAttachmentMeta(attachment),
                    kind: attachmentKindForTab(attachment),
                } as SharedAttachmentItem['attachment'],
                messageId: Number(message.id),
                sender: senderOf(message, hidden),
                createdAt: new Date(message.createdAt).toISOString(),
            };
        });

        const last = page[page.length - 1];
        return {
            items,
            nextCursor:
                hasMore && last !== undefined
                    ? encodeAttachmentCursor(
                          new Date((last.message as Message).createdAt),
                          Number((last.message as Message).id),
                          Number(last.id),
                      )
                    : null,
        };
    }

    private async getLinksPage(
        viewerId: UserId,
        chatId: ChatId,
        clearedBefore: number,
        cursor: ParsedCursor | null,
        limit: number,
    ): Promise<SharedContentPage<SharedLinkItem>> {
        const repo = this.dataSource.getRepository(MessageLink);
        const query = repo
            .createQueryBuilder('l')
            .innerJoinAndSelect('l.message', 'm')
            .innerJoinAndSelect('m.sender', 's')
            .leftJoinAndSelect('s.profile', 'sp')
            .innerJoin('l.chat', 'c')
            .where('c.id = :chatId', { chatId: Number(chatId) })
            .andWhere('m.isDeleted = false')
            .andWhere('m.id > :clearedBefore', { clearedBefore });

        if (cursor !== null && !Number.isNaN(cursor.createdAt.getTime())) {
            query.andWhere('(l.createdAt, l.id) < (:cursorAt, :cursorId)', {
                cursorAt: cursor.createdAt,
                cursorId: cursor.id,
            });
        }

        const rows = await query
            .orderBy('l.createdAt', 'DESC')
            .addOrderBy('l.id', 'DESC')
            .limit(limit + 1)
            .getMany();

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const hidden = await this.hiddenSenders(
            viewerId,
            page.map((link) => link.message),
        );

        const items: SharedLinkItem[] = page.map((link) => ({
            id: Number(link.id),
            messageId: Number(link.message.id),
            url: link.url,
            domain: link.domain,
            snippet: linkSnippet(link.message.content, link.domain),
            sender: senderOf(link.message, hidden),
            // Display the MESSAGE time so the month header matches the chat.
            createdAt: new Date(link.message.createdAt).toISOString(),
        }));

        const last = page[page.length - 1];
        return {
            items,
            nextCursor:
                hasMore && last !== undefined
                    ? encodeLinkCursor(
                          new Date(last.createdAt),
                          Number(last.id),
                      )
                    : null,
        };
    }

    /** One visibility query for the page's senders (never per row). */
    private async hiddenSenders(
        viewerId: UserId,
        messages: readonly Message[],
    ): Promise<ReadonlySet<number>> {
        const ids = messages
            .map((message) => Number(message.sender?.id ?? 0))
            .filter((id) => id > 0 && id !== Number(viewerId));
        if (ids.length === 0) return new Set();
        return this.visibility.blockersOfViewer(Number(viewerId), ids);
    }
}

/** Kind shown by the tab, derived from the same server allowlists. */
function attachmentKindForTab(attachment: Attachment): AttachmentKind {
    if (attachment.voice === true) return 'voice';
    const mime = (attachment.mimeType ?? '').toLowerCase();
    if (IMAGE_MIME_TYPES.includes(mime)) return 'image';
    if (VIDEO_MIME_TYPES.includes(mime)) return 'video';
    if (MUSIC_MIME_TYPES.includes(mime)) return 'music';
    return 'file';
}
