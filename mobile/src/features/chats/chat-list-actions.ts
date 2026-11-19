import { isGroupOwner, isPrivateChat } from './chats-model';
import type { ChatPreview } from './chats-model';
import type { ChatRole } from '../../core/api/dto/chat.dto';
import {
    BadgeInfo,
    Ban,
    EyeOff,
    Pin,
    PinOff,
    SquareArrowRightExit,
    Trash2,
    User,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

/**
 * Chat-list long-press actions, data-driven and unit-tested.
 *
 * Only real behaviour is offered:
 * - Mark as read: WS `markSeen` with the previewed last message id.
 * - Group info / View profile: the existing navigation targets.
 * - Pin/Unpin: device-local preference (`local-chat-prefs`).
 * - Leave group: real server leave, hidden for the owner (who cannot leave).
 * - Block/Unblock: WS `blockUser`/`unblockUser`, private chats only. The row
 *   follows the caller's own directional state (`blockedByMe`).
 * - Delete for me / for both: WS `deleteChatForMe`/`deleteChatForBoth`,
 *   private chats only. Both are confirmed before they run.
 *
 * Mute/archive do not exist in the backend, so they are not offered.
 */

export type ChatListActionId =
    | 'mark-read'
    | 'group-info'
    | 'view-profile'
    | 'pin'
    | 'unpin'
    | 'leave-group'
    | 'block-user'
    | 'unblock-user'
    | 'delete-for-me'
    | 'delete-for-both';

export interface ChatListAction {
    id: ChatListActionId;
    label: string;
    icon: LucideIcon;
    destructive: boolean;
}
export interface ChatListActionContext {
    /** True when the seen feature can send `markSeen` for this chat. */
    markSeenAvailable: boolean;
    pinned: boolean;
    /** Caller's role in this group; null while unknown (or for private chats). */
    role: ChatRole | null;
}

export function getChatListActions(
    chat: ChatPreview | null,
    context: ChatListActionContext,
): ChatListAction[] {
    if (chat === null) {
        return [];
    }
    const actions: ChatListAction[] = [];

    actions.push(
        context.pinned
            ? {
                  id: 'unpin',
                  label: 'Unpin chat',
                  icon: PinOff,
                  destructive: false,
              }
            : {
                  id: 'pin',
                  label: 'Pin chat',
                  icon: Pin,
                  destructive: false,
              },
    );

    if (
        context.markSeenAvailable &&
        chat.unreadCount > 0 &&
        chat.lastMessage !== null
    ) {
        actions.push({
            id: 'mark-read',
            label: 'Mark as read',
            icon: EyeOff,
            destructive: false,
        });
    }

    if (isPrivateChat(chat)) {
        if (chat.peer !== null) {
            actions.push({
                id: 'view-profile',
                label: 'View profile',
                icon: User,
                destructive: false,
            });
            const blockedByMe = chat.blockedByMe === true;
            actions.push({
                id: blockedByMe ? 'unblock-user' : 'block-user',
                label: blockedByMe ? 'Unblock user' : 'Block user',
                icon: Ban,
                destructive: false,
            });
        }
        actions.push({
            id: 'delete-for-me',
            label: 'Delete chat for me',
            icon: Trash2,
            destructive: true,
        });
        actions.push({
            id: 'delete-for-both',
            label: 'Delete chat for both',
            icon: Trash2,
            destructive: true,
        });
    } else {
        actions.push({
            id: 'group-info',
            label: 'Group info',
            icon: BadgeInfo,
            destructive: false,
        });
        // The owner cannot leave; the row is simply absent for them.
        if (context.role !== null && !isGroupOwner(context.role)) {
            actions.push({
                id: 'leave-group',
                label: 'Leave group',
                icon: SquareArrowRightExit,
                destructive: true,
            });
        }
    }

    return actions;
}
