import type { ContextMenuItem } from '../../shared/context-popup';
import type { MessageActions } from './message-actions';
import { normalizeEmoji } from '../reactions';
import {
    Reply,
    Forward,
    Copy,
    CheckSquare,
    Share2,
    Pencil,
    Trash2,
    Pin,
    PinOff,
} from 'lucide-react-native';

/**
 * The message menu's DATA only. The rendering (fixed 44 px rows, pill, layout)
 * belongs to `shared/context-popup`, which owns the popup itself.
 */

const ACTION_ICONS = {
    reply: Reply,
    forward: Forward,
    copy: Copy,
    select: CheckSquare,
    share: Share2,
    edit: Pencil,
    delete: Trash2,
    pin: Pin,
    unpin: PinOff,
} as const;

export type MessageMenuActionId =
    | 'reply'
    | 'forward'
    | 'copy'
    | 'select'
    | 'share'
    | 'edit'
    | 'delete'
    | 'pin'
    | 'unpin';

export interface MessageMenuHandlers {
    onReply: () => void;
    onForward: () => void;
    onCopy: () => void;
    onSelect: () => void;
    onShare: () => void;
    onEdit: () => void;
    onDelete: () => void;
    onPin: () => void;
    onUnpin: () => void;
}

/**
 * Renders the action list from `getMessageActions` (unchanged rules) in a fixed
 * order: Reply, Forward, Copy, Select, Share, Edit, Delete.
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
    if (actions.copy) {
        items.push({
            id: 'copy',
            label: 'Copy',
            icon: ACTION_ICONS.copy,
            onPress: handlers.onCopy,
        });
    }
    if (actions.pin) {
        items.push({
            id: 'pin',
            label: 'Pin Message',
            icon: ACTION_ICONS.pin,
            onPress: handlers.onPin,
        });
    }
    if (actions.unpin) {
        items.push({
            id: 'unpin',
            label: 'Unpin Message',
            icon: ACTION_ICONS.unpin,
            onPress: handlers.onUnpin,
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
    if (actions.pin) list.push({ name: 'pin', label: 'Pin Message' });
    if (actions.unpin) list.push({ name: 'unpin', label: 'Unpin Message' });
    if (actions.delete) {
        list.push({
            name: 'delete',
            label: actions.deleteOthers ? 'Delete for everyone' : 'Delete',
        });
    }
    return list;
}
