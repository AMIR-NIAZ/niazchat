import { httpClient, ApiError } from '../../core/api';
import type { UserDto } from '../../core/api';
import { describeAuthError } from '../auth/auth-service';

/**
 * Users API layer (docs/mobile-api/users.md).
 * Only the endpoints needed by the chats/groups features live here:
 * `GET /user/pv/:userName` (by USERNAME, response wrapped in `data`)
 * and `GET /auth/getme` (bare, no `data` wrapper).
 */

/** `GET /user/pv/:userName` → `{ data: UserResponse }`. */
export async function getUserByUsername(userName: string): Promise<UserDto> {
    const response = await httpClient.get<{ data: UserDto }>(
        `/user/pv/${encodeURIComponent(userName)}`,
    );
    return response.data.data;
}

/** `GET /auth/getme` → bare `toUserResponse` (NOT wrapped in `data`). */
export async function getMe(): Promise<UserDto> {
    const response = await httpClient.get<UserDto>('/auth/getme');
    return response.data;
}

/** Turns profile-relevant service failures into user-safe UI messages. */
export function describeLookupError(error: unknown): string {
    if (error instanceof ApiError) {
        if (error.statusCode === 404) {
            return 'No user found for that username.';
        }
        return describeAuthError(error);
    }
    if (error instanceof Error) {
        return error.message;
    }
    return 'Lookup failed.';
}
