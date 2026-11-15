import type { ChatMessage } from '../../features/messages/messages-model';
import { MESSAGES_PAGE_SIZE } from '../../features/chats/chats-socket-api';
import { openUserDb, type UserDatabase } from './local-db';

/**
 * Read side of the SQLite message mirror. Rows hold the serialized domain
 * `ChatMessage` (numeric ids, `status: 'sent'`); every read is defensive: a
 * corrupt row is skipped and a failure returns an empty list so the caller
 * falls back to the network.
 */

interface MessageRow {
    id: number;
    json: string;
}

function parseRow(row: MessageRow): ChatMessage | null {
    try {
        const parsed: unknown = JSON.parse(row.json);
        if (parsed === null || typeof parsed !== 'object') {
            return null;
        }
        const message = parsed as ChatMessage;
        if (
            typeof message.id !== 'number' ||
            !Number.isFinite(message.id) ||
            message.id !== row.id ||
            message.status !== 'sent' ||
            typeof message.key !== 'string' ||
            typeof message.senderId !== 'number'
        ) {
            return null;
        }
        return message;
    } catch {
        return null;
    }
}

async function loadMessages(
    userId: number,
    chatId: number,
    limit: number,
    beforeId?: number,
): Promise<ChatMessage[]> {
    let db: UserDatabase;
    try {
        db = await openUserDb(userId);
    } catch {
        return [];
    }
    try {
        const rows =
            beforeId === undefined
                ? await db.getAllAsync<MessageRow>(
                      'SELECT id, json FROM messages WHERE chatId = ? ORDER BY id DESC LIMIT ?',
                      chatId,
                      limit,
                  )
                : await db.getAllAsync<MessageRow>(
                      'SELECT id, json FROM messages WHERE chatId = ? AND id < ? ORDER BY id DESC LIMIT ?',
                      chatId,
                      beforeId,
                      limit,
                  );
        const messages: ChatMessage[] = [];
        for (const row of rows) {
            const message = parseRow(row);
            if (message !== null) {
                messages.push(message);
            }
        }
        // Query is DESC (newest first); the cache contract is ascending.
        return messages.reverse();
    } catch {
        return [];
    }
}

/** Latest local messages for a chat, ascending (oldest → newest). */
export function loadLatestLocalMessages(
    userId: number,
    chatId: number,
    limit = 50,
): Promise<ChatMessage[]> {
    return loadMessages(userId, chatId, limit);
}

/** One older local page for `id < beforeId`, ascending. */
export function loadOlderLocalMessages(
    userId: number,
    chatId: number,
    beforeId: number,
    limit = MESSAGES_PAGE_SIZE,
): Promise<ChatMessage[]> {
    return loadMessages(userId, chatId, limit, beforeId);
}
