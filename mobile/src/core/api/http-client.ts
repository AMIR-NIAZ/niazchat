import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { env } from '../config/env';
import { ApiError, ApiErrorEnvelope } from './api-error';
import { getApiTokenProvider, hasApiTokenProvider } from './token-provider';

/**
 * Centralized HTTP client.
 *
 * - Injects `Authorization: Bearer <accessToken>` when a provider is registered.
 * - Normalizes every failure into `ApiError` (backend envelope: `{ success, statusCode, message }`).
 * - On a 401 with a refresh token, performs ONE refresh round-trip and retries
 *   the original request once. Backend: `POST /auth/refresh-token` with the raw
 *   `token` header (not Authorization — documented backend quirk).
 */

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRY_AFTER_REFRESH = 1;

export interface HttpClientConfig extends InternalAxiosRequestConfig {
  /** Marks requests that already went through one refresh round-trip. */
  _retriedAfterRefresh?: boolean;
}

export const httpClient: AxiosInstance = axios.create({
  baseURL: env.apiUrl,
  timeout: REQUEST_TIMEOUT_MS,
});

httpClient.interceptors.request.use(async (config) => {
  if (!hasApiTokenProvider()) {
    return config;
  }
  const token = await getApiTokenProvider().getAccessToken();
  if (token !== null) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

httpClient.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (error instanceof AxiosError) {
      const config = (error.config ?? undefined) as HttpClientConfig | undefined;

      if (error.response?.status === 401 && config && !config._retriedAfterRefresh && hasApiTokenProvider()) {
        const provider = getApiTokenProvider();
        if (await provider.isRefreshPossible()) {
          const freshToken = await provider.refreshAccessToken();
          if (freshToken !== null) {
            config._retriedAfterRefresh = true;
            config.headers.set('Authorization', `Bearer ${freshToken}`);
            return httpClient.request(config);
          }
        }
        provider.onSessionExpired();
      }

      throw toApiError(error);
    }
    throw error;
  },
);

export function toApiError(error: AxiosError): ApiError {
  const data: unknown = error.response?.data;
  if (isEnvelope(data)) {
    return new ApiError(data);
  }
  return new ApiError({
    success: false,
    statusCode: error.response?.status ?? 0,
    message: error.message,
  });
}

function isEnvelope(data: unknown): data is ApiErrorEnvelope {
  if (typeof data !== 'object' || data === null || !('statusCode' in data) || !('message' in data)) {
    return false;
  }
  const message = (data as { message: unknown }).message;
  const messageOk = typeof message === 'string' || isStringArray(message);
  return messageOk;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
