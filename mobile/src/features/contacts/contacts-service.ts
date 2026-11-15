import { ApiError, httpClient } from '../../core/api';
import { chunkPhones } from './contacts-phone';

/**
 * `POST /contacts/match` (docs/mobile-api/contacts.md).
 *
 * The app uploads normalized numbers only, in batches of at most 500, with at
 * most two requests in flight. Results are merged by user id.
 */

export interface ContactsMatchItemDto {
    userId: number;
    name: string;
    username: string | null;
    avatars: string[];
    phone: string;
}

/** How many batches may be uploaded concurrently. */
const MAX_PARALLEL_BATCHES = 2;

export async function matchContacts(
    phones: readonly string[],
): Promise<ContactsMatchItemDto[]> {
    const batches = chunkPhones(phones);
    const byUserId = new Map<number, ContactsMatchItemDto>();
    let cursor = 0;

    const worker = async (): Promise<void> => {
        while (cursor < batches.length) {
            const batch = batches[cursor];
            cursor += 1;
            if (batch === undefined) {
                return;
            }
            const response = await httpClient.post<{
                items?: ContactsMatchItemDto[];
            }>('/contacts/match', { phones: batch });
            for (const item of response.data.items ?? []) {
                byUserId.set(Number(item.userId), {
                    ...item,
                    userId: Number(item.userId),
                    username: item.username ?? null,
                    avatars: item.avatars ?? [],
                });
            }
        }
    };

    const workers = Array.from(
        { length: Math.min(MAX_PARALLEL_BATCHES, batches.length) },
        (): Promise<void> => worker(),
    );
    await Promise.all(workers);

    return [...byUserId.values()];
}

/** User-safe messages for the Contacts tab. */
export function describeContactsMatchError(error: unknown): string {
    if (error instanceof ApiError) {
        switch (error.statusCode) {
            case 429:
                return 'Too many requests, try again in a minute.';
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
    return 'Could not match your contacts.';
}
