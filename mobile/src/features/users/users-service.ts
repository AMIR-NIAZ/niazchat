import { httpClient, ApiError } from '../../core/api';
import type { PublicUserProfileDto, UserDto } from '../../core/api';
import { absoluteUploadUrl } from '../../core/config/env';
import { describeAuthError } from '../auth/auth-service';
import { toPublicProfileView } from './public-profile-model';
import type { PublicUserProfileView } from './public-profile-model';

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

/**
 * `GET /user/:userId/profile` → the public projection (bare, no `data`
 * wrapper). Any authenticated user may read any other user's profile; the
 * avatar list is complete, current photo first.
 */
export async function fetchUserProfile(
    userId: number,
): Promise<PublicUserProfileView> {
    const response = await httpClient.get<PublicUserProfileDto>(
        `/user/${userId}/profile`,
    );
    return toPublicProfileView(response.data, absoluteUploadUrl);
}

/** User-safe messages for the user-info screen (status over message text). */
export function describePublicProfileError(error: unknown): string {
    if (error instanceof ApiError) {
        switch (error.statusCode) {
            case 404:
                return 'This user is not available';
            case 429:
                return 'Too many requests, try again in a moment';
            case 401:
                return 'Session expired. Please sign in again.';
            case 0:
                return 'Network problem — could not reach the server.';
            default:
                return error.message;
        }
    }
    if (error instanceof Error) {
        return error.message;
    }
    return 'Could not load this profile.';
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
