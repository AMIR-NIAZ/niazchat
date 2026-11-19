import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { ChatId, UserId } from 'src/common/types/brands.type';
import { Chat } from '../entities/chat.entity';
import { ChatMember } from '../entities/chat_members.entity';
import { UserBlock } from '../entities/user_block.entity';
import { isUniqueViolation } from '../utils/private-chat.util';

/** Directional block state of a private conversation, as the caller sees it. */
export interface BlockState {
    /** The caller blocked the peer; the caller cannot send either. */
    blockedByMe: boolean;
    /** The peer blocked the caller; the caller cannot send. */
    blockedMe: boolean;
    /** Either direction: the conversation accepts no new messages. */
    blocked: boolean;
}

export interface BlockResult extends BlockState {
    chatId: number;
    peerId: number;
}

/**
 * Directional block list for private chats.
 *
 * Blocking is enforced server-side for EVERY write path (send, forward,
 * typing, auto-created direct chats) through `assertCanCommunicate` /
 * `isChatBlocked`, so a client cannot bypass it by calling the raw socket
 * events. Existing message history is never touched: blocking only stops NEW
 * messages.
 */
@Injectable()
export class UserBlockService {
    constructor(
        @InjectRepository(UserBlock)
        private readonly blockRepository: Repository<UserBlock>,
        @InjectRepository(Chat)
        private readonly chatRepository: Repository<Chat>,
        @InjectRepository(ChatMember)
        private readonly memberRepository: Repository<ChatMember>,
    ) {}

    /** Resolves the other participant of a private chat the caller belongs to. */
    async assertPrivateChatPeer(
        chatId: ChatId,
        callerId: UserId,
    ): Promise<{ chat: Chat; peerId: UserId }> {
        const chat = await this.chatRepository.findOne({
            where: { id: chatId },
            select: { id: true, type: true, isBan: true },
        });
        if (!chat) throw new NotFoundException('chat not found');
        if (chat.type !== TypeChatEnum.PRIVATE) {
            throw new BadRequestException(
                'This action is only available in private chats',
            );
        }

        const members = await this.memberRepository.find({
            where: { chat: { id: chatId } },
            relations: { user: true },
            select: { id: true, user: { id: true } },
        });
        const caller = members.find(
            (member) => Number(member.user?.id) === Number(callerId),
        );
        if (!caller) {
            throw new ForbiddenException('you are not a member of this chat');
        }
        const peer = members.find(
            (member) => Number(member.user?.id) !== Number(callerId),
        );
        if (!peer) throw new NotFoundException('peer not found');
        return { chat: chat, peerId: peer.user.id };
    }

    /** Block the peer of a private chat. Idempotent (duplicate = success). */
    async block(chatId: ChatId, callerId: UserId): Promise<BlockResult> {
        const { peerId } = await this.assertPrivateChatPeer(chatId, callerId);
        try {
            await this.blockRepository.insert({
                blocker: { id: callerId },
                blocked: { id: peerId },
            });
        } catch (error) {
            // A concurrent/repeated block is not an error.
            if (!isUniqueViolation(error)) throw error;
        }
        return {
            chatId: Number(chatId),
            peerId: Number(peerId),
            ...(await this.getBlockState(chatId, callerId)),
        };
    }

    /** Unblock the peer. Idempotent: no row means "already unblocked". */
    async unblock(chatId: ChatId, callerId: UserId): Promise<BlockResult> {
        const { peerId } = await this.assertPrivateChatPeer(chatId, callerId);
        await this.blockRepository.delete({
            blocker: { id: callerId },
            blocked: { id: peerId },
        });
        return {
            chatId: Number(chatId),
            peerId: Number(peerId),
            ...(await this.getBlockState(chatId, callerId)),
        };
    }

    /** Both directions for one private chat (unknown chats answer unblocked). */
    async getBlockState(chatId: ChatId, callerId: UserId): Promise<BlockState> {
        const member = await this.memberRepository.findOne({
            where: { chat: { id: chatId }, user: { id: callerId } },
            select: { id: true },
        });
        if (!member) {
            return { blockedByMe: false, blockedMe: false, blocked: false };
        }

        // One round trip: each direction is an EXISTS over the block rows whose
        // other side is a member of THIS chat (so unrelated blocks never leak).
        const rows = await this.blockRepository.query<
            Array<{ blockedByMe: boolean; blockedMe: boolean }>
        >(
            `SELECT
                 EXISTS (
                     SELECT 1 FROM user_blocks block
                       JOIN chat_members peer
                         ON peer."chatId" = $1
                        AND peer."userId" = block."blockedId"
                      WHERE block."blockerId" = $2
                 ) AS "blockedByMe",
                 EXISTS (
                     SELECT 1 FROM user_blocks block
                       JOIN chat_members peer
                         ON peer."chatId" = $1
                        AND peer."userId" = block."blockerId"
                      WHERE block."blockedId" = $2
                 ) AS "blockedMe"`,
            [Number(chatId), Number(callerId)],
        );

        const blockedByMe = rows[0]?.blockedByMe === true;
        const blockedMe = rows[0]?.blockedMe === true;
        return {
            blockedByMe,
            blockedMe,
            blocked: blockedByMe || blockedMe,
        };
    }

    /**
     * Block state for many private chats in ONE query (chat-list decoration).
     * The peer of each chat is its other member, so a block row is attributed
     * to exactly one chat of the caller.
     */
    async getBlockStates(
        chatIds: ChatId[],
        callerId: UserId,
    ): Promise<Map<string, BlockState>> {
        const states = new Map<string, BlockState>();
        if (chatIds.length === 0) return states;

        const rows = await this.blockRepository.query<
            Array<{
                chatId: string;
                blockedByMe: boolean;
                blockedMe: boolean;
            }>
        >(
            `SELECT peer."chatId" AS "chatId",
                    EXISTS (
                        SELECT 1 FROM user_blocks block
                         WHERE block."blockerId" = $2
                           AND block."blockedId" = peer."userId"
                    ) AS "blockedByMe",
                    EXISTS (
                        SELECT 1 FROM user_blocks block
                         WHERE block."blockedId" = $2
                           AND block."blockerId" = peer."userId"
                    ) AS "blockedMe"
               FROM chat_members peer
              WHERE peer."chatId" = ANY($1::bigint[])
                AND peer."userId" <> $2`,
            [chatIds.map(Number), Number(callerId)],
        );

        for (const row of rows) {
            const blockedByMe = row.blockedByMe === true;
            const blockedMe = row.blockedMe === true;
            states.set(String(row.chatId), {
                blockedByMe,
                blockedMe,
                blocked: blockedByMe || blockedMe,
            });
        }
        return states;
    }

    /** True when EITHER direction exists between two users. */
    async isBlockedBetween(userA: number, userB: number): Promise<boolean> {
        if (Number(userA) === Number(userB)) return false;
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
     * True when any block row connects two members of this chat. One SQL
     * statement, so it is safe to call on every message/typing event.
     */
    async isChatBlocked(chatId: ChatId): Promise<boolean> {
        const rows = await this.blockRepository.query<
            Array<{ exists: boolean }>
        >(
            `SELECT EXISTS (
                 SELECT 1
                   FROM user_blocks block
                   JOIN chat_members blocker_member
                     ON blocker_member."userId" = block."blockerId"
                    AND blocker_member."chatId" = $1
                   JOIN chat_members blocked_member
                     ON blocked_member."userId" = block."blockedId"
                    AND blocked_member."chatId" = $1
             ) AS "exists"`,
            [Number(chatId)],
        );
        return rows[0]?.exists === true;
    }

    /**
     * Write-path guard for an EXISTING chat. Only private chats can be blocked;
     * groups never look at `user_blocks`.
     */
    async assertCanCommunicate(
        chatId: ChatId,
        senderId: UserId,
    ): Promise<void> {
        const chat = await this.chatRepository.findOne({
            where: { id: chatId },
            select: { id: true, type: true },
        });
        if (!chat || chat.type !== TypeChatEnum.PRIVATE) return;

        const state = await this.getBlockState(chatId, senderId);
        if (state.blockedByMe) {
            throw new ForbiddenException(
                'You blocked this user. Unblock them to send messages.',
            );
        }
        if (state.blockedMe) {
            throw new ForbiddenException(
                'You cannot send messages to this user.',
            );
        }
    }

    /** Guard for the user-id send path, before a chat is (re)created. */
    async assertCanMessageUser(
        senderId: UserId,
        peerId: UserId,
    ): Promise<void> {
        if (await this.isBlockedBetween(senderId, peerId)) {
            throw new ForbiddenException(
                'You cannot send messages to this user.',
            );
        }
    }
}
