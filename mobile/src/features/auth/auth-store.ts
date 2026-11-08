import { create } from 'zustand';
import { registerApiTokenProvider, ApiTokenProvider } from '../../core/api/token-provider';
import {
  clearTokens,
  readAccessToken,
  readRefreshToken,
  writeTokens,
} from '../../core/storage/secure-token.storage';
import { connectSocket, disconnectSocket } from '../../core/socket';
import { getAccessToken, hasRefreshToken, refreshAccessToken } from './token-service';
import { accessTokenSubject } from './access-token-subject';

/**
 * Session state (client-side only; the backend has no logout/revocation).
 * Holds status only — the token pair lives in SecureStore, never in React state.
 */

export interface AuthState {
  /** `restoring` = still reading SecureStore at startup. */
  status: 'restoring' | 'authenticated' | 'guest';
  /**
   * Numeric user id from the access token's `sub` — the ONE stable source of
   * truth for "is this mine?". Never derived from the profile cache, so a
   * profile refetch can never change or lose it.
   */
  userId: number | null;
  /** Restores tokens from SecureStore at startup, refreshing if needed. */
  restoreSession: () => Promise<void>;
  /** Persists the JWT pair (from `POST /auth/verify-otp` data) and opens the socket. */
  storeSession: (accessToken: string, refreshToken: string) => Promise<void>;
  /** Clears SecureStorage and drops the socket — this IS logout. */
  clearSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'restoring',
  userId: null,

  restoreSession: async () => {
    const storedAccessToken = await readAccessToken();
    const hasRefresh = (await readRefreshToken()) !== null;

    if (storedAccessToken === null && !hasRefresh) {
      set({ status: 'guest' });
      return;
    }

    let accessToken = storedAccessToken;
    if (accessToken === null) {
      // Access token expired (1 h TTL); the only signal is the stored refresh token.
      accessToken = await refreshOrDrop();
    }
    if (accessToken === null) {
      set({ status: 'guest' });
      return;
    }

    connectSocket(accessToken);
    set({ status: 'authenticated', userId: accessTokenSubject(accessToken) });
  },

  storeSession: async (accessToken, refreshToken) => {
    await writeTokens(accessToken, refreshToken);
    connectSocket(accessToken);
    set({ status: 'authenticated', userId: accessTokenSubject(accessToken) });
  },

  clearSession: async () => {
    disconnectSocket();
    await clearTokens();
    set({ status: 'guest', userId: null });
  },
}));

async function refreshOrDrop(): Promise<string | null> {
  try {
    return await refreshAccessToken();
  } catch {
    await clearTokens();
    return null;
  }
}

/**
 * Current user id for ownership checks. Session-derived (access token `sub`),
 * numeric, and unaffected by profile/cache refetches.
 */
export function useCurrentUserId(): number | null {
  return useAuthStore((state) => state.userId);
}

/** Concrete ApiTokenProvider wiring for the HTTP client — call once at app bootstrap. */
export function registerAuthTokenProvider(): void {
  const provider: ApiTokenProvider = {
    getAccessToken,
    refreshAccessToken,
    isRefreshPossible: hasRefreshToken,
    onSessionExpired: () => {
      disconnectSocket();
    },
  };
  registerApiTokenProvider(provider);
}
