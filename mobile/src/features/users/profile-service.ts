import { httpClient, ApiError } from '../../core/api';
import type {
    UpdateProfilePayloadDto,
    DeleteAvatarPayloadDto,
    UploadAvatarResponseDto,
    UserDto,
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
 *   the client). Multipart field `avatar`; images only (jpeg/png/gif/webp, up
 *   to UPLOAD_MAX_FILE_SIZE). Appends the stored path to `profile.avatars` and
 *   returns `{ message, user }` with the updated profile.
 * - `DELETE /user/delete-avatar`: body `{ avatar: "<profile path>" }` — the
 *   exact path string returned from the user payload.
 */

export async function updateProfile(
    payload: UpdateProfilePayloadDto,
): Promise<void> {
    await httpClient.put('/user/updateme', payload);
}

/**
 * One picked image, exactly as `expo-image-picker` reports it. The local URI is
 * only used for this upload — the profile stores the path the backend returns.
 */
export interface AvatarUploadAsset {
    uri: string;
    mimeType: string | null;
    fileName: string | null;
}

const DEFAULT_AVATAR_MIME = 'image/jpeg';

function extensionForMime(mimeType: string): string {
    switch (mimeType) {
        case 'image/png':
            return 'png';
        case 'image/gif':
            return 'gif';
        case 'image/webp':
            return 'webp';
        default:
            return 'jpg';
    }
}

/**
 * Uploads the picked image and returns the persisted profile (`null` only when
 * the backend answer is missing its `user` payload).
 *
 * No manual `Content-Type`: React Native's networking layer writes
 * `multipart/form-data; boundary=…` itself. Setting the header here drops the
 * boundary, and the backend rejects the body with
 * `400 Multipart: Boundary not found`.
 */
export async function uploadMyAvatar(
    asset: AvatarUploadAsset,
): Promise<UserDto | null> {
    const mimeType = asset.mimeType ?? DEFAULT_AVATAR_MIME;
    const fileName = asset.fileName ?? `avatar.${extensionForMime(mimeType)}`;
    const form = new FormData();
    form.append('avatar', {
        // RN FormData part shape (react-native URI variant, not web Blob).
        uri: asset.uri,
        name: fileName,
        type: mimeType,
    } as unknown as Blob);

    const response = await httpClient.put<UploadAvatarResponseDto>(
        '/user/uploade-avatar',
        form,
    );
    return response.data.user ?? null;
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

/**
 * Maps avatar upload/remove failures. Unlike the profile form, the 400s here are
 * specific (wrong file type, content is not an image), so the backend message is
 * the most useful text.
 */
export function describeAvatarError(error: unknown): string {
    if (error instanceof ApiError) {
        switch (error.statusCode) {
            case 400:
                return error.message;
            case 401:
                return 'Session expired. Please sign in again.';
            case 403:
                return 'You are not allowed to change this photo.';
            case 413:
                return 'That image is too large. Pick a smaller photo.';
            case 0:
                return 'Network problem — could not upload the photo.';
            default:
                return error.message;
        }
    }
    if (error instanceof Error) {
        return error.message;
    }
    return 'Unexpected error while uploading the photo. Please try again.';
}
