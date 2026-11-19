import { ApiError } from '../../core/api';
import {
    LEAVE_GROUP_SUCCESS_MESSAGE,
    leaveGroupFailure,
} from './leave-group-feedback';

function apiError(statusCode: number, message: string): ApiError {
    return new ApiError({ success: false, statusCode, message });
}

describe('leave group feedback', () => {
    it('success reads as a success, never as the old error popup', () => {
        expect(LEAVE_GROUP_SUCCESS_MESSAGE).toBe('You left the group.');
        // The regression: the success path reused the 403/404 sentence.
        expect(LEAVE_GROUP_SUCCESS_MESSAGE).not.toBe(
            'You are no longer a member of this group.',
        );
        expect(LEAVE_GROUP_SUCCESS_MESSAGE).not.toContain('no longer a member');
    });

    it('keeps a genuine non-member failure and drops local access', () => {
        const failure = leaveGroupFailure(
            apiError(403, 'you are not a member of this group'),
        );

        expect(failure.message).toBe('you are not a member of this group');
        expect(failure.purge).toBe(true);
    });

    it('keeps the owner restriction message without dropping access', () => {
        const ownerMessage =
            'the group owner cannot leave the group. Give ownership to another member first (ownership transfer is not supported yet)';
        const failure = leaveGroupFailure(apiError(400, ownerMessage));

        expect(failure.message).toBe(ownerMessage);
        expect(failure.purge).toBe(false);
    });

    it('a missing route/chat still reports the failure after dropping access', () => {
        const failure = leaveGroupFailure(
            apiError(404, 'Cannot POST /chats/21/leave'),
        );

        expect(failure.message).toBe('Cannot POST /chats/21/leave');
        expect(failure.purge).toBe(true);
    });

    it('a network/unexpected error keeps caches and shows a retry hint', () => {
        const failure = leaveGroupFailure(new Error('Network Error'));

        expect(failure.message).toBe('Network Error');
        expect(failure.purge).toBe(false);
        expect(leaveGroupFailure(undefined).message).toBe(
            'Try again in a moment.',
        );
    });
});
