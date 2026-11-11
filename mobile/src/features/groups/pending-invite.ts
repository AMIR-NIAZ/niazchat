/**
 * In-memory continuation for a join link opened while logged out.
 *
 * The join screen stores the code, sends the user through the normal login
 * flow, and the guest-only auth guard sends them back to `/join/<code>` after
 * authentication. This deliberately does NOT survive an app kill (no storage):
 * a cold start simply lands on the chat list.
 */

let pendingCode: string | null = null;

export function setPendingInviteCode(code: string): void {
    pendingCode = code;
}

export function peekPendingInviteCode(): string | null {
    return pendingCode;
}

/** Read and clear in one step (used by the auth guard). */
export function takePendingInviteCode(): string | null {
    const code = pendingCode;
    pendingCode = null;
    return code;
}

export function clearPendingInviteCode(): void {
    pendingCode = null;
}
