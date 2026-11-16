import type { ChatMessage } from '../messages/messages-model';
import { buildViewerItems, initialViewerIndex } from './viewer/viewer-model';
import type { ViewerItem, ViewerRect } from './viewer/viewer-model';

/**
 * Module-level store for the app-wide media viewer.
 *
 * The viewer is mounted ONCE at the root of the app (see
 * `media-viewer-host.tsx`), above the navigator, so it covers the chat header,
 * the composer and the floating tab bar. Screens therefore never own viewer
 * state: they call `openMediaViewer(...)` and keep rendering nothing — opening
 * or closing the viewer re-renders no screen, and no list.
 *
 * The session is a SNAPSHOT taken at open time (pages, first page, hero rect
 * and the actions that need the conversation). The only live change the viewer
 * listens to is a deleted message, which removes its pages (or closes the
 * viewer when nothing is left).
 */

/** Actions that need the conversation; run AFTER the viewer's exit animation. */
export interface MediaViewerActions {
    onForward?: (message: ChatMessage) => void;
    onGoToMessage?: (message: ChatMessage) => void;
    onDelete?: (message: ChatMessage) => void;
    canDelete?: (message: ChatMessage) => boolean;
}

export interface MediaViewerSession {
    /** Bumped on every open, so each request mounts a fresh viewer. */
    id: number;
    /** Every image/video page of the conversation, in message order. */
    items: readonly ViewerItem[];
    initialIndex: number;
    origin: ViewerRect | null;
    actions: MediaViewerActions;
}

export interface OpenMediaViewerRequest extends MediaViewerActions {
    /** Conversation messages, oldest first; only media becomes pages. */
    messages: readonly ChatMessage[];
    /** Message whose attachment was tapped. */
    initialMessageKey: string;
    /** Index within that message's images/videos (the one tapped). */
    initialIndex: number;
    /** Tapped tile rect in window coordinates, for the hero OPEN transition. */
    origin?: ViewerRect | null;
}

export interface MediaViewerController {
    open: (request: OpenMediaViewerRequest) => void;
    /** Plays the exit animation, then unmounts. */
    close: () => void;
    isOpen: () => boolean;
}

let session: MediaViewerSession | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
/**
 * The mounted viewer's animated `close`, registered while it is on screen: the
 * public `close()` must run the exit transition, not drop the session.
 */
let requestClose: (() => void) | null = null;

function emit(): void {
    for (const listener of listeners) {
        listener();
    }
}

function commit(next: MediaViewerSession | null): void {
    session = next;
    emit();
}

export function subscribeMediaViewer(listener: () => void): () => void {
    listeners.add(listener);
    return (): void => {
        listeners.delete(listener);
    };
}

/** `useSyncExternalStore` snapshot: the session object or `null`. */
export function getMediaViewerSession(): MediaViewerSession | null {
    return session;
}

export function registerMediaViewerCloser(close: (() => void) | null): void {
    requestClose = close;
}

/** Opens the viewer over whatever screen asked for it. */
export function openMediaViewer(request: OpenMediaViewerRequest): void {
    const items = buildViewerItems(request.messages);
    if (items.length === 0) {
        return;
    }
    commit({
        id: nextId,
        items,
        initialIndex: initialViewerIndex(
            items,
            request.initialMessageKey,
            request.initialIndex,
        ),
        origin: request.origin ?? null,
        actions: {
            ...(request.onForward === undefined
                ? {}
                : { onForward: request.onForward }),
            ...(request.onGoToMessage === undefined
                ? {}
                : { onGoToMessage: request.onGoToMessage }),
            ...(request.onDelete === undefined
                ? {}
                : { onDelete: request.onDelete }),
            ...(request.canDelete === undefined
                ? {}
                : { canDelete: request.canDelete }),
        },
    });
    nextId += 1;
}

/** Public close: animated while the viewer is mounted, instant otherwise. */
export function closeMediaViewer(): void {
    if (requestClose !== null) {
        requestClose();
        return;
    }
    commit(null);
}

/** Drops the session once the exit animation has finished. */
export function finishMediaViewerSession(): void {
    requestClose = null;
    commit(null);
}

export function isMediaViewerOpen(): boolean {
    return session !== null;
}

/**
 * A message everyone can see was deleted (`deleteMessage:list`): its pages
 * leave the pager, and the viewer closes when nothing is left to show.
 */
export function notifyMediaViewerMessageDeleted(
    messageId: number | null,
): void {
    if (session === null || messageId === null) {
        return;
    }
    const items = session.items.filter((item) => item.message.id !== messageId);
    if (items.length === session.items.length) {
        return;
    }
    if (items.length === 0) {
        closeMediaViewer();
        return;
    }
    commit({ ...session, items });
}

/** Identity-stable controller: no screen state, so no screen re-renders. */
const controller: MediaViewerController = {
    open: openMediaViewer,
    close: closeMediaViewer,
    isOpen: isMediaViewerOpen,
};

export function useMediaViewer(): MediaViewerController {
    return controller;
}
