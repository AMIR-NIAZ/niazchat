import {
    useInfiniteQuery,
    useQueryClient,
    type InfiniteData,
    type QueryClient,
} from '@tanstack/react-query';
import { useCallback } from 'react';
import { useSocketEvent } from '../../core/socket';
import type { MessageDto } from '../../core/api/dto/message.dto';
import type {
    SharedAttachmentItemDto,
    SharedContentPageDto,
    SharedContentType,
    SharedLinkItemDto,
} from '../../core/api/dto/shared-content.dto';
import { fetchChatLinks, fetchChatMedia } from './shared-content-api';
import { affectedTabsForMessage } from './shared-content-model';

/**
 * Server state for the profile's shared-content tabs.
 *
 * - one `useInfiniteQuery` per tab, LAZY: `enabled` is true only after the
 *   tab has been opened once (the component keeps that set), so opening the
 *   profile never fetches all five tabs;
 * - cursor pagination, newest first, with the server's opaque `nextCursor`;
 * - switching tabs keeps every loaded page cached (no refetch);
 * - realtime events invalidate only the tabs a message can affect, and
 *   deleted messages are removed from the cached pages in place.
 */

/** 30 for lists; the media grid asks for 60 (two screens of tiles). */
export const SHARED_LIST_PAGE_SIZE = 30;
export const SHARED_MEDIA_PAGE_SIZE = 60;

const STALE_TIME_MS = 60_000;
const CACHE_TIME_MS = 10 * 60_000;

export function sharedContentQueryKey(
    chatId: number,
    type: SharedContentType,
): readonly [string, number, SharedContentType] {
    return ['chat-shared-content', chatId, type] as const;
}

export function useChatAttachmentMedia(
    chatId: number,
    type: Exclude<SharedContentType, 'links'>,
    enabled: boolean,
) {
    return useInfiniteQuery<
        SharedContentPageDto<SharedAttachmentItemDto>,
        Error,
        InfiniteData<
            SharedContentPageDto<SharedAttachmentItemDto>,
            string | null
        >,
        ReturnType<typeof sharedContentQueryKey>,
        string | null
    >({
        queryKey: sharedContentQueryKey(chatId, type),
        enabled,
        initialPageParam: null,
        staleTime: STALE_TIME_MS,
        gcTime: CACHE_TIME_MS,
        queryFn: ({ pageParam }) =>
            fetchChatMedia(
                chatId,
                type,
                pageParam ?? undefined,
                type === 'media'
                    ? SHARED_MEDIA_PAGE_SIZE
                    : SHARED_LIST_PAGE_SIZE,
            ),
        getNextPageParam: (last) => last.nextCursor ?? undefined,
    });
}

export function useChatLinks(chatId: number, enabled: boolean) {
    return useInfiniteQuery<
        SharedContentPageDto<SharedLinkItemDto>,
        Error,
        InfiniteData<SharedContentPageDto<SharedLinkItemDto>, string | null>,
        ReturnType<typeof sharedContentQueryKey>,
        string | null
    >({
        queryKey: sharedContentQueryKey(chatId, 'links'),
        enabled,
        initialPageParam: null,
        staleTime: STALE_TIME_MS,
        gcTime: CACHE_TIME_MS,
        queryFn: ({ pageParam }) =>
            fetchChatLinks(
                chatId,
                pageParam ?? undefined,
                SHARED_LIST_PAGE_SIZE,
            ),
        getNextPageParam: (last) => last.nextCursor ?? undefined,
    });
}
type SharedPageItem = SharedAttachmentItemDto | SharedLinkItemDto;

/** Drops every cached page item that belongs to a deleted message. */
export function removeMessageFromSharedContent(
    queryClient: QueryClient,
    chatId: number,
    messageId: number,
): void {
    const tabTypes: SharedContentType[] = [
        'media',
        'voice',
        'music',
        'links',
        'files',
    ];
    for (const type of tabTypes) {
        const key = sharedContentQueryKey(chatId, type);
        const current =
            queryClient.getQueryData<
                InfiniteData<
                    SharedContentPageDto<SharedPageItem>,
                    string | null
                >
            >(key);
        if (current === undefined) continue;
        let removed = 0;
        const pages = current.pages.map((page) => {
            const items = page.items.filter((item) => {
                if (item.messageId === messageId) {
                    removed += 1;
                    return false;
                }
                return true;
            });
            return items.length === page.items.length
                ? page
                : { ...page, items };
        });
        if (removed > 0) {
            queryClient.setQueryData(key, { ...current, pages });
        }
    }
}

/**
 * Socket → query cache bridge for one chat.
 *
 * Mounted once by the shared-content section. New messages invalidate only the
 * tabs their attachments/text can change; a deleted message is removed from
 * every loaded page in place.
 */
export function useSharedContentRealtime(
    chatId: number,
    enabled: boolean,
): void {
    const queryClient = useQueryClient();

    const onMessage = useCallback(
        (message: MessageDto): void => {
            if (!enabled || Number(message.chatId) !== chatId) return;
            for (const type of affectedTabsForMessage(message)) {
                const key = sharedContentQueryKey(chatId, type);
                // Never creates an unopened tab's query: lazy stays lazy.
                if (queryClient.getQueryState(key) !== undefined) {
                    void queryClient.invalidateQueries({ queryKey: key });
                }
            }
        },
        [chatId, enabled, queryClient],
    );

    const onDeleted = useCallback(
        (messageId: number): void => {
            if (!enabled || typeof messageId !== 'number') return;
            removeMessageFromSharedContent(queryClient, chatId, messageId);
        },
        [chatId, enabled, queryClient],
    );

    useSocketEvent('sendMessage:list', onMessage);
    useSocketEvent('editMessage:list', onMessage);
    useSocketEvent('deleteMessage:list', onDeleted);
}
