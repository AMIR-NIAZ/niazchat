import type {
    ConfirmOptions,
    DialogButton,
    DialogController,
    DialogOptions,
    DialogSession,
    ToastController,
    ToastOptions,
    ToastSession,
} from './dialog-types';

/**
 * Module-level store for the dialog and toast hosts.
 *
 * Why not state? These are called from plain async callbacks (mutation
 * handlers, permission checks) far from any component. `show()` simply appends
 * to a queue; the single mounted host subscribes through
 * `useSyncExternalStore` and renders one card at a time. Nothing here touches
 * React on a frame: the host derives every animation from Reanimated shared
 * values, and this store changes only when a dialog is opened, closed or
 * promoted from the queue.
 */

const DEFAULT_TOAST_MS = 2500;

type Listener = () => void;

const listeners = new Set<Listener>();

function subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return (): void => {
        listeners.delete(listener);
    };
}

function notify(): void {
    for (const listener of listeners) {
        listener();
    }
}

// ── Dialog queue ────────────────────────────────────────────────────────────

let dialogSequence = 0;
let dialogCurrent: DialogSession | null = null;
let dialogQueue: DialogSession[] = [];
let dialogClosing = false;

/**
 * The visible dialog. Stable object identity until the host asks for the next
 * one, so `useSyncExternalStore` never loops.
 */
export function getDialogSession(): DialogSession | null {
    return dialogCurrent;
}

export const dialogStoreSubscribe = subscribe;

function enqueueDialog(session: DialogSession): void {
    if (dialogCurrent === null && !dialogClosing) {
        dialogCurrent = session;
        notify();
        return;
    }
    dialogQueue = [...dialogQueue, session];
}

export const dialogStore = {
    /**
     * Starts the exit. Returns false when there is nothing to close or the
     * exit is already running, so double taps and repeated back presses are
     * ignored. The host calls `finishClose()` when its animation ends.
     */
    beginClose(): boolean {
        if (dialogCurrent === null || dialogClosing) {
            return false;
        }
        dialogClosing = true;
        return true;
    },
    /** Drops the visible dialog and promotes the next queued one, if any. */
    finishClose(): void {
        if (!dialogClosing) {
            return;
        }
        dialogClosing = false;
        const [next, ...rest] = dialogQueue;
        dialogCurrent = next ?? null;
        dialogQueue = rest;
        notify();
    },
    /** Test/teardown safety: nothing stays queued across a host remount. */
    reset(): void {
        dialogCurrent = null;
        dialogQueue = [];
        dialogClosing = false;
        notify();
    },
};

function toSession(options: DialogOptions): DialogSession {
    const buttons: readonly DialogButton[] =
        options.buttons !== undefined && options.buttons.length > 0
            ? options.buttons
            : [{ text: 'OK' }];
    return {
        id: (dialogSequence += 1),
        title: options.title,
        message: options.message ?? null,
        tone: options.tone ?? 'default',
        buttons,
        cancelable: options.cancelable !== false,
    };
}

/**
 * Imperative API, importable anywhere:
 *
 * ```ts
 * dialog.alert('Link copied');                    // one OK
 * dialog.show({ title, message, tone: 'danger' }); // single OK, error tone
 * if (await dialog.confirm({ title, destructive: true })) { ... }
 * ```
 */
export const dialog: DialogController = {
    show(options: DialogOptions): void {
        enqueueDialog(toSession(options));
    },
    alert(title: string, message?: string): void {
        dialog.show(
            message === undefined
                ? { title, buttons: [{ text: 'OK' }] }
                : { title, message, buttons: [{ text: 'OK' }] },
        );
    },
    confirm(options: ConfirmOptions): Promise<boolean> {
        return new Promise<boolean>((resolve): void => {
            let settled = false;
            const settle = (value: boolean): void => {
                if (settled) {
                    return;
                }
                settled = true;
                resolve(value);
            };
            const confirmButton: DialogButton = {
                text: options.confirmText ?? 'OK',
                style: options.destructive === true ? 'destructive' : 'default',
                onPress: (): void => settle(true),
            };
            const session: DialogSession = {
                id: (dialogSequence += 1),
                title: options.title,
                message: options.message ?? null,
                tone:
                    options.tone ??
                    (options.destructive === true ? 'danger' : 'default'),
                buttons: [
                    {
                        text: options.cancelText ?? 'Cancel',
                        style: 'cancel',
                        onPress: (): void => settle(false),
                    },
                    confirmButton,
                ],
                cancelable: options.cancelable !== false,
                onDismiss: (): void => settle(false),
            };
            enqueueDialog(session);
        });
    },
};

// ── Toast queue ─────────────────────────────────────────────────────────────

let toastSequence = 0;
let toastCurrent: ToastSession | null = null;
let toastQueue: ToastSession[] = [];
let toastClosing = false;

export function getToastSession(): ToastSession | null {
    return toastCurrent;
}

export const toastStoreSubscribe = subscribe;

export const toastStore = {
    beginClose(): boolean {
        if (toastCurrent === null || toastClosing) {
            return false;
        }
        toastClosing = true;
        return true;
    },
    finishClose(): void {
        if (!toastClosing) {
            return;
        }
        toastClosing = false;
        const [next, ...rest] = toastQueue;
        toastCurrent = next ?? null;
        toastQueue = rest;
        notify();
    },
    reset(): void {
        toastCurrent = null;
        toastQueue = [];
        toastClosing = false;
        notify();
    },
};

/**
 * Short, non-blocking notice: a pill under the safe area that fades away on
 * its own. Use it for success/info confirmations; keep `dialog` for errors and
 * decisions.
 */
export const toast: ToastController = {
    show(message: string, options?: ToastOptions): void {
        const session: ToastSession = {
            id: (toastSequence += 1),
            message,
            tone: options?.tone ?? 'default',
            duration: options?.duration ?? DEFAULT_TOAST_MS,
        };
        if (toastCurrent === null && !toastClosing) {
            toastCurrent = session;
            notify();
            return;
        }
        toastQueue = [...toastQueue, session];
    },
};

/** Same object as `dialog`; provided for symmetry and discoverability. */
export function useDialog(): DialogController {
    return dialog;
}
