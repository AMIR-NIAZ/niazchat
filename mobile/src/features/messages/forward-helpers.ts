import type { ChatPreview } from '../chats/chats-model';
import type {
    ForwardMessagesResultDto,
    ForwardTargetResultDto,
} from '../../core/api/dto/message.dto';
import type { ChatMessage } from './messages-model';

export const MAX_FORWARD_MESSAGES = 20;
export const MAX_FORWARD_TARGETS = 5;

export function isForwardable(message: ChatMessage): boolean {
    return (
        message.status === 'sent' && message.id !== null && !message.isDeleted
    );
}

export function toggleForwardSelection(
    selected: ReadonlySet<number>,
    message: ChatMessage,
): { selected: Set<number>; limitReached: boolean } {
    const next = new Set(selected);
    if (message.id === null) {
        return { selected: next, limitReached: false };
    }
    if (next.has(message.id)) {
        next.delete(message.id);
        return { selected: next, limitReached: false };
    }
    if (!isForwardable(message)) {
        return { selected: next, limitReached: false };
    }
    if (next.size >= MAX_FORWARD_MESSAGES) {
        return { selected: next, limitReached: true };
    }
    next.add(message.id);
    return { selected: next, limitReached: false };
}

/** Drops selected ids that disappeared (deleted / removed by a refresh). */
export function pruneForwardSelection(
    selected: ReadonlySet<number>,
    messages: ChatMessage[],
): Set<number> {
    const live = new Set(
        messages
            .filter((message) => isForwardable(message))
            .map((message) => message.id as number),
    );
    return new Set([...selected].filter((id) => live.has(id)));
}

/** Selection order is ascending by message id; forwarding preserves it. */
export function selectedMessageIds(selected: ReadonlySet<number>): number[] {
    return [...selected].sort((a, b) => a - b);
}

export function chatForwardLabel(chat: ChatPreview): string {
    if (chat.title !== null && chat.title.trim() !== '') {
        return chat.title;
    }
    if (chat.type === 'private') {
        return chat.peerName !== undefined &&
            chat.peerName !== null &&
            chat.peerName.trim() !== ''
            ? chat.peerName
            : 'Private chat';
    }
    return 'Untitled chat';
}

export function filterForwardChats(
    chats: ChatPreview[],
    query: string,
): ChatPreview[] {
    const q = query.trim().toLowerCase();
    if (q === '') {
        return chats;
    }
    return chats.filter((chat) => {
        const label = chatForwardLabel(chat).toLowerCase();
        const preview = chat.lastMessage?.content.toLowerCase() ?? '';
        return label.includes(q) || preview.includes(q);
    });
}

export function toggleTarget(
    selected: ReadonlySet<number>,
    chatId: number,
): { selected: Set<number>; limitReached: boolean } {
    const next = new Set(selected);
    if (next.has(chatId)) {
        next.delete(chatId);
        return { selected: next, limitReached: false };
    }
    if (next.size >= MAX_FORWARD_TARGETS) {
        return { selected: next, limitReached: true };
    }
    next.add(chatId);
    return { selected: next, limitReached: false };
}

export function failedTargetIds(result: ForwardMessagesResultDto): number[] {
    return result.results
        .filter(
            (row): row is Extract<ForwardTargetResultDto, { ok: false }> =>
                !row.ok,
        )
        .map((row) => row.chatId);
}

export function successfulTargetCount(
    result: ForwardMessagesResultDto,
): number {
    return result.results.filter((row) => row.ok).length;
}

export function mergeForwardResults(
    previous: ForwardMessagesResultDto | null,
    next: ForwardMessagesResultDto,
): ForwardMessagesResultDto {
    const byChat = new Map<number, ForwardTargetResultDto>();
    for (const row of previous?.results ?? []) {
        byChat.set(row.chatId, row);
    }
    for (const row of next.results) {
        byChat.set(row.chatId, row);
    }
    return { results: [...byChat.values()] };
}

export function forwardRequestId(): string {
    const random = Math.random().toString(36).slice(2, 10);
    return `fwd_${Date.now().toString(36)}_${random}`;
}
