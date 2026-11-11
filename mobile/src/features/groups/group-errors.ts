import { ApiError } from '../../core/api';

/**
 * User-facing message for a failed group member action. Status codes are the
 * stable signal; the backend rewrites every 403 message to `user not access`,
 * so the specific texts live here.
 */
export function describeMemberActionError(error: unknown): string {
    if (error instanceof ApiError) {
        switch (error.statusCode) {
            case 400:
                return 'This action is only available in groups.';
            case 403:
                return "You don't have permission to do this.";
            case 404:
                return 'That member is no longer in this group.';
            case 409:
                return 'This member changed meanwhile. Pull to refresh and try again.';
            case 429:
                return 'Too many actions, please wait a moment.';
            case 0:
                return 'Network problem — could not reach the server.';
            default:
                return error.message;
        }
    }
    return error instanceof Error ? error.message : 'Action failed.';
}

/** Failure messages for group info (title/description) saves. */
export function describeGroupInfoError(error: unknown): string {
    if (error instanceof ApiError) {
        switch (error.statusCode) {
            case 400:
                return error.message;
            case 403:
                return "You no longer have permission to edit this group's info.";
            case 404:
                return 'This group no longer exists.';
            case 429:
                return 'Too many changes, please wait a moment.';
            case 0:
                return 'Network problem — could not reach the server.';
            default:
                return error.message;
        }
    }
    return error instanceof Error
        ? error.message
        : 'Could not save the group info.';
}

/** Failure messages for the group photo (upload/remove). */
export function describeGroupAvatarError(error: unknown): string {
    if (error instanceof ApiError) {
        switch (error.statusCode) {
            case 400:
                return error.message;
            case 403:
                return "You no longer have permission to edit this group's photo.";
            case 404:
                return 'This group no longer exists.';
            case 413:
                return 'That image is too large. Pick a photo under 5 MB.';
            case 429:
                return 'Too many photo changes, please wait a moment.';
            case 0:
                return 'Network problem — could not reach the server.';
            default:
                return error.message;
        }
    }
    return error instanceof Error
        ? error.message
        : 'Could not change the group photo.';
}

/** Failure messages for invite-link list/create/revoke. */
export function describeInviteLinkError(error: unknown): string {
    if (error instanceof ApiError) {
        switch (error.statusCode) {
            case 400:
                return error.message;
            case 403:
                return "You don't have permission to manage invite links.";
            case 404:
                return 'This invite link no longer exists.';
            case 409:
                return 'Too many active invite links. Revoke one first.';
            case 429:
                return 'Too many invite link actions, please wait a moment.';
            case 0:
                return 'Network problem — could not reach the server.';
            default:
                return error.message;
        }
    }
    return error instanceof Error
        ? error.message
        : 'Could not load invite links.';
}

/** Failure messages for the invite preview/join pair. */
export function describeInviteJoinError(error: unknown): string {
    if (error instanceof ApiError) {
        switch (error.statusCode) {
            case 403:
                return "You can't join this group";
            case 404:
                return 'This invite link is invalid or has expired';
            case 429:
                return 'Too many attempts, try again in a moment';
            case 0:
                return 'Network problem — could not reach the server.';
            default:
                return error.message;
        }
    }
    return error instanceof Error
        ? error.message
        : 'Could not open this invite link.';
}

/** Failure messages for the owner's admin-permission editor. */
export function describePermissionsError(error: unknown): string {
    if (error instanceof ApiError) {
        switch (error.statusCode) {
            case 400:
                return 'Those permissions are not valid.';
            case 403:
                return "Only the group owner can change an admin's permissions.";
            case 404:
                return 'This admin is no longer in this group.';
            case 409:
                return 'This member is no longer an admin. The list was refreshed.';
            case 429:
                return 'Too many permission changes, please wait a moment.';
            case 0:
                return 'Network problem — could not reach the server.';
            default:
                return error.message;
        }
    }
    return error instanceof Error
        ? error.message
        : 'Could not save permissions.';
}
