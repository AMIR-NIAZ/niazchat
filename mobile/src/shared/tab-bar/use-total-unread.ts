import { useCallback, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CHATS_QUERY_KEY } from '../../features/chats/use-chats';
import type { ChatPreview } from '../../features/chats/chats-model';

/**
 * Total unread count straight from the chat-list cache (the same authoritative
 * `getAllChats` count every screen sees). Subscribing to the query cache means
 * the badge updates on live `chatlist:updated` events without polling and
 * without re-rendering the whole tab bar for unrelated cache writes: the
 * snapshot is a number, so React bails out when it is unchanged.
 */

function totalUnread(chats: ChatPreview[] | undefined): number {
    if (chats === undefined) {
        return 0;
    }
    let total = 0;
    for (const chat of chats) {
        total += Math.max(0, chat.unreadCount);
    }
    return total;
}

export function useTotalUnread(): number {
    const queryClient = useQueryClient();

    const subscribe = useCallback(
        (onChange: () => void): (() => void) =>
            queryClient.getQueryCache().subscribe(onChange),
        [queryClient],
    );

    const getSnapshot = useCallback(
        (): number =>
            totalUnread(
                queryClient.getQueryData<ChatPreview[]>(CHATS_QUERY_KEY),
            ),
        [queryClient],
    );

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
