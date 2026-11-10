import axios, {
    AxiosError,
    AxiosInstance,
    InternalAxiosRequestConfig,
} from 'axios';
import { env } from '../config/env';
import { ApiError, ApiErrorEnvelope } from './api-error';
import { getApiTokenProvider, hasApiTokenProvider } from './token-provider';

/**
 * Centralized HTTP client.
 *
 * - Waits for an in-flight session refresh, then injects
 *   `Authorization: Bearer <accessToken>` when a provider is registered.
 * - Normalizes every failure into `ApiError` (backend envelope: `{ success, statusCode, message }`).
 * - On a 401: runs the SHARED single-flight `refreshSession()` once, retries the
 *   original request once with the new token. `rejected` (or a 401 that
 *   survives the retry) → `onSessionRejected()` (logout). `unavailable` →
 *   surface the network error without logging out.
 * - Public auth endpoints are excluded: a wrong OTP is a 401 that must never
 *   trigger a refresh/logout loop.
 */

const REQUEST_TIMEOUT_MS = 15_000;
const AUTH_ENDPOINT_PATTERN =
    /\/auth\/(send-otp|verify-otp|refresh-token)(?:[?#]|$)/;

export interface HttpClientConfig extends InternalAxiosRequestConfig {
    /** Marks requests that already went through one refresh round-trip. */
    _retriedAfterRefresh?: boolean;
}

export const httpClient: AxiosInstance = axios.create({
    baseURL: env.apiUrl,
    timeout: REQUEST_TIMEOUT_MS,
});

function isAuthEndpoint(url: string | undefined): boolean {
    return url !== undefined && AUTH_ENDPOINT_PATTERN.test(url);
}

httpClient.interceptors.request.use(async (config) => {
    if (!hasApiTokenProvider()) {
        return config;
    }
    const provider = getApiTokenProvider();
    // Requests that start while a refresh is running must not carry the old token.
    await provider.ensureFreshSession();
    const token = await provider.getAccessToken();
    if (token !== null) {
        config.headers.set('Authorization', `Bearer ${token}`);
    }
    return config;
});

httpClient.interceptors.response.use(
    (response) => response,
    async (error: unknown) => {
        if (error instanceof AxiosError) {
            const config = (error.config ?? undefined) as
                | HttpClientConfig
                | undefined;
            const status = error.response?.status;

            if (
                status === 401 &&
                config &&
                hasApiTokenProvider() &&
                !isAuthEndpoint(config.url)
            ) {
                const provider = getApiTokenProvider();

                if (config._retriedAfterRefresh) {
                    // A freshly refreshed token was rejected too: the session is dead.
                    provider.onSessionRejected();
                    throw toApiError(error);
                }

                const result = await provider.refreshSession();
                if (result.status === 'ok') {
                    config._retriedAfterRefresh = true;
                    config.headers.set(
                        'Authorization',
                        `Bearer ${result.accessToken}`,
                    );
                    return httpClient.request(config);
                }
                if (result.status === 'rejected') {
                    provider.onSessionRejected();
                }
                // unavailable: keep the session and surface the original network error.
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
    if (
        typeof data !== 'object' ||
        data === null ||
        !('statusCode' in data) ||
        !('message' in data)
    ) {
        return false;
    }
    const message = (data as { message: unknown }).message;
    const messageOk = typeof message === 'string' || isStringArray(message);
    return messageOk;
}

function isStringArray(value: unknown): value is string[] {
    return (
        Array.isArray(value) && value.every((item) => typeof item === 'string')
    );
}
