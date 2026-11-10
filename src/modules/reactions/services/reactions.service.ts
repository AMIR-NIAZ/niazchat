import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateReactDto } from '../dto/create-react.dto';
import { Repository } from 'typeorm';
import { React } from '../entities/react.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { UpdateReactDto } from '../dto/update-react.dto';
import { MessageReact } from '../entities/message_react.entity';
import { ReactMessageDto } from '../dto/reaction.dto';
import { Message } from 'src/modules/messages/entities/message.entity';
import { JwtPayload } from 'src/common/types/jwt-payload.type';
import { WsException } from '@nestjs/websockets';
import { RateLimitService } from 'src/common/services/rate-limit.service';
import {
    MessageReactionSummary,
    ReactionEntry,
    ReactionGroup,
    ReactionSnapshot,
    ReactionSnapshotForViewer,
    ReactionState,
    ReactionToggleResult,
} from '../reaction.types';

const REACTION_RATE_LIMIT = 60;
const REACTION_RATE_WINDOW_SECONDS = 60;
const REACTION_RATE_MESSAGE = 'Too many reactions. Try again in a minute.';
const REACTOR_LIMIT = 100;

/** Viewer-neutral state → public snapshot; adds the recipient's own reaction. */
export function reactionSnapshotForViewer(
    state: ReactionState,
    userId: number | undefined,
): ReactionSnapshotForViewer {
    const viewerId = userId === undefined ? undefined : Number(userId);
    const mine =
        viewerId === undefined || !Number.isFinite(viewerId)
            ? undefined
            : state.reactions.find((entry) =>
                  entry.userIds.includes(viewerId),
              );
    return {
        chatId: state.chatId,
        messageId: state.messageId,
        // `userIds` must never reach a room broadcast: it reveals every reactor.
        reactions: state.reactions.map(({ reactId, emoji, count }) => ({
            reactId,
            emoji,
            count,
        })),
        myReaction: mine?.emoji ?? null,
        actor: state.actor,
    };
}

@Injectable()
export class ReactionsService {
    /** Per user+message serialization keeps one-row semantics under bursts. */
    private readonly locks = new Map<string, Promise<unknown>>();

    constructor(
        @InjectRepository(React)
        private readonly reactRepository: Repository<React>,
        @InjectRepository(MessageReact)
        private readonly messageReactRepository: Repository<MessageReact>,
        @InjectRepository(Message)
        private readonly messageRepository: Repository<Message>,
        private readonly rateLimit: RateLimitService,
    ) {}

    async create(dto: CreateReactDto) {
        const { name, emoji } = dto;
        await this.reactRepository.save({ name, emoji });

        return { message: 'react creacted successfully' };
    }

    async findAll() {
        return await this.reactRepository.find({});
    }

    async update(dto: UpdateReactDto, id: number) {
        const react = await this.reactRepository.findOne({ where: { id } });
        if (!react) throw new NotFoundException('react not found');

        const statusUpdate = await this.reactRepository.update(id, dto);
        return { message: `react updated is ${statusUpdate.affected}` };
    }

    async remove(id: number) {
        const react = await this.reactRepository.findOne({ where: { id } });
        if (!react) throw new NotFoundException('react not found');

        await this.reactRepository.delete(id);
        return { message: `This action removes a #${id} react` };
    }

    /**
     * One reaction per user per message:
     * - same emoji again, or `null` → remove it;
     * - a different emoji → switch the existing row;
     * - no row yet → insert.
     */
    async toggle(
        dto: ReactMessageDto,
        user: JwtPayload,
    ): Promise<ReactionToggleResult> {
        const userId = user.sub;
        await this.rateLimit.consume(
            `reaction:user:${userId}`,
            REACTION_RATE_LIMIT,
            REACTION_RATE_WINDOW_SECONDS,
            REACTION_RATE_MESSAGE,
        );

        const key = `${userId}:${dto.messageId}`;
        return this.withLock(key, async () => {
            const chatId = dto.chatId;
            const messageId = dto.messageId;
            const emoji = dto.emoji ?? null;

            const message = await this.messageRepository.findOne({
                where: {
                    id: messageId,
                    chat: { id: chatId },
                    isDeleted: false,
                },
            });
            if (!message) throw new WsException('message not found');

            const existing = await this.messageReactRepository.findOne({
                where: {
                    message: { id: messageId },
                    user: { id: userId },
                },
                relations: { react: true },
            });

            let selected: React | null = null;
            if (emoji !== null) {
                selected = await this.reactRepository.findOne({
                    where: { emoji },
                });
                if (!selected) throw new WsException('react not found');
            }

            // `actor.emoji` reports what the caller now has: null after removal.
            let actorEmoji: string | null = null;
            let changed = false;
            if (
                selected === null ||
                (existing !== null &&
                    Number(existing.react?.id) === Number(selected.id))
            ) {
                if (existing !== null) {
                    await this.messageReactRepository.delete(existing.id);
                    changed = true;
                }
            } else if (existing !== null) {
                await this.messageReactRepository.update(existing.id, {
                    react: { id: selected.id },
                });
                actorEmoji = selected.emoji;
                changed = true;
            } else {
                await this.messageReactRepository.save({
                    message: { id: messageId },
                    react: { id: selected.id },
                    user: { id: userId },
                });
                actorEmoji = selected.emoji;
                changed = true;
            }

            const rows = await this.messageReactRepository.find({
                where: { message: { id: messageId } },
                relations: { user: true, react: true },
                order: { id: 'ASC' },
            });

            return {
                ...this.buildState(Number(chatId), Number(messageId), rows, {
                    userId: Number(userId),
                    emoji: actorEmoji,
                }),
                changed,
            };
        });
    }

    /**
     * ONE grouped query for a whole message page. Order: count DESC, then the
     * seeded reaction order (`reacts.id`), so every client renders identically.
     */
    async summariesFor(
        messageIds: number[],
    ): Promise<Map<number, MessageReactionSummary[]>> {
        const result = new Map<number, MessageReactionSummary[]>();
        const ids = messageIds.filter((id) => Number.isFinite(id));
        if (ids.length === 0) {
            return result;
        }

        const rows = await this.messageReactRepository
            .createQueryBuilder('mr')
            .innerJoin('mr.react', 'react')
            .select('mr.messageId', 'messageId')
            .addSelect('react.id', 'reactId')
            .addSelect('react.emoji', 'emoji')
            .addSelect('COUNT(*)', 'count')
            .where('mr.messageId IN (:...ids)', { ids })
            .groupBy('mr.messageId')
            .addGroupBy('react.id')
            .addGroupBy('react.emoji')
            .orderBy('mr.messageId', 'ASC')
            .addOrderBy('count', 'DESC')
            .addOrderBy('react.id', 'ASC')
            .getRawMany<{
                messageId: string;
                reactId: string;
                emoji: string;
                count: string;
            }>();

        for (const row of rows) {
            const messageId = Number(row.messageId);
            const list = result.get(messageId) ?? [];
            list.push({ emoji: row.emoji, count: Number(row.count) });
            result.set(messageId, list);
        }
        return result;
    }

    /** ONE extra query for the page: the viewer's own emoji per message. */
    async myReactionsFor(
        messageIds: number[],
        userId: number | undefined,
    ): Promise<Map<number, string>> {
        const result = new Map<number, string>();
        const ids = messageIds.filter((id) => Number.isFinite(id));
        if (ids.length === 0 || userId === undefined) {
            return result;
        }

        const rows = await this.messageReactRepository
            .createQueryBuilder('mr')
            .innerJoin('mr.react', 'react')
            .select('mr.messageId', 'messageId')
            .addSelect('react.emoji', 'emoji')
            .where('mr.userId = :userId', { userId })
            .andWhere('mr.messageId IN (:...ids)', { ids })
            .getRawMany<{ messageId: string; emoji: string }>();

        for (const row of rows) {
            result.set(Number(row.messageId), row.emoji);
        }
        return result;
    }

    /**
     * Grouped reactor list for the detail sheet. At most 100 users overall,
     * newest reactions first; profiles are joined in this one query and only
     * the public avatar/name/username projection is serialized.
     */
    async reactorsFor(chatId: number, messageId: number): Promise<ReactionGroup[]> {
        const message = await this.messageRepository.findOne({
            where: {
                id: messageId as never,
                chat: { id: chatId as never },
                isDeleted: false,
            },
            select: { id: true },
        });
        if (!message) throw new WsException('message not found');

        const rows = await this.messageReactRepository.find({
            where: { message: { id: messageId } },
            relations: { user: { profile: true }, react: true },
            order: { id: 'DESC' },
            take: REACTOR_LIMIT,
            select: {
                id: true,
                user: {
                    id: true,
                    profile: {
                        id: true,
                        name: true,
                        username: true,
                        avatars: true,
                    },
                },
                react: { id: true, emoji: true },
            },
        });

        const groups = new Map<
            number,
            { emoji: string; count: number; users: ReactionGroup['users'] }
        >();
        const seen = new Set<number>();

        for (const row of rows) {
            if (
                row.user?.id === undefined ||
                row.user?.id === null ||
                row.react?.id === undefined ||
                row.react?.id === null
            ) {
                continue;
            }
            if (seen.size >= REACTOR_LIMIT) {
                break;
            }
            const memberId = Number(row.user.id);
            if (seen.has(memberId)) {
                continue;
            }
            seen.add(memberId);

            const reactId = Number(row.react.id);
            const group = groups.get(reactId) ?? {
                emoji: row.react.emoji,
                count: 0,
                users: [],
            };
            const current = row.user.profile?.avatars?.[0];
            group.users.push({
                userId: memberId,
                name: row.user.profile?.name ?? '',
                username: row.user.profile?.username ?? null,
                avatars: current === undefined ? [] : [current],
            });
            group.count = group.users.length;
            groups.set(reactId, group);
        }

        return [...groups.entries()]
            .sort(([leftId, left], [rightId, right]) =>
                right.count === left.count
                    ? leftId - rightId
                    : right.count - left.count,
            )
            .map(([, group]) => group);
    }

    /** Soft-deleted messages keep no reaction rows behind. */
    async clearForMessage(messageId: number): Promise<void> {
        await this.messageReactRepository.delete({
            message: { id: messageId as never },
        });
    }

    private async withLock<T>(key: string, run: () => Promise<T>): Promise<T> {
        const previous = this.locks.get(key) ?? Promise.resolve();
        const current = previous
            .catch((): void => undefined)
            .then(run);
        this.locks.set(key, current);
        try {
            return await current;
        } finally {
            if (this.locks.get(key) === current) {
                this.locks.delete(key);
            }
        }
    }

    private buildState(
        chatId: number,
        messageId: number,
        rows: MessageReact[],
        actor: ReactionState['actor'],
    ): ReactionState {
        const byReact = new Map<number, ReactionEntry>();

        for (const row of rows) {
            if (
                row.react?.id === undefined ||
                row.react?.id === null ||
                row.user?.id === undefined ||
                row.user?.id === null
            ) {
                continue;
            }
            const reactId = Number(row.react.id);
            const memberId = Number(row.user.id);
            const entry = byReact.get(reactId) ?? {
                reactId,
                emoji: row.react.emoji,
                count: 0,
                userIds: [],
            };
            entry.count += 1;
            if (!entry.userIds.includes(memberId)) {
                entry.userIds.push(memberId);
            }
            byReact.set(reactId, entry);
        }

        return {
            chatId,
            messageId,
            reactions: [...byReact.values()].sort((a, b) => {
                if (a.count !== b.count) return b.count - a.count;
                return a.reactId - b.reactId;
            }),
            actor,
        };
    }
}
