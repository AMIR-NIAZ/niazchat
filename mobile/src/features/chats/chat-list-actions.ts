import { isGroupOwner, isPrivateChat } from './chats-model';
import type { ChatPreview } from './chats-model';
import type { ChatRole } from '../../core/api/dto/chat.dto';
import { BadgeInfo, EyeOff, User, Pin, PinOff, SquareArrowRightExit } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

/**
 * Chat-list long-press actions, data-driven and unit-tested.
 *
 * Only real behaviour is offered:
 * - Mark as read: WS `markSeen` with the previewed last message id.
 * - Group info / View profile: the existing navigation targets.
 * - Pin/Unpin: device-local preference (`local-chat-prefs`).
 * - Leave group: real server leave, hidden for the owner (who cannot leave).
 *
 * Mute/archive/delete-chat do not exist in the backend yet. They belong in this
 * list (and the switch in `chat-list-menu.tsx`) once they do — do not add rows
 * that have no behaviour.
 */

export type ChatListActionId =
    | 'mark-read'
    | 'group-info'
    | 'view-profile'
    | 'pin'
    | 'unpin'
    | 'leave-group';

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
        }
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
