/**
 * New-chat search rules (pure, so they are unit-testable without React):
 * trim, ignore ONE leading `@`, lowercase, minimum 2 characters.
 */
export function normalizeChatSearchQuery(raw: string): string | null {
    const trimmed = raw.trim();
    const withoutAt = trimmed.startsWith('@')
        ? trimmed.slice(1).trim()
        : trimmed;
    return withoutAt.length >= 2 ? withoutAt.toLowerCase() : null;
}

/**
 * A response is stale when a newer request was started (or the field changed)
 * while it was in flight; stale answers must never replace current results.
 */
export function isStaleSearchResponse(
    responseRequestId: number,
    latestRequestId: number,
): boolean {
    return responseRequestId !== latestRequestId;
}
