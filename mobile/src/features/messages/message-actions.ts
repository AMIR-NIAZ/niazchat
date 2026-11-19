import { isOwnMessage } from './messages-model';
import type { ChatMessage } from './messages-model';

export interface MessageActionContext {
    currentUserId: number | null;
    /** Group owner may delete another member's confirmed message. */
    canDeleteOthers?: boolean;
    /**
     * Server-derived pin capability (`canPinMessages`): private chats always,
     * groups when the caller is the owner or holds the `pin_message`/`all`
     * grant. The backend re-checks every request.
     */
    canPinMessages?: boolean;
}

export interface MessageActions {
    reply: boolean;
    forward: boolean;
    /** Copies the full message text, never the popup copy. */
    copy: boolean;
    select: boolean;
    edit: boolean;
    editLabel: 'Edit message' | 'Edit caption' | null;
    delete: boolean;
    deleteOthers: boolean;
    /** Offer a document Share action in the sheet. */
    share: boolean;
    /** Pin this (not yet pinned) message. */
    pin: boolean;
    /** Unpin this already-pinned message. */
    unpin: boolean;
}

export const NO_MESSAGE_ACTIONS: MessageActions = {
    reply: false,
    forward: false,
    copy: false,
    select: false,
    edit: false,
    editLabel: null,
    delete: false,
    deleteOthers: false,
    share: false,
    pin: false,
    unpin: false,
};

/**
 * Single source of truth for the long-press sheet. Pending/failed local
 * messages get no server actions (their Retry/Cancel/Remove UI stays separate).
 */
export function getMessageActions(
    message: ChatMessage,
    context: MessageActionContext,
): MessageActions {
    if (message.status !== 'sent' || message.id === null) {
        return NO_MESSAGE_ACTIONS;
    }
    // Service pills are not selectable/quotable/forwardable/reactable.
    if (message.type === 'system') {
        return NO_MESSAGE_ACTIONS;
    }

    const own = isOwnMessage(context.currentUserId, message.senderId);
    const isVoice =
        message.type === 'voice' ||
        message.attachments.some((attachment) => attachment.kind === 'voice');
    const hasText =
        message.content !== null && message.content.trim().length > 0;
    const edit = own && hasText && !isVoice && message.forwardedFrom === null;
    const deleteOthers = !own && context.canDeleteOthers === true;

    return {
        reply: true,
        forward: true,
        copy: hasText,
        select: true,
        edit,
        editLabel: edit
            ? message.attachments.length > 0
                ? 'Edit caption'
                : 'Edit message'
            : null,
        delete: own || deleteOthers,
        deleteOthers,
        share: message.attachments.some(
            (attachment) => attachment.kind === 'file',
        ),
        pin: context.canPinMessages === true && !message.isPinned,
        unpin: context.canPinMessages === true && message.isPinned,
    };
}
