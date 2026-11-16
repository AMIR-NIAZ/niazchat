/**
 * Audio focus between the two global audio owners: voice messages and the
 * music player. Only one may play at a time.
 *
 * - Music starting stops the active voice message.
 * - Voice starting PAUSES music (the track keeps its position for later).
 *
 * A small registry avoids a circular import between the two modules: each
 * owner registers its own `onFocusLost` callback once, and claiming focus
 * invokes the other owner's callback.
 */

export type AudioOwner = 'voice' | 'music';

const focusLostHandlers = new Map<AudioOwner, () => void>();
let owner: AudioOwner | null = null;

/** Registers how an owner reacts when the other owner takes the focus. */
export function registerAudioFocusOwner(
    name: AudioOwner,
    onFocusLost: () => void,
): void {
    focusLostHandlers.set(name, onFocusLost);
}

/** Claims audio focus, notifying the previously active owner (if any). */
export function claimAudioFocus(next: AudioOwner): void {
    if (owner !== null && owner !== next) {
        focusLostHandlers.get(owner)?.();
    }
    owner = next;
}

/** Releases focus only when the caller still owns it. */
export function releaseAudioFocus(name: AudioOwner): void {
    if (owner === name) owner = null;
}

export function currentAudioOwner(): AudioOwner | null {
    return owner;
}
