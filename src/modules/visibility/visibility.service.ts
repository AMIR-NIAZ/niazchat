import {
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { ChatMember } from 'src/modules/chats/entities/chat_members.entity';
import { UserBlock } from 'src/modules/chats/entities/user_block.entity';

/** Generic 404 shared by "doesn't exist" and "hidden by a block". */
export const USER_NOT_AVAILABLE_MESSAGE = "This profile isn't available";

/** Clear 403 for a viewer banned from the group (they already know). */
export const GROUP_NOT_AVAILABLE_MESSAGE = "You can't access this group";

/** A block row between two members of the same chat. */
export interface ChatBlockRelation {
    blockerId: number;
    blockedId: number;
}

/**
 * Single source of truth for visibility decisions.
 *
 * - A user who was blocked by someone can no longer view that blocker's
 *   profile or details.
 * - A user banned from a group (`role_chat.name = 'ban'`) can no longer view
 *   that group's info, members, media or invite preview.
 *
 * Nothing is cached across requests. Every method is one indexed query
 * (`user_blocks` unique/lookup indexes, `chat_members` chat/user indexes), so
 * the guards and serializers can call it freely inside a request.
 */
@Injectable()
export class VisibilityService {
    constructor(
        @InjectRepository(UserBlock)
        private readonly blockRepository: Repository<UserBlock>,
        @InjectRepository(ChatMember)
        private readonly memberRepository: Repository<ChatMember>,
    ) {}

    /** True when `targetId` has blocked `viewerId`. */
    async isBlockedBy(viewerId: number, targetId: number): Promise<boolean> {
        if (this.sameUser(viewerId, targetId)) {
            return false;
        }
        const rows = await this.blockRepository.query<
            Array<{ exists: boolean }>
        >(
            `SELECT EXISTS (
                 SELECT 1 FROM user_blocks
                  WHERE "blockerId" = $1 AND "blockedId" = $2
             ) AS "exists"`,
            [Number(targetId), Number(viewerId)],
        );
        return rows[0]?.exists === true;
    }

    /** True when either direction exists between two users. */
    async isBlockedBetween(userA: number, userB: number): Promise<boolean> {
        if (this.sameUser(userA, userB)) {
            return false;
        }
        const rows = await this.blockRepository.query<
            Array<{ exists: boolean }>
        >(
            `SELECT EXISTS (
                 SELECT 1 FROM user_blocks
                  WHERE ("blockerId" = $1 AND "blockedId" = $2)
                     OR ("blockerId" = $2 AND "blockedId" = $1)
             ) AS "exists"`,
            [Number(userA), Number(userB)],
        );
        return rows[0]?.exists === true;
    }

    /**
     * The subset of `targetIds` with a block in EITHER direction with
     * `viewerId`, in ONE query. "Add members" uses it so a blocked pair is
     * never joined into the same group.
     */
    async blockedIdsBetween(
        viewerId: number,
        targetIds: readonly number[],
    ): Promise<Set<number>> {
        const ids = [
            ...new Set(
                targetIds
                    .map((id) => Number(id))
                    .filter(
                        (id) =>
                            Number.isInteger(id) &&
                            id > 0 &&
                            !this.sameUser(viewerId, id),
                    ),
            ),
        ];
        if (ids.length === 0) return new Set();
        const rows = await this.blockRepository.query<
            Array<{ otherId: string | number }>
        >(
            `SELECT CASE
                        WHEN "blockerId" = $1 THEN "blockedId"
                        ELSE "blockerId"
                    END AS "otherId"
               FROM user_blocks
              WHERE ("blockerId" = $1 AND "blockedId" = ANY($2::bigint[]))
                 OR ("blockedId" = $1 AND "blockerId" = ANY($2::bigint[]))`,
            [Number(viewerId), ids],
        );
        return new Set(rows.map((row) => Number(row.otherId)));
    }

    /**
     * The subset of `targetIds` that have blocked `viewerId`, in ONE query.
     * Used by list serializers (search results, members, peers) so a page
     * never runs a per-row visibility lookup.
     */
    async blockersOfViewer(
        viewerId: number,
        targetIds: readonly number[],
    ): Promise<Set<number>> {
        const ids = [
            ...new Set(
                targetIds
                    .map((id) => Number(id))
                    .filter(
                        (id) =>
                            Number.isInteger(id) &&
                            id > 0 &&
                            !this.sameUser(viewerId, id),
                    ),
            ),
        ];
        if (ids.length === 0) {
            return new Set();
        }
        const rows = await this.blockRepository.query<
            Array<{ blockerId: string | number }>
        >(
            `SELECT "blockerId" AS "blockerId"
               FROM user_blocks
              WHERE "blockedId" = $1
                AND "blockerId" = ANY($2::bigint[])`,
            [Number(viewerId), ids],
        );
        return new Set(rows.map((row) => Number(row.blockerId)));
    }

    /**
     * Every direction an existing `block` relation inside a chat: the sender
     * of a message from `blockerId` must be sanitized for `blockedId`. Only
     * rows whose two users are both members of THIS chat are returned, so the
     * realtime fan-out never has to load unrelated blocks.
     */
    async blockedRelationsInChat(chatId: number): Promise<ChatBlockRelation[]> {
        const rows = await this.blockRepository.query<
            Array<{ blockerId: string | number; blockedId: string | number }>
        >(
            `SELECT block."blockerId" AS "blockerId",
                    block."blockedId" AS "blockedId"
               FROM user_blocks block
               JOIN chat_members blocker_member
                 ON blocker_member."userId" = block."blockerId"
                AND blocker_member."chatId" = $1
               JOIN chat_members blocked_member
                 ON blocked_member."userId" = block."blockedId"
                AND blocked_member."chatId" = $1`,
            [Number(chatId)],
        );
        return rows.map((row) => ({
            blockerId: Number(row.blockerId),
            blockedId: Number(row.blockedId),
        }));
    }

    /** Ids whose details must be hidden from `viewerId`, from a relation list. */
    hiddenUserIdsFor(
        viewerId: number,
        relations: readonly ChatBlockRelation[],
    ): Set<number> {
        const hidden = new Set<number>();
        for (const relation of relations) {
            if (relation.blockedId === Number(viewerId)) {
                hidden.add(relation.blockerId);
            }
        }
        return hidden;
    }

    /** True when `viewerId` holds the `ban` role in `chatId`. */
    async isBannedFromChat(viewerId: number, chatId: number): Promise<boolean> {
        const rows = await this.memberRepository.query<
            Array<{ exists: boolean }>
        >(
            `SELECT EXISTS (
                 SELECT 1
                   FROM chat_members member
                   JOIN role_chat role ON role.id = member."roleId"
                  WHERE member."chatId" = $1
                    AND member."userId" = $2
                    AND role.name = $3
             ) AS "exists"`,
            [Number(chatId), Number(viewerId), RoleChatEnum.BAN],
        );
        return rows[0]?.exists === true;
    }

    /** A blocked user's profile (and every detail embedded in other DTOs). */
    async canViewUserProfile(
        viewerId: number,
        targetId: number,
    ): Promise<boolean> {
        if (this.sameUser(viewerId, targetId)) {
            return true;
        }
        return !(await this.isBlockedBy(viewerId, targetId));
    }

    /** A group's info/members/media/invite preview. */
    async canViewGroup(viewerId: number, chatId: number): Promise<boolean> {
        return !(await this.isBannedFromChat(viewerId, chatId));
    }

    /** Throws the shared non-probing 404 when the profile is hidden. */
    async assertCanViewUserProfile(
        viewerId: number,
        targetId: number,
    ): Promise<void> {
        if (!(await this.canViewUserProfile(viewerId, targetId))) {
            throw new NotFoundException(USER_NOT_AVAILABLE_MESSAGE);
        }
    }

    /** Throws the shared group 403 when the viewer is banned. */
    async assertCanViewGroup(viewerId: number, chatId: number): Promise<void> {
        if (!(await this.canViewGroup(viewerId, chatId))) {
            throw new ForbiddenException(GROUP_NOT_AVAILABLE_MESSAGE);
        }
    }

    private sameUser(left: number, right: number): boolean {
        return Number(left) === Number(right);
    }
}
