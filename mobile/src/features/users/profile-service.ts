import { httpClient, ApiError } from '../../core/api';
import type {
    UpdateProfilePayloadDto,
    DeleteAvatarPayloadDto,
} from '../../core/api';

/**
 * Profile API layer — the ONLY place that talks to the profile endpoints
 * (docs/mobile-api/users.md, verified against src/modules/auth).
 *
 * Verbatim backend semantics below:
 * - `PUT /user/updateme`: ALL three fields are REQUIRED by validation
 *   (forbidNonWhitelisted, no @IsOptional) although the service updates
 *   conditionally. Success: `{ message: 'user updated is 1' }`; 409 when the
 *   username is taken; wrong choices send back a 400 (not 403).
 * - `PUT /user/uploade-avatar`: route typo is canonical (do NOT "fix" it in
 *   the client). Multipart field `avatar`; appends the stored path to
 *   profile.avatars. No size/content-type restrictions server-side.
 * - `DELETE /user/delete-avatar`: body `{ avatar: "<profile path>" }` — the
 *   exact path string returned from the user payload.
 */

export async function updateProfile(
    payload: UpdateProfilePayloadDto,
): Promise<void> {
    await httpClient.put('/user/updateme', payload);
}

export async function uploadMyAvatar(fileUri: string): Promise<void> {
    const form = new FormData();
    form.append('avatar', {
        // RN FormData part shape (react-native URI variant, not web Blob).
        uri: fileUri,
        name: 'avatar.jpg',
        type: 'image/jpeg',
    } as unknown as Blob);
    await httpClient.put('/user/uploade-avatar', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
    });
}

export async function deleteMyAvatar(
    payload: DeleteAvatarPayloadDto,
): Promise<void> {
    await httpClient.delete('/user/delete-avatar', {
        data: { avatar: payload.avatar },
    });
}

/** Maps profile-edit failures to user-safe messages (status over message text). */
export function describeProfileError(error: unknown): string {
    if (error instanceof ApiError) {
        switch (error.statusCode) {
            case 409:
                return 'That username is already taken.';
            case 400:
                return 'Check the fields — name up to 20 chars, username 5–32 (letters, digits, _) and bio up to 100 chars.';
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
    return 'Unexpected error. Please try again.';
}
