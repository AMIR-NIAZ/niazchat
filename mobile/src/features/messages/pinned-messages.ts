import type { ChatMessage } from './messages-model';

/**
 * Pure helpers for the chat's pinned list and the banner.
 *
 * The server is authoritative: `getPinnedMessages` returns the full list on
 * open/reconnect, and `pinMessage:list` / `unpinMessage:list` keep it in sync
 * live. Every helper is idempotent (dedupe by message id), so an ack plus a
 * room echo for the same pin can never create two banner entries.
 */

/** Inserts/replaces one pinned message, newest pin first. */
export function upsertPinnedMessage(
    current: ChatMessage[],
    message: ChatMessage,
): ChatMessage[] {
    if (message.id === null) {
        return current;
    }
    const rest = current.filter((item) => item.id !== message.id);
    return [message, ...rest];
}

/** Removes one message from the pinned list (unpin or delete). */
export function removePinnedMessage(
    current: ChatMessage[],
    messageId: number | string | null | undefined,
): ChatMessage[] {
    const id = Number(messageId);
    if (!Number.isFinite(id)) {
        return current;
    }
    const next = current.filter((item) => item.id !== id);
    return next.length === current.length ? current : next;
}

/**
 * Applies a pin-state transition to the conversation list. Returns the SAME
 * array when nothing changed, so a duplicate event cannot re-render rows.
 */
export function applyPinnedState(
    current: ChatMessage[],
    messageId: number,
    isPinned: boolean,
    pinnedAtIso: string | null,
): ChatMessage[] {
    let changed = false;
    const next = current.map((message) => {
        if (message.id !== messageId) {
            return message;
        }
        if (
            message.isPinned === isPinned &&
            message.pinnedAtIso === pinnedAtIso
        ) {
            return message;
        }
        changed = true;
        return { ...message, isPinned, pinnedAtIso };
    });
    return changed ? next : current;
}

/** The edited copy of a pinned message keeps the pinned list preview fresh. */
export function replacePinnedMessage(
    current: ChatMessage[],
    updated: ChatMessage,
): ChatMessage[] {
    if (updated.id === null) {
        return current;
    }
    const index = current.findIndex((item) => item.id === updated.id);
    if (index < 0) {
        return current;
    }
    const next = [...current];
    next[index] = updated;
    return next;
}

/**
 * One-line banner preview: text when present, otherwise a label for the first
 * attachment (deleted pinned messages are never in the list).
 */
export function pinnedPreviewText(message: ChatMessage): string {
    const content = (message.content ?? '').trim();
    if (content !== '') {
        return content;
    }
    const attachment = message.attachments[0];
    if (attachment === undefined) {
        return 'Pinned message';
    }
    switch (attachment.kind) {
        case 'image':
            return 'Photo';
        case 'video':
            return 'Video';
        case 'voice':
            return 'Voice message';
        case 'music':
            return attachment.title ?? 'Audio';
        case 'file':
            return attachment.name;
    }
}
