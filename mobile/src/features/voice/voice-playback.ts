import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import {
    createAudioPlayer,
    setAudioModeAsync,
    type AudioPlayer,
    type AudioStatus,
} from 'expo-audio';
import { nextSpeed } from './playback-model';
import { registerSessionCleanup } from '../../core/session/cleanup-registry';

/**
 * One global voice player. Starting another voice pauses/releases the previous
 * one (only one plays at a time); the manager also stops on background and on
 * app interruption. Playback happens from a LOCAL file URI (never the network).
 */

export interface VoicePlaybackState {
    attachmentId: number | null;
    playing: boolean;
    position: number;
    duration: number;
    rate: number;
    loading: boolean;
    error: string | null;
}

const IDLE: VoicePlaybackState = {
    attachmentId: null,
    playing: false,
    position: 0,
    duration: 0,
    rate: 1,
    loading: false,
    error: null,
};

let state: VoicePlaybackState = IDLE;
let player: AudioPlayer | null = null;
let subscription: { remove: () => void } | null = null;
const listeners = new Set<() => void>();

function emit(): void {
    for (const listener of listeners) {
        listener();
    }
}

function set(next: Partial<VoicePlaybackState>): void {
    state = { ...state, ...next };
    emit();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return (): void => {
        listeners.delete(listener);
    };
}

export function useVoicePlayback(): VoicePlaybackState {
    return useSyncExternalStore(
        subscribe,
        (): VoicePlaybackState => state,
        (): VoicePlaybackState => state,
    );
}

export function getVoicePlayback(): VoicePlaybackState {
    return state;
}

async function playbackMode(): Promise<void> {
    await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: false,
        interruptionMode: 'doNotMix',
        shouldPlayInBackground: false,
    });
}

function release(): void {
    subscription?.remove();
    subscription = null;
    if (player !== null) {
        try {
            player.pause();
            player.remove();
        } catch {
            // The shared object may already be gone after a system reset.
        }
        player = null;
    }
}

/** Stops playback and releases the native player (no listeners left behind). */
export function stopVoice(): void {
    release();
    state = { ...IDLE };
    emit();
}

function applyStatus(status: AudioStatus): void {
    if (status.error !== null) {
        set({
            playing: false,
            loading: false,
            error: 'Could not play this voice message.',
        });
        return;
    }
    if (status.didJustFinish) {
        stopVoice();
        return;
    }
    set({
        playing: status.playing,
        position: status.currentTime,
        duration: status.duration > 0 ? status.duration : state.duration,
        loading: !status.isLoaded && !status.playing,
        error: null,
    });
}

/** Starts a voice from a local file, or toggles it when it is the active one. */
export async function playVoiceMessage(
    attachmentId: number,
    uri: string,
    duration: number,
): Promise<void> {
    if (state.attachmentId === attachmentId && player !== null) {
        if (state.playing) {
            player.pause();
        } else {
            await playbackMode();
            player.play();
        }
        return;
    }

    release();
    await playbackMode();
    const next = createAudioPlayer({ uri }, { updateInterval: 200 });
    player = next;
    subscription = next.addListener(
        'playbackStatusUpdate',
        (status: AudioStatus): void => applyStatus(status),
    );
    set({
        attachmentId,
        playing: true,
        position: 0,
        duration,
        rate: 1,
        loading: true,
        error: null,
    });
    next.play();
}

/** Pauses/resumes the active voice; returns false when another one is active. */
export function toggleVoice(attachmentId: number): boolean {
    if (state.attachmentId !== attachmentId || player === null) {
        return false;
    }
    if (state.playing) {
        player.pause();
    } else {
        player.play();
    }
    return true;
}

export async function seekVoice(seconds: number): Promise<void> {
    if (player === null || !Number.isFinite(seconds)) return;
    const target = Math.max(0, Math.min(seconds, state.duration || seconds));
    await player.seekTo(target);
    set({ position: target });
}

/** 1x → 1.5x → 2x → 1x; keeps playing position. */
export function cycleVoiceSpeed(): void {
    if (player === null) return;
    const next = nextSpeed(state.rate);
    player.setPlaybackRate(next, 'low');
    set({ rate: next });
}

// Calls and other apps take the audio session: stop instead of playing on.
AppState.addEventListener('change', (next): void => {
    if (next !== 'active' && state.attachmentId !== null) {
        stopVoice();
    }
});

// Logout stops any voice playback (video players live in the viewer, which
// unmounts when the protected stack is replaced).
registerSessionCleanup(stopVoice);
