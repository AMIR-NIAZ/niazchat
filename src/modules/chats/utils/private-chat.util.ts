import { TypeChatEnum } from 'src/common/enums/typeChat.enum';

/**
 * Canonical key for an unordered pair of users: `"<smallerId>:<largerId>"`.
 *
 * Order independence is what makes a private chat unique per pair: both users
 * compute the same value whichever side starts the conversation. Stored in
 * `chats."pairKey"` under a UNIQUE index (Postgres allows many NULLs, so group
 * chats are unaffected).
 */
export function pairKeyOf(userA: number, userB: number): string {
    const a = Number(userA);
    const b = Number(userB);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a <= 0 || b <= 0) {
        throw new Error('pair ids must be positive integers');
    }
    const small = Math.min(a, b);
    const large = Math.max(a, b);
    return `${small}:${large}`;
}

/**
 * Chat-list visibility rule: groups always show, a private chat only once at
 * least one message exists (deleted or not) so empty conversations stay hidden.
 */
export function isChatVisibleInList(
    type: TypeChatEnum | null | undefined,
    hasAnyMessage: boolean,
): boolean {
    if (type === TypeChatEnum.PRIVATE) {
        return hasAnyMessage;
    }
    return true;
}

/** Postgres unique-violation detection (works for driver and wrapped errors). */
export function isUniqueViolation(error: unknown): boolean {
    const candidate = error as {
        code?: string;
        driverError?: { code?: string };
    } | null;
    return (
        candidate?.code === '23505' || candidate?.driverError?.code === '23505'
    );
}
