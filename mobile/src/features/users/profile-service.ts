import { httpClient, ApiError } from '../../core/api';
import type {
    AvatarMutationResponseDto,
    UpdateProfilePayloadDto,
    UserDto,
} from '../../core/api';
import { normalizeUserPayload } from './me-cache';

/**
 * Profile API layer — the ONLY place that talks to the profile endpoints
 * (docs/mobile-api/users.md, verified against src/modules/auth).
 *
 * Multi-avatar contract (backend: UserService + user.controller.ts):
 * - `POST /user/avatars` (multipart field `avatar`) prepends the new photo as
 *   `avatars[0]` (current). Legacy `PUT /user/uploade-avatar` still works.
 * - `DELETE /user/avatars/:fileName` removes one photo by its stored file NAME.
 * - `PUT /user/avatars/:fileName/main` promotes that photo to current.
 * Every mutation returns `{ message, user }` with the updated profile, so the
 * client confirms persistence from this payload alone.
 *
 * Limits shared with the server: 10 photos, 5 MiB, jpeg/png/webp only.
 */

/** Backend-enforced limits (avatar.util.ts / AvatarLimitGuard). */
export const MAX_AVATARS = 10;
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export const AVATAR_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
] as const;

const MIME_BY_EXTENSION: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
};

/**
 * Picker MIME → a server-accepted MIME type. Falls back to the file extension
 * when the picker omits/reports a wrong type (`image/jpg` is normalized).
 * `null` means the backend would reject it, so the UI shows a friendly error.
 */
export function normalizeAvatarMime(
    mimeType: string | null,
    fileName: string | null,
): string | null {
    const declared = (mimeType ?? '').toLowerCase().trim();
    const normalized = declared === 'image/jpg' ? 'image/jpeg' : declared;
    if ((AVATAR_MIME_TYPES as readonly string[]).includes(normalized)) {
        return normalized;
    }
    const extension = (fileName ?? '').split('.').pop()?.toLowerCase().trim();
    return extension === undefined || extension === ''
        ? null
        : (MIME_BY_EXTENSION[extension] ?? null);
}

/**
 * `PUT /user/updateme` currently answers `{ message }` (no user), so this
 * resolves to `null`; a future full-user answer is normalized and handed to the
 * cache merge instead of being written straight into `['me']`.
 */
export async function updateProfile(
    payload: UpdateProfilePayloadDto,
): Promise<UserDto | null> {
    const response = await httpClient.put<unknown>('/user/updateme', payload);
    return normalizeUserPayload(response.data);
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

function extensionForMime(mimeType: string): string {
    switch (mimeType) {
        case 'image/png':
            return 'png';
        case 'image/webp':
            return 'webp';
        default:
            return 'jpg';
    }
}

/**
 * Uploads the picked image as a new photo and returns the persisted profile
 * (`null` only when the backend answer is missing its `user` payload).
 *
 * No manual `Content-Type`: React Native's networking layer writes
 * `multipart/form-data; boundary=…` itself. Setting the header here drops the
 * boundary, and the backend rejects the body with
 * `400 Multipart: Boundary not found`.
 */
export async function uploadAvatar(
    asset: AvatarUploadAsset,
): Promise<UserDto | null> {
    const mimeType = normalizeAvatarMime(asset.mimeType, asset.fileName);
    if (mimeType === null) {
        throw new Error('Pick a JPEG, PNG or WebP image.');
    }
    const fileName = asset.fileName ?? `avatar.${extensionForMime(mimeType)}`;
    const form = new FormData();
    form.append('avatar', {
        // RN FormData part shape (react-native URI variant, not web Blob).
        uri: asset.uri,
        name: fileName,
        type: mimeType,
    } as unknown as Blob);

    const response = await httpClient.post<AvatarMutationResponseDto>(
        '/user/avatars',
        form,
    );
    return normalizeUserPayload(response.data);
}

/** Removes one photo by its stored file name; resolves to the updated user. */
export async function deleteAvatar(fileName: string): Promise<UserDto | null> {
    const response = await httpClient.delete<AvatarMutationResponseDto>(
        `/user/avatars/${encodeURIComponent(fileName)}`,
    );
    return normalizeUserPayload(response.data);
}

/** Makes one photo current (moves it to index 0). */
export async function setMainAvatar(fileName: string): Promise<UserDto | null> {
    const response = await httpClient.put<AvatarMutationResponseDto>(
        `/user/avatars/${encodeURIComponent(fileName)}/main`,
    );
    return normalizeUserPayload(response.data);
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
 * Maps avatar upload/remove failures. Unlike the profile form, the 400s here
 * are specific (wrong file type, limit reached, content is not an image), so
 * the backend message is the most useful text.
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
            case 404:
                return 'That photo no longer exists. Refresh and try again.';
            case 413:
                return 'That image is too large. Pick a photo under 5 MB.';
            case 0:
                return 'Network problem — could not reach the server.';
            default:
                return error.message;
        }
    }
    if (error instanceof Error) {
        return error.message;
    }
    return 'Unexpected error while changing the photo. Please try again.';
}
