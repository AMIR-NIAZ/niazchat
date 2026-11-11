import {
    clearPendingInviteCode,
    peekPendingInviteCode,
    setPendingInviteCode,
    takePendingInviteCode,
} from './pending-invite';

const CODE = 'kQ3v8m2Xy7pLr4Tz1aBcDe';

describe('pending invite continuation', () => {
    afterEach(() => {
        clearPendingInviteCode();
    });

    it('survives the login redirect and is consumed by the guest guard', () => {
        setPendingInviteCode(CODE);
        // Login screen mounts; the guard reads and clears the code.
        expect(peekPendingInviteCode()).toBe(CODE);
        expect(takePendingInviteCode()).toBe(CODE);
        expect(peekPendingInviteCode()).toBeNull();
        // A second redirect (e.g. remount) must not replay the old invite.
        expect(takePendingInviteCode()).toBeNull();
    });

    it('overwrites an older code with the newest link', () => {
        setPendingInviteCode('A'.repeat(22));
        setPendingInviteCode(CODE);
        expect(takePendingInviteCode()).toBe(CODE);
    });
});
