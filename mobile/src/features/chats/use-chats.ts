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
import { onSocketReconnect, useSocket } from '../../core/socket';
import type { ChatListUpdateDto } from '../../core/api/dto/message.dto';

/**
 * Chat-list server state over TanStack Query, backed by the acked WS request
 * `getAllChats`, live-updated by `chatlist:updated` (delivered to each member's
 * personal `user:<id>` room — requires connection-time auth, now implemented
 * server-side). staleTime keeps a remount of this screen from re-hitting the
 * socket within 30 s (the old 3-calls-per-launch behaviour).
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

export function useChats(): ReturnType<typeof useQuery<ChatPreview[]>> {
    const queryClient = useQueryClient();
    const socket = useSocket();

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

    // Merge live previews: update lastMessage and keep the row fresh.
    // Depends on `socket` so a replaced instance gets a fresh listener.
    useEffect(() => {
        if (socket === null) {
            return;
        }
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
            // New array + new objects (never mutate the cache) + re-sort, so
            // the chat with the newest activity moves to the top.
            const next = sortChatsByActivity(
                current.map((chat) =>
                    Number(chat.id) === chatId
                        ? {
                              ...chat,
                              lastMessage: lastMessageFromUpdate(update),
                          }
                        : chat,
                ),
            );
            queryClient.setQueryData<ChatPreview[]>(CHATS_QUERY_KEY, next);
        };
        socket.on('chatlist:updated', handler);
        return () => {
            socket.off('chatlist:updated', handler);
        };
    }, [socket, queryClient]);

    // Reconnect: room-independent, so a refetch keeps the list accurate.
    useEffect(() => {
        const stop = onSocketReconnect(() => {
            void queryClient.invalidateQueries({ queryKey: CHATS_QUERY_KEY });
        });
        return stop;
    }, [queryClient]);

    return query;
}
