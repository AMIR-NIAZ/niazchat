import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { extractLinks } from 'src/common/utils/link-extractor.util';
import { MessageLink } from '../entities/message-link.entity';

/**
 * Keeps `message_links` in sync with message bodies.
 *
 * All writes are scoped to ONE message and replace its rows, so edits cannot
 * leave a stale URL behind. Creation and edit run inside the message's own
 * transaction when a manager is supplied (the default), and the backfill
 * script calls the same methods message-by-message.
 */
@Injectable()
export class MessageLinkService {
    constructor(
        @InjectRepository(MessageLink)
        private readonly repository: Repository<MessageLink>,
        @InjectDataSource()
        private readonly dataSource: DataSource,
    ) {}

    /**
     * Replaces the links of one message with the URLs currently in `content`.
     * Safe to call with the same content any number of times.
     */
    async syncForMessage(
        messageId: number,
        chatId: number,
        content: string | null | undefined,
        messageCreatedAt?: Date,
        manager?: EntityManager,
    ): Promise<void> {
        const repo = manager?.getRepository(MessageLink) ?? this.repository;
        const links = extractLinks(content);

        await this.deleteForMessage(repo, messageId);
        if (links.length === 0) {
            return;
        }

        const rows = links.map((link) => ({
            message: { id: messageId },
            chat: { id: chatId },
            url: link.url,
            domain: link.domain,
            // New messages: the DB default is effectively the same instant.
            // Backfill: explicit, so month grouping follows the message.
            ...(messageCreatedAt !== undefined
                ? { createdAt: messageCreatedAt }
                : {}),
        }));
        // `orIgnore` covers two identical links stored by a concurrent retry;
        // the (messageId, url) unique index is the final guard.
        await repo
            .createQueryBuilder()
            .insert()
            .into(MessageLink)
            .values(rows)
            .orIgnore()
            .execute();
    }

    /** Drops a message's links (soft delete / deleted for everyone). */
    async clearForMessage(
        messageId: number,
        manager?: EntityManager,
    ): Promise<void> {
        const repo = manager?.getRepository(MessageLink) ?? this.repository;
        await this.deleteForMessage(repo, messageId);
    }

    /** Explicit quoted FK column: safe across TypeORM versions. */
    private async deleteForMessage(
        repo: Repository<MessageLink>,
        messageId: number,
    ): Promise<void> {
        await repo
            .createQueryBuilder()
            .delete()
            .from(MessageLink)
            .where('"messageId" = :messageId', { messageId })
            .execute();
    }

    /**
     * Deletes the links of messages that are soft-deleted.
     *
     * Live deletion already calls `clearForMessage`; this exists for the
     * backfill script, which also heals rows deleted before the links table
     * existed. Returns the number of messages touched.
     */
    async clearDeletedForChat(chatId?: number): Promise<number> {
        const query = this.dataSource
            .createQueryBuilder()
            .delete()
            .from(MessageLink)
            .where(
                `"messageId" IN (
                    SELECT id FROM messages WHERE "isDeleted" = true${
                        chatId === undefined ? '' : ' AND "chatId" = :chatId'
                    }
                )`,
            );
        if (chatId !== undefined) {
            query.setParameter('chatId', chatId);
        }
        const result = await query.execute();
        return typeof result.affected === 'number' ? result.affected : 0;
    }
}
