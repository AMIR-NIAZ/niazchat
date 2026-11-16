import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { makeMutable } from 'react-native-reanimated';
import {
    createAudioPlayer,
    setAudioModeAsync,
    type AudioPlayer,
    type AudioStatus,
} from 'expo-audio';
import { toast } from '../dialog/dialog-store';
import { registerSessionCleanup } from '../../core/session/cleanup-registry';
import {
    claimAudioFocus,
    registerAudioFocusOwner,
    releaseAudioFocus,
} from '../audio-focus';
import {
    ensureAudioCached,
    getLocalAudioUri,
    setAudioPlaying,
} from '../media-cache';
import { clampMusicPosition, musicNeedsRebase } from './music-clock';
import {
    MUSIC_PLAY_ORDERS,
    createQueueCursor,
    nextIndex,
    peekNextIndex,
    previousIndex,
    syncQueueCursor,
    type MusicPlayOrder,
    type MusicQueueCursor,
} from './music-queue';
import {
    isMusicPlayOrder,
    loadMusicPlayOrder,
    saveMusicPlayOrder,
} from './music-order-prefs';
import { useAuthStore } from '../../features/auth/auth-store';

/**
 * One global music player for the whole app (built on `expo-audio`, which
 * ships in Expo Go on Android — no native module needs building).
 *
 * - A single native player instance is reused via `replace()`.
 * - The queue is the chat's music messages in ASCENDING order (oldest first);
 *   the user's PLAY ORDER (`forward` | `backward` | `shuffle`, persisted per
 *   user) decides how the player walks it. See `music-queue.ts`.
 * - Playback is continuous: the end event always advances (wrapping around),
 *   only an explicit stop ends it.
 * - The live position is a UI-thread CLOCK: `basePosition` + `baseTimestamp`
 *   (monotonic `performance.now()`) with a rate. One frame callback in
 *   `MusicPlayerProvider` derives `musicPosition` every frame, so the display
 *   never depends on how often (or how late) status events arrive.
 * - Status events only CORRECT the clock: a sample further than 0.6 s from the
 *   clock re-bases it; anything closer is ignored (no jitter).
 * - Coarse state (track/queue/status/rate/duration/order) goes through
 *   primitive `useSyncExternalStore` selectors, so the chat list never
 *   re-renders for playback. Position is never stored in React state.
 * - Playback always happens from a LOCAL, fully downloaded file, so tracks are
 *   instant and keep working offline.
 */

export const MUSIC_RATES = [0.75, 1, 1.25, 1.5, 2] as const;
export type MusicRate = (typeof MUSIC_RATES)[number];

/** `previous()` restarts the track after this many seconds of playback. */
export const MUSIC_RESTART_THRESHOLD_SECONDS = 3;

export interface MusicTrack {
    /** Null only for a still-uploading local track (never playable). */
    attachmentId: number | null;
    /** Key of the message that owns the track (for "Go to message"). */
    messageKey: string;
    chatId: number | null;
    title: string;
    artist: string | null;
    coverUrl: string | null;
    /** Local `file://` URI once downloaded (or for an optimistic upload). */
    localUri: string | null;
    mimeType: string;
    name?: string;
    size?: number;
    /** Container duration from the server, when known. */
    durationSeconds?: number | null;
}

export type MusicPlaybackStatus =
    | 'idle'
    | 'loading'
    | 'playing'
    | 'paused'
    | 'error';

export interface MusicPlayerState {
    track: MusicTrack | null;
    /** Chat queue, ascending (oldest first). */
    queue: MusicTrack[];
    /** Index of `track` inside `queue` (-1 when it is not part of it). */
    index: number;
    status: MusicPlaybackStatus;
    duration: number;
    rate: MusicRate;
    /** User-chosen play order; global and persisted per user. */
    order: MusicPlayOrder;
    error: string | null;
}

const IDLE_STATE: MusicPlayerState = {
    track: null,
    queue: [],
    index: -1,
    status: 'idle',
    duration: 0,
    rate: 1,
    order: 'forward',
    error: null,
};

const ORDER_TOASTS: Record<MusicPlayOrder, string> = {
    forward: 'Playing in order',
    backward: 'Playing in reverse',
    shuffle: 'Shuffle',
};

// ── UI-thread clock ─────────────────────────────────────────────────────────
// `basePosition` at `baseTimestamp` (ms, monotonic), advanced at `rate`.
// `musicPosition` is DERIVED every frame by the provider's frame callback and
// is the only position the UI reads. `musicIsScrubbing` lets a gesture own the
// position: corrections and the clock both hold still while it is true.

export const musicBasePosition = makeMutable(0);
export const musicBaseTimestamp = makeMutable(0);
export const musicIsPlaying = makeMutable(false);
export const musicRateShared = makeMutable(1);
export const musicIsScrubbing = makeMutable(false);
export const musicDuration = makeMutable(0);
export const musicPosition = makeMutable(0);

/** A seek requested before the player finished loading, applied on isLoaded. */
let pendingSeek: number | null = null;
/** A native seek is in flight: status samples belong to the OLD position. */
let seekInFlight = false;

/** JS-thread switch used by scrub gestures to own the live position. */
export function setMusicScrubbing(scrubbing: boolean): void {
    musicIsScrubbing.value = scrubbing;
}

/** Monotonic milliseconds, same clock the UI-thread frame callback reads. */
function nowMs(): number {
    return performance.now();
}

/** Moves the clock base to `position` (clamped) at the current instant. */
function rebaseClock(position: number): void {
    const clamped = clampMusicPosition(position, musicDuration.value);
    musicBasePosition.value = clamped;
    musicBaseTimestamp.value = nowMs();
    musicPosition.value = clamped;
}

/** Starts/resumes the clock from `position`. */
function startClock(position: number): void {
    rebaseClock(position);
    musicIsPlaying.value = true;
}

/** Freezes the clock at `position`. */
function holdClock(position: number): void {
    rebaseClock(position);
    musicIsPlaying.value = false;
}

let state: MusicPlayerState = IDLE_STATE;
let player: AudioPlayer | null = null;
let statusSubscription: { remove: () => void } | null = null;
let loadToken = 0;
let initialized = false;
/** Navigation state of the current play order (shuffle bag + history). */
let cursor: MusicQueueCursor = createQueueCursor(0, 0, 'forward');
/** Tracks that failed since the last successful load (each is tried once). */
const failedTracks = new Set<string>();
const listeners = new Set<() => void>();

// ── store plumbing ──────────────────────────────────────────────────────────

function emit(): void {
    for (const listener of listeners) {
        listener();
    }
}

function set(patch: Partial<MusicPlayerState>): void {
    state = { ...state, ...patch };
    emit();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return (): void => {
        listeners.delete(listener);
    };
}

export function getMusicPlayerState(): MusicPlayerState {
    return state;
}

/** Reads one PRIMITIVE slice of the store; re-renders only when it changes. */
function useMusicPrimitive<T>(selector: () => T): T {
    return useSyncExternalStore(subscribe, selector, selector);
}

/**
 * True while the mini bar must show. This is the ONLY player state the chat
 * screen subscribes to: position/status churn never re-renders the list.
 */
export function useMusicBarVisible(): boolean {
    return useMusicPrimitive(
        () => state.track !== null && state.status !== 'idle',
    );
}

/** Id of the track that is loaded in the global player, or null. */
export function useMusicActiveTrackId(): number | null {
    return useMusicPrimitive(() => state.track?.attachmentId ?? null);
}

/** True only for the bubble that owns the loaded track. */
export function useIsActiveTrack(attachmentId: number | null): boolean {
    return useMusicPrimitive(
        () =>
            attachmentId !== null &&
            state.track !== null &&
            state.track.attachmentId === attachmentId,
    );
}

/** Coarse playback status (never the live position). */
export function usePlayerStatus(): MusicPlaybackStatus {
    return useMusicPrimitive(() => state.status);
}

/** Coarse playback status (never the live position). */
export function useMusicPlaybackStatus(): MusicPlaybackStatus {
    return usePlayerStatus();
}

/** Coarse duration of the loaded track (changes on load, not per frame). */
export function useMusicDuration(): number {
    return useMusicPrimitive(() => state.duration);
}

/** The loaded track object; identity changes only on a real track change. */
export function useMusicTrack(): MusicTrack | null {
    return useMusicPrimitive(() => state.track);
}

/** Playback rate; changes only when the user cycles it. */
export function useMusicRate(): MusicRate {
    return useMusicPrimitive(() => state.rate);
}

/** The persisted play order (forward / backward / shuffle). */
export function useMusicOrder(): MusicPlayOrder {
    return useMusicPrimitive(() => state.order);
}

export function useMusicPlayer(): MusicPlayerState & {
    play: () => void;
    pause: () => void;
    resume: () => void;
    toggle: () => void;
    seekTo: (seconds: number) => void;
    next: () => void;
    previous: () => void;
    stop: () => void;
    setRate: (rate: MusicRate) => void;
    setOrder: (order: MusicPlayOrder) => void;
    cycleOrder: () => void;
} {
    const snapshot = useSyncExternalStore(
        subscribe,
        getMusicPlayerState,
        getMusicPlayerState,
    );
    return {
        ...snapshot,
        play: playMusic,
        pause: pauseMusic,
        resume: resumeMusic,
        toggle: toggleMusic,
        seekTo: (seconds: number) => {
            void seekMusic(seconds);
        },
        next: nextMusic,
        previous: previousMusic,
        stop: stopMusic,
        setRate: setMusicRate,
        setOrder: setMusicOrder,
        cycleOrder: cycleMusicOrder,
    };
}

// ── native player ───────────────────────────────────────────────────────────

async function playbackMode(): Promise<void> {
    await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: false,
        interruptionMode: 'doNotMix',
        shouldPlayInBackground: false,
    });
}

function ensurePlayer(): AudioPlayer {
    if (player !== null) return player;
    player = createAudioPlayer(undefined, { updateInterval: 100 });
    statusSubscription = player.addListener(
        'playbackStatusUpdate',
        (status: AudioStatus): void => applyStatus(status),
    );
    return player;
}

function releasePlayer(): void {
    statusSubscription?.remove();
    statusSubscription = null;
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

/**
 * Reconciles the clock with one player sample. The sample is a CORRECTION
 * only: within 0.6 s it is ignored, beyond that the clock re-bases once.
 */
function syncClock(
    reportedPosition: number,
    playing: boolean,
    duration: number,
): void {
    if (duration > 0) {
        musicDuration.value = duration;
    }
    musicRateShared.value = state.rate;

    if (musicIsScrubbing.value || seekInFlight) return;

    if (!playing) {
        // Pause/buffer/end: freeze at the clock's exact position (never at a
        // late sample, which would step the label backward).
        if (musicIsPlaying.value) {
            holdClock(musicPosition.value);
        } else if (
            musicNeedsRebase(reportedPosition, musicBasePosition.value)
        ) {
            rebaseClock(reportedPosition);
        }
        return;
    }

    if (!musicIsPlaying.value) {
        // First confirmation that audio really flows (after buffering/load).
        startClock(
            Number.isFinite(reportedPosition)
                ? reportedPosition
                : musicPosition.value,
        );
        return;
    }

    if (musicNeedsRebase(reportedPosition, musicPosition.value)) {
        startClock(reportedPosition);
    }
}

function applyStatus(status: AudioStatus): void {
    const track = state.track;
    if (track === null) return;

    if (status.error !== null) {
        failTrack(track, new Error(status.error));
        return;
    }
    if (status.didJustFinish) {
        handleTrackEnd();
        return;
    }

    const duration = status.duration > 0 ? status.duration : state.duration;
    const playing = status.isLoaded && status.playing && !status.isBuffering;

    syncClock(status.currentTime, playing, duration);

    const nextStatus: MusicPlaybackStatus = !status.isLoaded
        ? 'loading'
        : status.isBuffering
          ? 'loading'
          : playing
            ? 'playing'
            : 'paused';

    // A seek issued before the player was ready: apply it now.
    if (status.isLoaded && pendingSeek !== null) {
        const target = pendingSeek;
        pendingSeek = null;
        void performSeek(target);
    }

    const durationChanged = Math.abs(duration - state.duration) > 0.05;
    if (nextStatus !== state.status || durationChanged) {
        set({ status: nextStatus, duration });
    }
}

/** Stable identity of a queue entry across a rebuilt queue. */
function trackKey(track: MusicTrack): string {
    return track.attachmentId !== null
        ? `attachment:${track.attachmentId}`
        : `message:${track.messageKey}`;
}

function failTrack(track: MusicTrack, error: unknown): void {
    pendingSeek = null;
    seekInFlight = false;
    releasePlayer();
    releaseAudioFocus('music');
    setAudioPlaying(track.attachmentId, false);
    holdClock(0);
    musicDuration.value = 0;
    set({
        status: 'error',
        error: 'Playback failed',
        duration: 0,
    });
    toast.show(`Couldn't play ${track.title}`);
    void error;

    failedTracks.add(trackKey(track));

    // Every track failed once: stop. Otherwise skip ahead in the current
    // order instead of getting stuck on the broken track.
    if (state.queue.length === 0 || failedTracks.size >= state.queue.length) {
        stopMusic();
        return;
    }

    let probe = cursor;
    let index = state.index;
    for (let attempt = 0; attempt < state.queue.length; attempt += 1) {
        const step = nextIndex(probe, index, state.queue.length);
        probe = step.cursor;
        index = step.index;
        const candidate = state.queue[index];
        if (candidate === undefined) continue;
        if (!failedTracks.has(trackKey(candidate))) {
            cursor = probe;
            playQueueIndex(index, true);
            return;
        }
    }
    stopMusic();
}

function handleTrackEnd(): void {
    seekInFlight = false;
    holdClock(state.duration);
    if (state.queue.length === 0) {
        stopMusic();
        return;
    }
    // Continuous playback: the end of the list always wraps around, in every
    // order. Only an explicit stop (X) ends playback.
    const step = nextIndex(cursor, state.index, state.queue.length);
    cursor = step.cursor;
    if (step.index < 0) {
        stopMusic();
        return;
    }
    playQueueIndex(step.index, true);
}

/** Starts `state.queue[index]` without changing the order cursor. */
function playQueueIndex(index: number, autoplay: boolean): void {
    const track = state.queue[index] ?? null;
    if (track === null) {
        stopMusic();
        return;
    }
    set({ index });
    void loadTrack(track, autoplay);
}

// ── loading ─────────────────────────────────────────────────────────────────

function trackDuration(track: MusicTrack): number {
    const seconds = track.durationSeconds;
    return typeof seconds === 'number' && seconds > 0 ? seconds : 0;
}

/** Downloads the next track of the current order ahead of time. */
function prefetchNextTrack(): void {
    if (state.queue.length === 0 || state.track === null) return;
    const probe = peekNextIndex(cursor, state.index, state.queue.length);
    if (probe < 0 || probe === state.index) return;
    const next = state.queue[probe];
    if (next === undefined || next.attachmentId === null) return;
    if (next.localUri !== null) return;
    if (getLocalAudioUri(next.attachmentId) !== null) return;
    void ensureAudioCached({
        id: next.attachmentId,
        mimeType: next.mimeType,
        name: next.name ?? next.title,
        ...(next.size !== undefined ? { size: next.size } : {}),
    }).catch((): void => undefined);
}

async function loadTrack(
    track: MusicTrack | null,
    autoplay: boolean,
): Promise<void> {
    if (track === null) {
        stopMusic();
        return;
    }
    if (track.attachmentId === null) {
        failTrack(track, new Error('This track is still uploading.'));
        return;
    }

    const previous = state.track;
    // The same track again (single-track loop, repeat after `previous()`):
    // restart it from the beginning instead of re-downloading it.
    if (
        previous !== null &&
        previous.attachmentId === track.attachmentId &&
        autoplay &&
        player !== null
    ) {
        claimAudioFocus('music');
        setAudioPlaying(track.attachmentId, true);
        musicDuration.value = trackDuration(track);
        musicRateShared.value = state.rate;
        startClock(0);
        set({
            track,
            status: 'playing',
            duration: trackDuration(track),
            error: null,
        });
        player.setPlaybackRate(state.rate, 'low');
        player.play();
        void performSeek(0);
        prefetchNextTrack();
        return;
    }

    const token = ++loadToken;
    if (previous !== null && previous.attachmentId !== track.attachmentId) {
        setAudioPlaying(previous.attachmentId, false);
    }
    pendingSeek = null;
    seekInFlight = false;

    claimAudioFocus('music');
    musicDuration.value = trackDuration(track);
    musicRateShared.value = state.rate;
    holdClock(0);
    set({
        track,
        status: 'loading',
        duration: trackDuration(track),
        error: null,
    });

    let uri = track.localUri ?? getLocalAudioUri(track.attachmentId);
    if (uri === null) {
        try {
            uri = await ensureAudioCached({
                id: track.attachmentId,
                mimeType: track.mimeType,
                name: track.name ?? track.title,
                ...(track.size !== undefined ? { size: track.size } : {}),
            });
        } catch {
            if (token !== loadToken) return;
            failTrack(track, new Error('download failed'));
            return;
        }
    }
    if (token !== loadToken) return;

    const active = ensurePlayer();
    try {
        await playbackMode();
        if (token !== loadToken) return;
        active.replace({ uri });
        active.setPlaybackRate(state.rate, 'low');
        setAudioPlaying(track.attachmentId, true);
        set({
            track: {
                ...track,
                localUri: uri,
            },
            duration: trackDuration(track),
        });
        if (autoplay) {
            active.play();
            startClock(0);
        } else {
            holdClock(0);
            set({ status: 'paused' });
        }
        failedTracks.clear();
        prefetchNextTrack();
    } catch {
        if (token !== loadToken) return;
        failTrack(track, new Error('playback failed'));
    }
}

// ── public controls ─────────────────────────────────────────────────────────

/**
 * Plays a chat track, setting the chat queue (ascending) and the play order
 * cursor at that track. Tapping the track that is already active toggles it.
 */
export function playMusicTrack(
    track: MusicTrack,
    queue: MusicTrack[],
    index: number,
): void {
    const activeId = state.track?.attachmentId;
    if (
        activeId !== null &&
        activeId !== undefined &&
        activeId === track.attachmentId
    ) {
        toggleMusic();
        return;
    }
    const normalizedIndex =
        index >= 0 && index < queue.length ? index : queue.indexOf(track);
    const start = normalizedIndex >= 0 ? normalizedIndex : 0;
    failedTracks.clear();
    // forward/backward start at THAT track; shuffle puts it first, then the bag.
    cursor = createQueueCursor(queue.length, start, state.order);
    set({ queue, index: start });
    void loadTrack(queue[start] ?? track, true);
}

/** Pauses/resumes a specific track (bubble button); loads it on first tap. */
export function toggleMusicTrack(
    track: MusicTrack,
    queue: MusicTrack[],
    index: number,
): void {
    const activeId = state.track?.attachmentId;
    if (
        activeId !== null &&
        activeId !== undefined &&
        activeId === track.attachmentId
    ) {
        toggleMusic();
        return;
    }
    playMusicTrack(track, queue, index);
}

function ensureTrack(): boolean {
    if (state.track === null) {
        const first = state.queue[0] ?? null;
        if (first === null) return false;
        void loadTrack(first, true);
        return false;
    }
    return true;
}

export function playMusic(): void {
    if (!ensureTrack()) return;
    const track = state.track;
    if (track === null) return;
    claimAudioFocus('music');
    if (player === null) {
        void loadTrack(track, true);
        return;
    }
    setAudioPlaying(track.attachmentId, true);
    startClock(player.currentTime);
    set({ status: 'playing' });
    player.play();
}

export function resumeMusic(): void {
    playMusic();
}

export function pauseMusic(): void {
    if (player !== null) {
        player.pause();
    }
    if (state.status === 'playing' || state.status === 'loading') {
        holdClock(musicPosition.value);
        set({ status: 'paused' });
    }
}

export function toggleMusic(): void {
    if (state.track === null) {
        playMusic();
        return;
    }
    if (state.status === 'playing') {
        pauseMusic();
    } else {
        playMusic();
    }
}

/** Next track in the current order (wraps; shuffle uses bag then history). */
export function nextMusic(): void {
    if (state.queue.length === 0) return;
    failedTracks.clear();
    const step = nextIndex(cursor, state.index, state.queue.length);
    cursor = step.cursor;
    playQueueIndex(step.index, true);
}

/**
 * Previous track in the current order. More than ~3 s into the track it
 * restarts the current one instead of changing track (all modes).
 */
export function previousMusic(): void {
    if (state.track === null) return;
    if (
        musicPosition.value > MUSIC_RESTART_THRESHOLD_SECONDS ||
        state.queue.length === 0
    ) {
        void seekMusic(0);
        return;
    }
    failedTracks.clear();
    const step = previousIndex(cursor, state.index, state.queue.length);
    cursor = step.cursor;
    playQueueIndex(step.index, true);
}

/** Changes the global play order for the NEXT track; never interrupts one. */
export function setMusicOrder(order: MusicPlayOrder): void {
    if (!isMusicPlayOrder(order) || state.order === order) return;
    applyMusicOrder(order, true);
}

/** Cycles forward → backward → shuffle (mini-bar mode button). */
export function cycleMusicOrder(): void {
    const current = MUSIC_PLAY_ORDERS.indexOf(state.order);
    const next =
        MUSIC_PLAY_ORDERS[(current + 1) % MUSIC_PLAY_ORDERS.length] ??
        'forward';
    setMusicOrder(next);
}

/**
 * Rebuilds the order cursor around the playing track, so the change takes
 * effect on the next `next()` / end of track without touching this one.
 */
function applyMusicOrder(order: MusicPlayOrder, announce: boolean): void {
    const current = state.index >= 0 ? state.index : 0;
    cursor = createQueueCursor(state.queue.length, current, order);
    set({ order });
    if (announce) {
        toast.show(ORDER_TOASTS[order]);
        const userId = useAuthStore.getState().userId;
        if (userId !== null) void saveMusicPlayOrder(userId, order);
    }
    prefetchNextTrack();
}

/**
 * Restores the saved order at app start (no toast, no re-save). A user who
 * never chose one starts on the default, never on the previous user's mode.
 */
export async function restoreMusicOrder(userId: number): Promise<void> {
    const order = (await loadMusicPlayOrder(userId)) ?? 'forward';
    if (order !== state.order) {
        applyMusicOrder(order, false);
    }
}

/**
 * Live queue: the chat screen publishes its music messages whenever they
 * change. Appends keep playing; deletions only skip when the deleted track is
 * the one playing. A foreign chat's queue is ignored.
 */
export function syncMusicQueue(chatId: number, queue: MusicTrack[]): void {
    const active = state.track;
    if (active === null || active.chatId !== chatId) return;

    const previousQueue = state.queue;
    const nextIndexOfKey = new Map<string, number>();
    queue.forEach((track, index): void => {
        nextIndexOfKey.set(trackKey(track), index);
    });
    const indexMap = previousQueue.map(
        (track) => nextIndexOfKey.get(trackKey(track)) ?? null,
    );

    if (queue.length === 0) {
        stopMusic();
        return;
    }

    const currentOld =
        state.index >= 0 && state.index < previousQueue.length
            ? state.index
            : previousQueue.findIndex(
                  (track) => trackKey(track) === trackKey(active),
              );
    const currentNew =
        currentOld >= 0
            ? (indexMap[currentOld] ?? null)
            : (nextIndexOfKey.get(trackKey(active)) ?? null);

    if (currentNew !== null) {
        const updated = queue[currentNew];
        if (updated === undefined) return;
        cursor = syncQueueCursor(cursor, indexMap, queue.length, currentNew);
        // Same track, possibly refreshed metadata (or a downloaded URI):
        // update in place, never reload — playback is not interrupted.
        set({
            queue,
            index: currentNew,
            track: {
                ...updated,
                localUri: updated.localUri ?? active.localUri,
            },
        });
        prefetchNextTrack();
        return;
    }

    // The playing track was deleted: continue with what the order says comes
    // next (forward → the following message, backward → the preceding one).
    const anchor = Math.min(Math.max(currentOld, 0), queue.length - 1);
    const fallback =
        state.order === 'backward' ? Math.max(0, anchor - 1) : anchor;
    cursor = createQueueCursor(queue.length, fallback, state.order);
    const autoplay = state.status === 'playing' || state.status === 'loading';
    set({ queue, index: fallback });
    void loadTrack(queue[fallback] ?? null, autoplay);
}

/** Clamps a seek target into the playable range (seconds). */
function clampSeek(seconds: number): number {
    const duration = state.duration > 0 ? state.duration : musicDuration.value;
    if (Number.isFinite(duration) && duration > 0) {
        return Math.max(0, Math.min(seconds, duration - 0.1));
    }
    return Math.max(0, seconds);
}

/**
 * The native seek: the clock re-bases to the target immediately (optimistic,
 * so every progress line snaps there) and keeps running only if it was
 * playing. Status samples are ignored until the seek resolves.
 */
async function performSeek(seconds: number): Promise<void> {
    if (player === null) return;
    const target = clampSeek(seconds);
    const wasPlaying = state.status === 'playing';
    seekInFlight = true;
    rebaseClock(target);
    musicIsPlaying.value = wasPlaying;
    try {
        await player.seekTo(target);
    } catch {
        // A seek right after `replace()` can arrive before the decoder is
        // ready; retry once the first `isLoaded` status arrives.
        pendingSeek = target;
        seekInFlight = false;
        return;
    }
    seekInFlight = false;
    rebaseClock(target);
    // The seek itself never pauses playback; a pause issued while it was in
    // flight must win over the pre-seek "was playing" snapshot.
    musicIsPlaying.value = wasPlaying && state.status === 'playing';
}

export async function seekMusic(seconds: number): Promise<void> {
    if (player === null || !Number.isFinite(seconds)) return;
    const target = clampSeek(seconds);
    if (state.status === 'loading') {
        // Defer to the first loaded status; publish optimistically so the UI
        // follows the thumb immediately.
        pendingSeek = target;
        holdClock(target);
        return;
    }
    await performSeek(target);
}

export function setMusicRate(rate: MusicRate): void {
    if (!MUSIC_RATES.includes(rate)) return;
    if (state.status === 'playing') {
        // Capture the position at the OLD rate before the clock changes speed.
        musicBasePosition.value = musicPosition.value;
        musicBaseTimestamp.value = nowMs();
    }
    player?.setPlaybackRate(rate, 'low');
    musicRateShared.value = rate;
    set({ rate });
}

/** Stops playback, restores 1x and clears the queue (bar hides). */
export function stopMusic(): void {
    ++loadToken;
    pendingSeek = null;
    seekInFlight = false;
    failedTracks.clear();
    const track = state.track;
    releasePlayer();
    releaseAudioFocus('music');
    if (track !== null) {
        setAudioPlaying(track.attachmentId, false);
    }
    holdClock(0);
    musicDuration.value = 0;
    musicRateShared.value = 1;
    // The play order is a user preference: it survives a stop.
    state = { ...IDLE_STATE, order: state.order };
    emit();
}

// ── lifecycle ───────────────────────────────────────────────────────────────

function initializePlayer(): void {
    if (initialized) return;
    initialized = true;

    // Voice messages steal the focus: pause (not stop) so the track resumes.
    registerAudioFocusOwner('music', pauseMusic);

    // Calls and other interruptions: never keep playing in the background
    // (background audio is not available in Expo Go anyway).
    AppState.addEventListener('change', (next): void => {
        if (next !== 'active') {
            pauseMusic();
        }
    });

    registerSessionCleanup(stopMusic);

    void playbackMode().catch((): void => undefined);
}

initializePlayer();
