import {
    registerApiTokenProvider,
    type ApiTokenProvider,
} from '../../core/api/token-provider';
import { logout } from './logout';
import { ensureFreshSession, refreshSession } from './session-refresh';
import { getAccessToken } from './token-service';

/**
 * Wires the HTTP client to the session layer (called once at bootstrap).
 * Every 401/retry path uses the SAME single-flight refresh, and a definitive
 * rejection runs the ONE logout flow.
 */
export function registerAuthTokenProvider(): void {
    const provider: ApiTokenProvider = {
        getAccessToken,
        ensureFreshSession,
        refreshSession,
        onSessionRejected: (): void => {
            void logout('expired');
        },
    };
    registerApiTokenProvider(provider);
}
