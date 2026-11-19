import type { QueryClient } from '@tanstack/react-query';
import { CHATS_QUERY_KEY } from '../chats/use-chats';
import type { ChatPreview } from '../chats/chats-model';
import type { ConversationDetail } from '../messages/use-chat-messages';
import { hideLocalSenderDetails } from '../../shared/local-db';
import { userProfileQueryKey } from './use-user-profile';
import type { PublicUserProfileView } from './public-profile-model';

/**
 * The server answered 404 for a profile because its owner blocked the viewer.
 *
 * Overwrites every cached copy so a stale photo/bio cannot survive offline:
 * - the public-profile entry becomes a neutral placeholder (no avatars/bio/
 *   presence, which is also what a later successful fetch would replace);
 * - private chat peers lose their photo/username/presence;
 * - loaded message bubbles from that sender lose their avatar;
 * - the SQLite mirror is scrubbed in the background (best effort).
 *
 * Nothing here reveals WHY the profile is unavailable.
 */
export function hideUserProfileEverywhere(
    queryClient: QueryClient,
    viewerId: number | null,
    userId: number,
    fallbackName: string = 'Profile',
): void {
    queryClient.setQueryData<PublicUserProfileView>(
        userProfileQueryKey(userId),
        {
            id: userId,
            name: fallbackName,
            username: null,
            biografy: null,
            avatars: [],
            isOnline: false,
            lastSeen: null,
        },
    );

    queryClient.setQueryData<ChatPreview[]>(CHATS_QUERY_KEY, (current) =>
        current === undefined
            ? current
            : current.map((chat) =>
                  chat.peer?.id === userId
                      ? {
                            ...chat,
                            peer: {
                                ...chat.peer,
                                username: '',
                                avatars: [],
                                isOnline: false,
                                lastSeen: null,
                            },
                        }
                      : chat,
              ),
    );

    queryClient.setQueriesData<ConversationDetail>(
        { queryKey: ['messages'] },
        (current) => {
            if (current === undefined) return current;
            let changed = false;
            const messages = current.messages.map((message) => {
                if (message.senderId !== userId) return message;
                changed = true;
                return {
                    ...message,
                    senderAvatarUrls: [],
                    senderAvatarPath: null,
                };
            });
            return changed ? { ...current, messages } : current;
        },
    );

    if (viewerId !== null) {
        void hideLocalSenderDetails(viewerId, userId).catch(
            (): void => undefined,
        );
    }
}
