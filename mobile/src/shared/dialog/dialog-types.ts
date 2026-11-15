/**
 * Public types for the themed dialog / toast system.
 *
 * The imperative API (`dialog`, `toast`) is usable from components, hooks and
 * mutation callbacks without a React hook, exactly like the native Alert API
 * did.
 */

export type DialogTone = 'default' | 'info' | 'success' | 'warning' | 'danger';

export type DialogButtonStyle = 'default' | 'cancel' | 'destructive';

export interface DialogButton {
    text: string;
    /** `cancel` = ghost, `destructive` = red filled, default = purple filled. */
    style?: DialogButtonStyle;
    /**
     * Runs AFTER the close animation (never before), so a synchronous handler
     * never fires while the card is still on screen. A handler declared
     * `async` runs while the card is open: the button shows a spinner, taps
     * are ignored until it settles, and the card closes when it resolves.
     * A rejection keeps the card open (the caller reports the error).
     */
    onPress?: () => void | Promise<void>;
}

export interface DialogOptions {
    title: string;
    message?: string;
    tone?: DialogTone;
    /** Defaults to a single "OK" button. */
    buttons?: readonly DialogButton[];
    /** Back button / scrim tap dismiss the dialog. Default: true. */
    cancelable?: boolean;
}

export interface ConfirmOptions {
    title: string;
    message?: string;
    confirmText?: string;
    cancelText?: string;
    tone?: DialogTone;
    /** Red filled confirm button; also defaults the tone to `danger`. */
    destructive?: boolean;
    cancelable?: boolean;
}

export type ToastTone = DialogTone;

export interface ToastOptions {
    tone?: ToastTone;
    /** Auto-dismiss delay in ms. Default: 2500. */
    duration?: number;
}

export interface DialogController {
    show: (options: DialogOptions) => void;
    /** One "OK" button. */
    alert: (title: string, message?: string) => void;
    /** Resolves true only when the confirm button is pressed. */
    confirm: (options: ConfirmOptions) => Promise<boolean>;
}

export interface ToastController {
    show: (message: string, options?: ToastOptions) => void;
}

/** A committed dialog; queued requests wait until the previous one is gone. */
export interface DialogSession {
    id: number;
    title: string;
    message: string | null;
    tone: DialogTone;
    buttons: readonly DialogButton[];
    cancelable: boolean;
    /** Dismissed by back / scrim (never by a button). */
    onDismiss?: () => void;
}

export interface ToastSession {
    id: number;
    message: string;
    tone: ToastTone;
    duration: number;
}
