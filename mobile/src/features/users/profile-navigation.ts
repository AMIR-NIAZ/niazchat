import { router } from 'expo-router';
import { useEffect } from 'react';
import { toNumericId } from '../messages/messages-model';

/**
 * Navigation into the user-info screen, with the guards the chat UI needs:
 *
 * - unknown / invalid ids do nothing (there is nothing to open);
 * - the same screen already open on top is a no-op;
 * - rapid double taps on the same target produce one push.
 *
 * My own avatar/name belongs to the profile tab (`/(app)/profile`), not to a
 * public profile of myself.
 */

/** User id of the currently mounted user-info screen (null when none). */
let openUserId: number | null = null;
let lastTargetId: number | null = null;
let lastPushAt = 0;
const DOUBLE_TAP_MS = 700;

export interface OpenUserProfileParams {
    userId: number | string | null | undefined;
    name?: string | null;
    /** Server-relative current avatar path, for the instant header/avatar. */
    avatar?: string | null;
    /** True for the caller's own messages → open the profile tab instead. */
    isSelf?: boolean;
}

export function openUserProfile(params: OpenUserProfileParams): void {
    const userId = toNumericId(params.userId);
    if (userId === null || userId <= 0) {
        return;
    }
    if (params.isSelf === true) {
        router.push('/(app)/profile');
        return;
    }
    if (openUserId === userId) {
        return;
    }
    const now = Date.now();
    if (lastTargetId === userId && now - lastPushAt < DOUBLE_TAP_MS) {
        return;
    }
    lastTargetId = userId;
    lastPushAt = now;

    const query: Record<string, string> = { userId: String(userId) };
    if (typeof params.name === 'string' && params.name.trim() !== '') {
        query['name'] = params.name;
    }
    if (typeof params.avatar === 'string' && params.avatar.trim() !== '') {
        query['avatar'] = params.avatar;
    }
    router.push({ pathname: '/(app)/user/[userId]', params: query });
}

/** Marks the user-info screen as the open one while it is mounted. */
export function useRegisterOpenUserProfile(userId: number | null): void {
    useEffect((): (() => void) | void => {
        if (userId === null || userId <= 0) {
            return;
        }
        openUserId = userId;
        return (): void => {
            if (openUserId === userId) {
                openUserId = null;
            }
        };
    }, [userId]);
}
