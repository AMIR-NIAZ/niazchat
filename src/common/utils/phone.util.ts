/**
 * Canonical E.164 form of an Iranian phone number, e.g. `+989121112255`.
 *
 * `@IsPhoneNumber('IR')` accepts every common spelling of the same number
 * (`+989121112255`, `0098912112255`, `09121112255`), so the raw request body
 * must never be used as an OTP cache key: the send and verify calls can carry
 * different spellings of the same number and would then look at different
 * keys. Everything (cache key, user lookup, ban check) goes through here.
 *
 * Values that are not recognisably numeric are returned unchanged, so the DTO
 * validators still produce the real 400 for malformed input.
 */
export function normalizePhone(value: string): string {
    if (typeof value !== 'string') {
        return value;
    }

    const trimmed = value.trim().replace(/[\s\-().]/g, '');
    if (trimmed === '' || !/^\+?\d+$/.test(trimmed)) {
        return value;
    }

    let digits = trimmed.startsWith('+') ? trimmed.slice(1) : trimmed;

    if (digits.startsWith('0098')) {
        // 0098 912 111 2255
        digits = digits.slice(4);
    } else if (digits.startsWith('98') && digits.length > 10) {
        // 98 912 111 2255 (no leading +)
        digits = digits.slice(2);
    } else if (digits.startsWith('0')) {
        // 0912 111 2255
        digits = digits.slice(1);
    }

    return `+98${digits}`;
}
