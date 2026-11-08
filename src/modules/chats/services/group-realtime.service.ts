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
 *   - `group:changed { chatId, reason }`  → `chat:<id>` room
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

    groupChanged(chatId: unknown, reason: string): void {
        if (!this.server) return;
        this.server.to(chatRoom(chatId as ChatId)).emit('group:changed', {
            chatId: num(chatId),
            reason,
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
