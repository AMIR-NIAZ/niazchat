import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { fetchChats } from './chats-socket-api';
import {
    toChatPreview,
    lastMessageFromUpdate,
    sortChatsByActivity,
} from './chats-mapper';
import type { ChatPreview } from './chats-model';
import { getActiveChat } from './active-chat';
import { onSocketReconnect, useSocketEvent } from '../../core/socket';
import type { ChatListUpdateDto } from '../../core/api/dto/message.dto';
import { useCurrentUserId } from '../auth';
import { isOwnMessage } from '../messages/messages-model';

/**
 * Chat-list server state over TanStack Query, backed by the acked WS request
 * `getAllChats`, live-updated by `chatlist:updated` (delivered to each member's
 * personal `user:<id>` room). `getAllChats` is authoritative for unread counts;
 * live events only bump a local estimate, which is replaced on focus/reconnect.
 */

export const CHATS_QUERY_KEY = ['chats'] as const;
export const CHATS_STALE_TIME_MS = 30_000;

export async function invalidateChats(queryClient: QueryClient): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: CHATS_QUERY_KEY });
}

export function setChatsQueryData(
    queryClient: QueryClient,
    chats: ChatPreview[],
): void {
    queryClient.setQueryData<ChatPreview[]>(CHATS_QUERY_KEY, chats);
}

/** Replace one row's badge without refetching or re-ordering the list. */
export function setChatUnreadCount(
    queryClient: QueryClient,
    chatId: number,
    unreadCount: number,
): void {
    const current =
        queryClient.getQueryData<ChatPreview[]>(CHATS_QUERY_KEY) ?? null;
    if (current === null) {
        return;
    }
    queryClient.setQueryData<ChatPreview[]>(
        CHATS_QUERY_KEY,
        current.map((chat) =>
            Number(chat.id) === chatId ? { ...chat, unreadCount } : chat,
        ),
    );
}

export function useChats(): ReturnType<typeof useQuery<ChatPreview[]>> {
    const queryClient = useQueryClient();
    const myId = useCurrentUserId();

    const query = useQuery<ChatPreview[]>({
        queryKey: CHATS_QUERY_KEY,
        staleTime: CHATS_STALE_TIME_MS,
        queryFn: async (): Promise<ChatPreview[]> => {
            const raw = await fetchChats();
            return sortChatsByActivity(
                (raw ?? []).map((chat) => toChatPreview(chat)),
            );
        },
    });

    // Merge live previews and bump the local unread estimate: only when the
    // message is not mine AND this chat is not being read on screen.
    // useSocketEvent moves the subscription to a replaced socket instance.
    const handler = (update: ChatListUpdateDto): void => {
        const current =
            queryClient.getQueryData<ChatPreview[]>(CHATS_QUERY_KEY) ?? [];
        const chatId = Number(update.chatId);
        // Unknown chat (added to a new group / new conversation): the row
        // cannot be patched locally — refetch the full list instead.
        if (!current.some((chat) => Number(chat.id) === chatId)) {
            void invalidateChats(queryClient);
            return;
        }
        const active = getActiveChat();
        const isMine =
            update.lastMessage !== null &&
            isOwnMessage(myId, update.lastMessage.senderId);
        const isReadingHere = active.chatId === chatId && active.reading;

        // New array + new objects (never mutate the cache) + re-sort, so
        // the chat with the newest activity moves to the top.
        const next = sortChatsByActivity(
            current.map((chat) =>
                Number(chat.id) === chatId
                    ? {
                          ...chat,
                          lastMessage: lastMessageFromUpdate(update),
                          // A deleted last message changes nothing.
                          unreadCount:
                              update.lastMessage === null
                                  ? chat.unreadCount
                                  : isMine || isReadingHere
                                    ? 0
                                    : chat.unreadCount + 1,
                      }
                    : chat,
            ),
        );
        queryClient.setQueryData<ChatPreview[]>(CHATS_QUERY_KEY, next);
    };
    const onRead = (payload: { chatId: number; unreadCount: number }): void => {
        setChatUnreadCount(
            queryClient,
            Number(payload.chatId),
            Number(payload.unreadCount) || 0,
        );
    };
    // Reached through an invite link: the group is not in the cached list.
    const onGroupAdded = (): void => {
        void invalidateChats(queryClient);
    };
    useSocketEvent('chatlist:updated', handler);
    useSocketEvent('chat:read', onRead);
    useSocketEvent('group:added', onGroupAdded);

    // Reconnect/focus refetches keep the authoritative count (see the screen).
    useEffect(() => {
        const stop = onSocketReconnect(() => {
            void queryClient.invalidateQueries({ queryKey: CHATS_QUERY_KEY });
        });
        return stop;
    }, [queryClient]);

    return query;
}
