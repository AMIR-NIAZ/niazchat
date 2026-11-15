import type { QueryCacheNotifyEvent } from '@tanstack/react-query';
import type { ChatMessage } from '../../features/messages/messages-model';
import { appQueryClient } from '../../core/query/query-client';
import { getCurrentCacheUserId } from '../../core/query/query-persister';
import {
    MAX_CACHED_CHATS,
    MAX_MESSAGES_PER_CHAT,
    openUserDb,
    type UserDatabase,
} from './local-db';

/**
 * Write side of the message mirror: a debounced (500 ms) subscription to the
 * query cache. Only the `['messages', chatId]` entries are considered; each
 * flush writes every confirmed message of the affected chats in ONE
 * transaction and prunes to the retention limits.
 *
 * Pending/failed (id === null) and deleted messages are never written. Nothing
 * here touches the UI thread synchronously: cache events only mark a chat dirty
 * and arm a timer.
 */

const FLUSH_DELAY_MS = 500;

/** Structural shape of the conversation cache entry (avoids an import cycle). */
interface CachedConversation {
    messages: ChatMessage[];
}

interface MessageRowId {
    id: number;
}

let started = false;
let unsubscribe: (() => void) | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let dirtyChats = new Set<number>();
/** Ids last written per chat, used to detect deletions between flushes. */
const lastWrittenIds = new Map<number, Set<number>>();
/** Id range this session has actually seen per chat (deletion scope). */
const seenRanges = new Map<number, { min: number; max: number }>();

function chatIdOf(query: { queryKey: readonly unknown[] }): number | null {
    const key = query.queryKey;
    if (key.length !== 2 || key[0] !== 'messages') {
        return null;
    }
    const chatId = key[1];
    return typeof chatId === 'number' && Number.isFinite(chatId)
        ? chatId
        : null;
}

function armFlushTimer(): void {
    if (flushTimer !== null) {
        return;
    }
    flushTimer = setTimeout((): void => {
        flushTimer = null;
        void flush();
    }, FLUSH_DELAY_MS);
}

function scheduleFlush(chatId: number): void {
    dirtyChats.add(chatId);
    armFlushTimer();
}

function handleCacheEvent(event: QueryCacheNotifyEvent): void {
    if (event.type === 'removed') {
        return;
    }
    const chatId = chatIdOf(event.query);
    if (chatId !== null) {
        scheduleFlush(chatId);
    }
}

function isConfirmed(message: ChatMessage): boolean {
    return (
        message.id !== null && message.status === 'sent' && !message.isDeleted
    );
}

async function existingIds(
    db: UserDatabase,
    chatId: number,
): Promise<Set<number>> {
    const rows = await db.getAllAsync<MessageRowId>(
        'SELECT id FROM messages WHERE chatId = ?',
        chatId,
    );
    return new Set(rows.map((row) => row.id));
}

async function writeChat(
    db: UserDatabase,
    chatId: number,
    messages: ChatMessage[],
): Promise<void> {
    const confirmed = messages.filter(isConfirmed);
    const nextIds = new Set<number>(
        confirmed.map((message) => message.id as number),
    );

    let previous = lastWrittenIds.get(chatId);
    if (previous === undefined) {
        previous = await existingIds(db, chatId);
    }

    for (const message of confirmed) {
        await db.runAsync(
            'INSERT OR REPLACE INTO messages (chatId, id, createdAtIso, json) VALUES (?, ?, ?, ?)',
            chatId,
            message.id as number,
            message.createdAtIso,
            JSON.stringify(message),
        );
    }

    const ids = [...nextIds];
    // Only rows INSIDE the id range this session has seen can be declared
    // deleted: a cache holding the newest 50 of 200 saved rows says nothing
    // about the older 150. The range grows as pages load, so deleting the
    // oldest or newest loaded message still removes its row.
    if (ids.length > 0) {
        const previousRange = seenRanges.get(chatId);
        const minId = Math.min(previousRange?.min ?? ids[0]!, ...ids);
        const maxId = Math.max(
            previousRange?.max ?? ids[ids.length - 1]!,
            ...ids,
        );
        for (const id of previous) {
            if (!nextIds.has(id) && id >= minId && id <= maxId) {
                await db.runAsync(
                    'DELETE FROM messages WHERE chatId = ? AND id = ?',
                    chatId,
                    id,
                );
            }
        }
        seenRanges.set(chatId, { min: minId, max: maxId });
    }

    await db.runAsync(
        `DELETE FROM messages WHERE chatId = ? AND id NOT IN (
            SELECT id FROM messages WHERE chatId = ? ORDER BY id DESC LIMIT ?
        )`,
        chatId,
        chatId,
        MAX_MESSAGES_PER_CHAT,
    );

    if (ids.length === 0) {
        // The chat is genuinely empty (all confirmed messages deleted).
        await db.runAsync('DELETE FROM messages WHERE chatId = ?', chatId);
        await db.runAsync('DELETE FROM chat_sync WHERE chatId = ?', chatId);
        lastWrittenIds.set(chatId, nextIds);
        return;
    }

    await db.runAsync(
        `INSERT OR REPLACE INTO chat_sync (chatId, newestId, oldestId, updatedAt)
         VALUES (?, ?, ?, ?)`,
        chatId,
        Math.max(...ids),
        Math.min(...ids),
        new Date().toISOString(),
    );
    lastWrittenIds.set(chatId, nextIds);
}

/** Keeps the most recently written `MAX_CACHED_CHATS` chats only. */
async function pruneChats(db: UserDatabase): Promise<void> {
    const stale = await db.getAllAsync<{ chatId: number }>(
        'SELECT chatId FROM chat_sync ORDER BY updatedAt DESC LIMIT -1 OFFSET ?',
        MAX_CACHED_CHATS,
    );
    for (const row of stale) {
        await db.runAsync('DELETE FROM messages WHERE chatId = ?', row.chatId);
        await db.runAsync('DELETE FROM chat_sync WHERE chatId = ?', row.chatId);
        lastWrittenIds.delete(row.chatId);
        seenRanges.delete(row.chatId);
    }
}

async function flush(): Promise<void> {
    const userId = getCurrentCacheUserId();
    if (userId === null || dirtyChats.size === 0 || flushing) {
        return;
    }
    const chats = dirtyChats;
    dirtyChats = new Set<number>();
    flushing = true;

    let db: UserDatabase;
    try {
        db = await openUserDb(userId);
    } catch {
        flushing = false;
        return;
    }

    try {
        await db.withTransactionAsync(async (): Promise<void> => {
            for (const chatId of chats) {
                const detail = appQueryClient.getQueryData<CachedConversation>([
                    'messages',
                    chatId,
                ]);
                if (detail === undefined) {
                    continue;
                }
                await writeChat(db, chatId, detail.messages);
            }
            await pruneChats(db);
        });
    } catch {
        // Swallowed: the next cache event retries. Never surface to the UI.
    } finally {
        flushing = false;
    }

    // Events that arrived during the flush are written by the next pass.
    if (dirtyChats.size > 0) {
        armFlushTimer();
    }
}

/** Idempotent: subscribes once to the query cache. */
export function startMessagesMirror(): void {
    if (started) {
        return;
    }
    started = true;
    unsubscribe = appQueryClient.getQueryCache().subscribe(handleCacheEvent);
}

export function stopMessagesMirror(): void {
    unsubscribe?.();
    unsubscribe = null;
    started = false;
    resetMessagesMirrorState();
}

/**
 * Drops per-user write bookkeeping (logout / account switch) without stopping
 * the subscription: the mirror must keep working for the next user.
 */
export function resetMessagesMirrorState(): void {
    if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
    dirtyChats = new Set<number>();
    lastWrittenIds.clear();
    seenRanges.clear();
}
