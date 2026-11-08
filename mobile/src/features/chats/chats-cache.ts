import type { QueryClient } from '@tanstack/react-query';
import { messagesQueryKey } from '../messages/use-chat-messages';
import { getActiveChat, setActiveChat } from './active-chat';
import type { ChatPreview } from './chats-model';
import {
    CHATS_QUERY_KEY,
    invalidateChats,
    setChatsQueryData,
} from './use-chats';

/**
 * Drops every local trace of a chat after the backend confirmed the caller is
 * no longer a member: the list row, the conversation page cache, chat info,
 * ban/role helper queries, and the active-chat marker. The chat list is then
 * refetched so the server stays authoritative.
 */
export function purgeChatFromCaches(
    queryClient: QueryClient,
    chatId: number,
): void {
    const cachedChats =
        queryClient.getQueryData<ChatPreview[]>(CHATS_QUERY_KEY);
    if (cachedChats !== undefined) {
        setChatsQueryData(
            queryClient,
            cachedChats.filter((chat) => Number(chat.id) !== chatId),
        );
    }
    queryClient.removeQueries({ queryKey: messagesQueryKey(chatId) });
    queryClient.removeQueries({ queryKey: ['chat-info', chatId] });
    queryClient.removeQueries({ queryKey: ['chats', 'bans', chatId] });
    queryClient.removeQueries({ queryKey: ['chats', 'my-role', chatId] });
    if (getActiveChat().chatId === chatId) {
        setActiveChat(null, false);
    }
    void invalidateChats(queryClient);
}
