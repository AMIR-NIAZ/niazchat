import { router } from 'expo-router';
import { useEffect } from 'react';
import { useAuthStore } from './auth-store';
import { takePendingInviteCode } from '../groups/pending-invite';

/**
 * Route-guard hook for screen layouts.
 *
 * - `guard: 'protected'` — redirects guests to `(auth)/login`, waits while restoring.
 * - `guard: 'guest-only'` — redirects authenticated users to `(app)`.
 * - `guard: 'none'` — no redirect (the auth screens opened as "Add account").
 */

export type AuthGuard = 'protected' | 'guest-only' | 'none';

export function useAuthScreenGuard(guard: AuthGuard): boolean {
    const status = useAuthStore((state) => state.status);

    useEffect(() => {
        if (guard === 'none' || status === 'restoring') {
            return;
        }
        if (guard === 'protected' && status === 'guest') {
            router.replace('/(auth)/login');
        }
        if (guard === 'guest-only' && status === 'authenticated') {
            // A link opened while logged out continues on the join screen.
            const pendingInvite = takePendingInviteCode();
            router.replace(
                pendingInvite === null ? '/(app)' : `/join/${pendingInvite}`,
            );
        }
    }, [guard, status]);

    return status === 'authenticated';
}

/** True while the very first session restoration is still in flight. */
export function useIsRestoringSession(): boolean {
    return useAuthStore((state) => state.status) === 'restoring';
}
