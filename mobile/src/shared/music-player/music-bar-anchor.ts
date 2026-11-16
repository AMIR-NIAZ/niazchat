import { useCallback, useId, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { Easing, makeMutable, withTiming } from 'react-native-reanimated';
import { useReducedMotion } from '../hooks/use-reduced-motion';
import { MUSIC_BAR_GAP } from './music-bar-chrome';
import { useMusicBarVisible } from './player-store';

/**
 * Anchor registry for the global mini player bar.
 *
 * Only the screens that own a floating header the bar may sit under (the chat
 * list and the chat screen) call `useMiniPlayerAnchor`. While such a screen is
 * FOCUSED and its header layer has been measured, it registers the bar's top
 * edge (`headerHeight + gap`, an absolute px offset from the window top). On
 * blur/unmount it unregisters.
 *
 * The bar reads ONLY this store:
 *   · `eligible`     — at least one eligible screen is focused: the bar may show
 *   · `anchorTop`    — UI-thread shared value the bar positions itself with
 *
 * A short hide grace keeps the bar painted while the navigation transition
 * swaps one eligible screen for another (chat list ⇄ chat): the new screen
 * registers before the grace expires, so the bar interpolates `anchorTop`
 * instead of fading out and back in.
 */

/** Absolute px from the window top where the bar's top edge sits. */
export const miniPlayerAnchorTop = makeMutable(0);

/** Slide the anchor to its new place while the bar stays visible. */
const ANCHOR_ANIM_MS = 180;
/** Time the bar stays painted while an eligible screen replaces another. */
const HIDE_GRACE_MS = 160;

/** `screenId -> top`, insertion ordered: the last one owns the anchor. */
const anchors = new Map<string, number>();
/** Last anchor we committed (the animation may still be travelling to it). */
let anchoredTop = 0;
let eligible = false;
/** Reduce motion: the anchor snaps instead of gliding between screens. */
let motionReduced = false;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
    for (const listener of listeners) {
        listener();
    }
}

function clearHideTimer(): void {
    if (hideTimer !== null) {
        clearTimeout(hideTimer);
        hideTimer = null;
    }
}

function ownerId(): string | null {
    let last: string | null = null;
    for (const id of anchors.keys()) {
        last = id;
    }
    return last;
}

function setAnchorTop(top: number, animate: boolean): void {
    if (top === anchoredTop && eligible) return;
    anchoredTop = top;
    miniPlayerAnchorTop.value =
        animate && !motionReduced
            ? withTiming(top, {
                  duration: ANCHOR_ANIM_MS,
                  easing: Easing.out(Easing.cubic),
              })
            : top;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return (): void => {
        listeners.delete(listener);
    };
}

/** True while at least one eligible screen is focused (bar may show). */
export function useMiniPlayerEligible(): boolean {
    return useSyncExternalStore(
        subscribe,
        () => eligible,
        () => false,
    );
}

/** True while the bar is actually on screen: playback + an eligible screen. */
export function useMusicBarShown(): boolean {
    const playback = useMusicBarVisible();
    const shownEligible = useMiniPlayerEligible();
    return playback && shownEligible;
}

function registerMiniPlayerAnchor(screenId: string, top: number): void {
    clearHideTimer();
    anchors.delete(screenId);
    anchors.set(screenId, top);
    // Another focused eligible screen still owns the anchor: nothing to do.
    if (ownerId() !== screenId) return;
    // Same transition between two eligible screens (or the header re-measured
    // under a visible bar): glide, never hide/show. The first eligible screen
    // of a session snaps (the bar then slides in at the measured anchor).
    setAnchorTop(top, eligible);
    if (!eligible) {
        eligible = true;
        emit();
    }
}

function unregisterMiniPlayerAnchor(screenId: string): void {
    if (!anchors.has(screenId)) return;
    const wasOwner = ownerId() === screenId;
    anchors.delete(screenId);
    const nextOwner = ownerId();
    if (nextOwner !== null) {
        if (wasOwner) {
            setAnchorTop(anchors.get(nextOwner) ?? 0, true);
        }
        return;
    }
    // No eligible screen left. Keep the bar painted through the transition: a
    // screen that registers meanwhile cancels this timer, so leaving the chat
    // list for a chat never flashes. Anywhere else the bar fades out once the
    // grace expires.
    if (hideTimer !== null) return;
    hideTimer = setTimeout((): void => {
        hideTimer = null;
        if (anchors.size > 0) return;
        eligible = false;
        emit();
    }, HIDE_GRACE_MS);
}

/**
 * Publishes this screen as the mini bar's anchor while it is focused and its
 * header layer has been measured. Pass `null` (or 0) while unmeasured: the bar
 * stays hidden until a real height exists.
 */
export function useMiniPlayerAnchor(headerHeight: number | null): void {
    const screenId = useId();
    const reduceMotion = useReducedMotion();
    useFocusEffect(
        useCallback((): (() => void) | undefined => {
            motionReduced = reduceMotion;
            if (headerHeight === null || !(headerHeight > 0)) {
                return undefined;
            }
            registerMiniPlayerAnchor(
                screenId,
                Math.round(headerHeight + MUSIC_BAR_GAP),
            );
            return (): void => unregisterMiniPlayerAnchor(screenId);
        }, [headerHeight, reduceMotion, screenId]),
    );
}
