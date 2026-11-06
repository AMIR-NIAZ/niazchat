import axios, { AxiosError } from 'axios';
import { env } from '../../core/config/env';
import { toApiError } from '../../core/api/http-client';
import {
  readAccessToken,
  readRefreshToken,
  writeAccessToken,
} from '../../core/storage/secure-token.storage';

/**
 * Token refresh round-trip.
 *
 * Backend contract (docs/mobile-api/authentication.md):
 * `POST /auth/refresh-token` uses a raw **`token` header**, NOT Authorization.
 * The refresh token is not rotated; the response is `{ accessToken }`.
 *
 * Runs on a bare axios instance (no interceptors) to avoid recursion.
 */

export function hasRefreshToken(): Promise<boolean> {
  return readRefreshToken().then((token) => token !== null);
}

export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await readRefreshToken();
  if (refreshToken === null) {
    return null;
  }
  try {
    // Bare instance: never attach Authorization, never intercept 401s.
    const response = await axios.post<{ accessToken: string }>(
      `${env.apiUrl}/auth/refresh-token`,
      null,
      { headers: { token: refreshToken }, timeout: 15_000 },
    );
    const accessToken = response.data.accessToken;
    if (typeof accessToken !== 'string' || accessToken === '') {
      return null;
    }
    await writeAccessToken(accessToken);
    return accessToken;
  } catch (error) {
    // Invalid/expired refresh JWT → 401 (or 403 rewritten to 'user not access').
    throw toApiError(error as AxiosError);
  }
}

export async function getAccessToken(): Promise<string | null> {
  return readAccessToken();
}
