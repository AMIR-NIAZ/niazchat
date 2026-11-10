import { toNumericId } from '../messages/messages-model';
import { decodeJwtPayload } from './token-expiry';

/**
 * Reads the authenticated user id from an access token, WITHOUT a JWT library.
 *
 * The token is only ever parsed here, never validated (the server validates it
 * on every request). The `sub` claim is the ONE source of truth for "is this
 * message mine?", independent of the profile cache. Ids are normalized to
 * numbers like every other id in the app.
 */
export function accessTokenSubject(
    token: string | null | undefined,
): number | null {
    const payload = decodeJwtPayload(token);
    if (payload === null) {
        return null;
    }
    return toNumericId(payload.sub);
}
