import type { ContextMenuItem } from '../../shared/context-popup';
import type { MessageActions } from './message-actions';
import { normalizeEmoji } from '../reactions';
import {
    Reply,
    Forward,
    CheckSquare,
    Share2,
    Pencil,
    Trash2,
} from 'lucide-react-native';

/**
 * The message menu's DATA only. The rendering (fixed 44 px rows, pill, layout)
 * belongs to `shared/context-popup`, which owns the popup itself.
 */

const ACTION_ICONS = {
    reply: Reply,
    forward: Forward,
    select: CheckSquare,
    share: Share2,
    edit: Pencil,
    delete: Trash2,
} as const;

export type MessageMenuActionId =
    | 'reply'
    | 'forward'
    | 'select'
    | 'share'
    | 'edit'
    | 'delete';

export interface MessageMenuHandlers {
    onReply: () => void;
    onForward: () => void;
    onSelect: () => void;
    onShare: () => void;
    onEdit: () => void;
    onDelete: () => void;
}

/**
 * Renders the action list from `getMessageActions` (unchanged rules) in a fixed
 * order: Reply, Forward, Select, Share, Edit, Delete.
 */
export function buildMessageMenuItems(
    actions: MessageActions,
    handlers: MessageMenuHandlers,
): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];
    if (actions.reply) {
        items.push({
            id: 'reply',
            label: 'Reply',
            icon: ACTION_ICONS.reply,
            onPress: handlers.onReply,
        });
    }
    if (actions.forward) {
        items.push({
            id: 'forward',
            label: 'Forward',
            icon: ACTION_ICONS.forward,
            onPress: handlers.onForward,
        });
    }
    if (actions.select) {
        items.push({
            id: 'select',
            label: 'Select',
            icon: ACTION_ICONS.select,
            onPress: handlers.onSelect,
        });
    }
    if (actions.share) {
        items.push({
            id: 'share',
            label: 'Share file',
            icon: ACTION_ICONS.share,
            onPress: handlers.onShare,
        });
    }
    if (actions.edit) {
        items.push({
            id: 'edit',
            label: actions.editLabel ?? 'Edit',
            icon: ACTION_ICONS.edit,
            onPress: handlers.onEdit,
        });
    }
    if (actions.delete) {
        items.push({
            id: 'delete',
            label: actions.deleteOthers ? 'Delete for everyone' : 'Delete',
            icon: ACTION_ICONS.delete,
            destructive: true,
            onPress: handlers.onDelete,
        });
    }
    return items;
}

/**
 * Quick-reaction emoji for a message, in pill order. Kept next to the menu
 * items so the screen builds one popup config from both.
 */
export function reactionChoices(
    emojis: readonly string[],
    myReaction: string | null,
): { emoji: string; selected: boolean }[] {
    return emojis.map((emoji) => ({
        emoji,
        selected:
            myReaction !== null &&
            normalizeEmoji(myReaction) === normalizeEmoji(emoji),
    }));
}

/**
 * Screen-reader actions for a bubble, so the tap/long-press gesture is never
 * required. Delete is included only when the action set allows it.
 */
export function getBubbleAccessibilityActions(
    actions: MessageActions,
    canReact: boolean,
): { name: string; label: string }[] {
    const list: { name: string; label: string }[] = [];
    if (actions.reply) list.push({ name: 'reply', label: 'Reply' });
    if (actions.forward) list.push({ name: 'forward', label: 'Forward' });
    if (canReact) list.push({ name: 'react', label: 'React' });
    if (actions.edit) list.push({ name: 'edit', label: 'Edit' });
    if (actions.delete) {
        list.push({
            name: 'delete',
            label: actions.deleteOthers ? 'Delete for everyone' : 'Delete',
        });
    }
    return list;
}
