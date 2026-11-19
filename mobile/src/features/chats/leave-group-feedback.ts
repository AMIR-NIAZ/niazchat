import { ApiError } from '../../core/api';

/**
 * Confirmation shown after the server acknowledged a group leave.
 *
 * It must read as a success. This spot used to reuse the 403/404 copy
 * ("You are no longer a member of this group."), so a leave that actually
 * succeeded looked exactly like the old failure popup.
 */
export const LEAVE_GROUP_SUCCESS_MESSAGE = 'You left the group.';

export interface LeaveGroupFailure {
    /** Drop local access: the caller has no membership anymore (403/404). */
    purge: boolean;
    /** Server reason (or a retry hint) — shown in the failure dialog. */
    message: string;
}

/** Maps a rejected leave request to the screen's failure handling. */
export function leaveGroupFailure(error: unknown): LeaveGroupFailure {
    return {
        purge:
            error instanceof ApiError &&
            (error.statusCode === 403 || error.statusCode === 404),
        message:
            error instanceof Error ? error.message : 'Try again in a moment.',
    };
}
