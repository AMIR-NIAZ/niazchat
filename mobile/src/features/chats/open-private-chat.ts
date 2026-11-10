import { router } from 'expo-router';
import type { QueryClient } from '@tanstack/react-query';
import type { ChatPreview } from './chats-model';
import { CHATS_QUERY_KEY } from './use-chats';
import {
    createPrivateChat,
    describePrivateChatError,
} from './private-chat-service';
import type { CreatePrivateChatResponse } from './private-chat-service';
import { messagesQueryKey } from '../messages/use-chat-messages';
import type { ConversationDetail } from '../messages/use-chat-messages';
import type { ChatDto } from '../../core/api';

/**
 * Single entry point for "start a private chat with this user".
 *
 * - Reuses an existing chat from the chat-list cache when the peer id is known
 *   (no request at all).
 * - Otherwise `POST /chats/private`; the server returns the SAME chat when the
 *   pair already exists.
 * - One in-flight request per peer: rapid double taps cannot create twice.
 * - Seeds the conversation cache with the chat + peer (header paints
 *   immediately) but NEVER inserts the empty chat into the list cache; it
 *   appears there through the normal `chatlist:updated` flow once the first
 *   message exists.
 * - Navigation: `push` from a profile, `replace` from the new-chat screen so
 *   Back returns to the list.
 */
const inFlight = new Set<number>();

export function findPrivateChatWithPeer(
    chats: readonly ChatPreview[] | undefined,
    peerId: number,
): ChatPreview | null {
    if (chats === undefined) {
        return null;
    }
    return (
        chats.find(
            (chat) =>
                chat.type === 'private' &&
                Number(chat.peer?.id) === Number(peerId),
        ) ?? null
    );
}

function navigateToChat(chatId: number, replace: boolean): void {
    const pathname = '/(app)/chat/[chatId]';
    const params = { chatId: String(chatId) };
    if (replace) {
        router.replace({ pathname, params });
        return;
    }
    router.push({ pathname, params });
}

function seedConversation(
    queryClient: QueryClient,
    result: CreatePrivateChatResponse,
): void {
    const now = new Date().toISOString();
    const info: ChatDto = {
        id: result.chatId,
        createdAt: now,
        updatedAt: now,
        title: null,
        peer: result.peer,
        avatars: [],
        type: 'private',
        isBan: false,
        unreadCount: 0,
    };
    queryClient.setQueryData<ConversationDetail>(
        messagesQueryKey(result.chatId),
        (previous) =>
            previous ?? {
                info,
                messages: [],
                hasMore: false,
                nextCursor: null,
                myLastSeenId: null,
                othersLastSeenId: null,
            },
    );
}

export interface OpenPrivateChatOptions {
    /** New-chat screen: replace so Back returns to the list. */
    replace?: boolean;
    /** Query client used to reuse/seed caches. */
    queryClient?: QueryClient;
}

/**
 * Resolves to the chat id, or null when a request for this peer is already
 * running (the second tap must not navigate twice). Throws a user-safe Error.
 */
export async function openPrivateChat(
    userId: number,
    options: OpenPrivateChatOptions = {},
): Promise<number | null> {
    if (!Number.isInteger(userId) || userId <= 0) {
        throw new Error('This user is not available');
    }

    const cached =
        options.queryClient === undefined
            ? null
            : findPrivateChatWithPeer(
                  options.queryClient.getQueryData<ChatPreview[]>(
                      CHATS_QUERY_KEY,
                  ),
                  userId,
              );
    if (cached !== null) {
        navigateToChat(Number(cached.id), options.replace === true);
        return Number(cached.id);
    }

    if (inFlight.has(userId)) {
        return null;
    }
    inFlight.add(userId);
    try {
        const result = await createPrivateChat(userId);
        if (options.queryClient !== undefined) {
            seedConversation(options.queryClient, result);
        }
        navigateToChat(result.chatId, options.replace === true);
        return result.chatId;
    } catch (error) {
        throw new Error(describePrivateChatError(error));
    } finally {
        inFlight.delete(userId);
    }
}
