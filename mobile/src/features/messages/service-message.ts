import type {
    ServiceMessageActionDto,
    ServiceMessageMetaDto,
} from '../../core/api/dto/message.dto';

/**
 * Service (`system`) messages announce a membership change. The server stores
 * an English fallback in `content`; the app rebuilds (and localizes) the
 * sentence from `meta` with the SAME pure builder the chat list uses.
 */

export type ServiceMessageAction =
    | ServiceMessageActionDto
    /** A persisted row from a newer backend: render `fallback` verbatim. */
    | 'unknown';

export interface ServiceMessage {
    action: ServiceMessageAction;
    actorId: number;
    actorName: string;
    targetId: number;
    targetName: string;
    /** English `content` snapshot; used only when `action` is unknown. */
    fallback: string;
}

const KNOWN_ACTIONS: ReadonlySet<string> = new Set<ServiceMessageActionDto>([
    'member_joined',
    'member_joined_via_link',
    'member_added',
    'member_left',
    'member_banned',
    'member_removed',
]);

function toId(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Wire `meta` → typed service payload. Missing/malformed meta (an older
 * backend or a cached row) becomes `null`, and the UI falls back to `content`.
 */
export function toServiceMessage(
    meta: ServiceMessageMetaDto | null | undefined,
    fallbackContent: string | null | undefined,
): ServiceMessage | null {
    if (meta === null || meta === undefined || typeof meta !== 'object') {
        return null;
    }
    const actorId = toId(meta.actorId);
    const targetId = toId(meta.targetId);
    if (actorId === 0 || targetId === 0) {
        return null;
    }
    return {
        action:
            typeof meta.action === 'string' && KNOWN_ACTIONS.has(meta.action)
                ? meta.action
                : 'unknown',
        actorId,
        actorName: typeof meta.actorName === 'string' ? meta.actorName : '',
        targetId,
        targetName: typeof meta.targetName === 'string' ? meta.targetName : '',
        fallback: fallbackContent ?? '',
    };
}

/** One tappable/plain segment of the rendered sentence. */
export interface ServiceMessagePart {
    text: string;
    /** Target user id when this segment is a tappable name. */
    userId: number | null;
    /** Viewer-rendered "You" — never tappable. */
    isYou: boolean;
}

/**
 * Sentence segments, so the pill can make names tappable while the chat list
 * simply joins them. Viewer-as-target renders "You" (never a profile link).
 */
export function serviceMessageParts(
    service: ServiceMessage | null,
    currentUserId: number | null,
): ServiceMessagePart[] {
    if (service === null) {
        return [];
    }
    if (service.action === 'unknown') {
        return [
            {
                text: service.fallback,
                userId: null,
                isYou: false,
            },
        ];
    }

    const viewer = currentUserId ?? 0;
    const targetIsYou = viewer > 0 && viewer === service.targetId;
    const targetName = targetIsYou ? 'You' : service.targetName;
    const targetPart: ServiceMessagePart = {
        text: targetName,
        userId: targetIsYou ? null : service.targetId,
        isYou: targetIsYou,
    };
    const actorPart: ServiceMessagePart = {
        text: service.actorName,
        userId: service.actorId,
        isYou: false,
    };

    switch (service.action) {
        case 'member_joined':
            return [
                targetPart,
                { text: ' joined the group', userId: null, isYou: false },
            ];
        case 'member_joined_via_link':
            return [
                targetPart,
                { text: ' joined via invite link', userId: null, isYou: false },
            ];
        case 'member_added':
            return [
                actorPart,
                { text: ' added ', userId: null, isYou: false },
                targetPart,
            ];
        case 'member_left':
            return [
                targetPart,
                { text: ' left the group', userId: null, isYou: false },
            ];
        case 'member_banned':
            return [
                targetPart,
                {
                    text: targetIsYou ? ' were banned' : ' was banned',
                    userId: null,
                    isYou: false,
                },
            ];
        case 'member_removed':
            return [
                targetPart,
                {
                    text: targetIsYou ? ' were removed' : ' was removed',
                    userId: null,
                    isYou: false,
                },
            ];
    }
}

/**
 * The single sentence builder shared by the in-chat pill and the chat-list
 * preview. Pure: the same inputs always produce the same string.
 */
export function serviceMessageText(
    service: ServiceMessage | null,
    currentUserId: number | null,
): string {
    return serviceMessageParts(service, currentUserId)
        .map((part) => part.text)
        .join('');
}
