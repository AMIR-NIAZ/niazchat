import { router } from 'expo-router';
import { useEffect } from 'react';
import { useAuthStore } from './auth-store';

/**
 * Route-guard hook for screen layouts.
 *
 * - `guard: 'protected'` — redirects guests to `(auth)/login`, waits while restoring.
 * - `guard: 'guest-only'` — redirects authenticated users to `(app)`.
 */

export type AuthGuard = 'protected' | 'guest-only';

export function useAuthScreenGuard(guard: AuthGuard): boolean {
  const status = useAuthStore((state) => state.status);

  useEffect(() => {
    if (status === 'restoring') {
      return;
    }
    if (guard === 'protected' && status === 'guest') {
      router.replace('/(auth)/login');
    }
    if (guard === 'guest-only' && status === 'authenticated') {
      router.replace('/(app)');
    }
  }, [guard, status]);

  return status === 'authenticated';
}

/** True while the very first session restoration is still in flight. */
export function useIsRestoringSession(): boolean {
  return useAuthStore((state) => state.status) === 'restoring';
}
