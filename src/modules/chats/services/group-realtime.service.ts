import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { ChatId, UserId } from 'src/common/types/brands.type';
import { chatRoom, userRoom } from 'src/common/utils/roomCreator.utils';
import { num } from 'src/common/utils/ws-serializer.utils';

/**
 * Realtime fan-out for group-management changes, shared by REST controllers
 * (REST side removes users from rooms directly) and the WS gateway.
 *
 * Contract (docs/mobile-api/websocket-contract.md):
 *   - `group:changed { chatId, reason, userId? }` → `chat:<id>` room
 *   - `group:updated { chatId, title, avatars }`  → each member's `user:<id>`
 *   - `group:removed { chatId, reason }`  → the removed user's `user:<id>` room,
 *     and all their sockets are force-removed from the `chat:<id>` room
 *   - `group:added { chatId }`            → the added user's `user:<id>` room
 *   - `chat:members { chatId, membersCount }` → `chat:<id>` room after a
 *     membership change (count excludes banned members).
 */
@Injectable()
export class GroupRealtimeService {
    private readonly logger = new Logger(GroupRealtimeService.name);
    private server: Server | null = null;

    /** Wired by the chat gateway once the socket.io server is initialized. */
    setServer(server: Server): void {
        this.server = server;
    }

    groupChanged(chatId: unknown, reason: string, userId?: unknown): void {
        if (!this.server) return;
        this.server.to(chatRoom(chatId as ChatId)).emit('group:changed', {
            chatId: num(chatId),
            reason,
            ...(userId !== undefined ? { userId: num(userId) } : {}),
        });
    }

    groupRemoved(chatId: unknown, userId: unknown, reason: string): void {
        if (!this.server) return;
        this.server.to(userRoom(userId as UserId)).emit('group:removed', {
            chatId: num(chatId),
            reason,
        });
        // Kick every socket of that user out of the chat room (they may have
        // multiple devices/web views inside it) — including stale ones.
        this.server
            .in(userRoom(userId as UserId))
            .socketsLeave(chatRoom(chatId as ChatId));
    }

    /**
     * A role change committed: `group:changed` with the affected user so every
     * open group screen can refresh just that row (and the role matrix).
     */
    memberRoleChanged(chatId: unknown, userId: unknown): void {
        if (!this.server) return;
        this.server.to(chatRoom(chatId as ChatId)).emit('group:changed', {
            chatId: num(chatId),
            reason: 'role_changed',
            userId: num(userId),
        });
    }

    /**
     * The group photo set committed a change: `group:changed` with
     * `reason: 'avatars_changed'` so every open group/chat screen refreshes.
     */
    groupAvatarsChanged(chatId: unknown, userId: unknown): void {
        if (!this.server) return;
        this.server.to(chatRoom(chatId as ChatId)).emit('group:changed', {
            chatId: num(chatId),
            reason: 'avatars_changed',
            userId: num(userId),
        });
    }

    /** The group title/description/photo committed a change. */
    groupInfoChanged(chatId: unknown, userId: unknown): void {
        if (!this.server) return;
        this.server.to(chatRoom(chatId as ChatId)).emit('group:changed', {
            chatId: num(chatId),
            reason: 'info_changed',
            userId: num(userId),
        });
    }

    /**
     * Group title/photo changed: one `group:updated` to every member's personal
     * room so chat lists (and open chats) refresh without a full refetch.
     */
    groupUpdated(
        chatId: unknown,
        title: string,
        avatars: string[],
        userIds: number[],
    ): void {
        if (!this.server) return;
        const payload = { chatId: num(chatId), title, avatars };
        for (const userId of userIds) {
            this.server
                .to(userRoom(userId as UserId))
                .emit('group:updated', payload);
        }
    }

    /** An owner replaced an admin's permission set. */
    memberPermissionsChanged(chatId: unknown, userId: unknown): void {
        if (!this.server) return;
        this.server.to(chatRoom(chatId as ChatId)).emit('group:changed', {
            chatId: num(chatId),
            reason: 'permissions_changed',
            userId: num(userId),
        });
    }

    /**
     * A member was REMOVED (not banned). Delivers `group:removed` to every
     * socket of that user, force-leaves the chat room, clears the socket's
     * current-chat marker, stops their typing state and refreshes the online
     * count for the room. Fire-and-forget; failures never affect the HTTP reply.
     */
    async memberRemoved(chatId: unknown, userId: unknown): Promise<void> {
        if (!this.server) return;
        const chat = chatRoom(chatId as ChatId);
        const personal = userRoom(userId as UserId);

        this.server.to(personal).emit('group:removed', {
            chatId: num(chatId),
            reason: 'kicked',
        });

        try {
            const personalSockets = await this.server
                .in(personal)
                .fetchSockets();
            for (const socket of personalSockets) {
                const data = socket.data as {
                    chatId?: unknown;
                    chatType?: unknown;
                    userName?: string;
                    typingAt?: unknown;
                    typingChatId?: unknown;
                };
                if (Number(data.chatId) !== Number(chatId)) continue;
                this.server.to(chat).emit('typing:stop', {
                    chatId: num(chatId),
                    userId: num(userId),
                    userName: data.userName ?? '',
                });
                data.chatId = undefined;
                data.chatType = undefined;
                data.typingAt = undefined;
                data.typingChatId = undefined;
            }
        } catch {
            // Presence bookkeeping is best effort.
        }

        this.server.in(personal).socketsLeave(chat);
        this.server.to(chat).emit('group:changed', {
            chatId: num(chatId),
            reason: 'member_removed',
            userId: num(userId),
        });

        try {
            const remaining = await this.server.in(chat).fetchSockets();
            const online = new Set(
                remaining.map(
                    (socket) =>
                        (socket.data as { user?: { sub?: unknown } }).user?.sub,
                ),
            ).size;
            this.server.to(chat).emit('countUsersOnline', online);
        } catch {
            // Best effort.
        }
    }

    groupAdded(chatId: unknown, userId: unknown): void {
        if (!this.server) return;
        this.server
            .to(userRoom(userId as UserId))
            .emit('group:added', { chatId: num(chatId) });
    }

    /** Live member count for everyone currently in the chat room. */
    membersCountChanged(chatId: unknown, membersCount: number): void {
        if (!this.server) return;
        this.server.to(chatRoom(chatId as ChatId)).emit('chat:members', {
            chatId: num(chatId),
            membersCount,
        });
    }

    /** Best-effort wrapper so a realtime failure never breaks the mutation. */
    safeNotify(chatId: ChatId, run: () => void): void {
        try {
            run();
        } catch (error) {
            this.logger.warn(`group notify failed: ${String(error)}`);
        }
    }
}
