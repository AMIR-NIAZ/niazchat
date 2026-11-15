import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { deviceDefaultRegion } from './contacts-phone';
import { readAddressBook } from './contacts-device';
import type { AddressBookIndex } from './contacts-device';
import { describeContactsMatchError, matchContacts } from './contacts-service';
import type { ContactsMatchItemDto } from './contacts-service';
import { buildMatchedContacts } from './contacts-model';
import type { MatchedContact } from './contacts-model';
import { getAddressBookIndex, setAddressBookIndex } from './contacts-store';

/**
 * Address book → registered users, with ONE stable, persisted query:
 * `['contacts', 'matches']`.
 *
 * The key deliberately does NOT contain a hash of the uploaded numbers: that
 * made every address-book change a brand-new cache entry which could never be
 * restored offline. Instead the query holds a map of every match ever found
 * (`normalizedPhone → user`) plus `checked` (numbers already uploaded that did
 * not match), so a refresh only sends genuinely new numbers — and the matched
 * numbers again once per day to pick up changed names/avatars.
 *
 * The address book itself (names included) stays in memory only; the persisted
 * map contains registered users and normalized numbers, never the raw book.
 */

export const CONTACTS_MATCHES_QUERY_KEY = ['contacts', 'matches'] as const;

/** Known matches are re-sent at most this often (changed names/avatars). */
const KNOWN_REFRESH_MS = 24 * 60 * 60 * 1000;
const MATCHES_STALE_MS = 5 * 60_000;

export interface StoredContactMatch {
    userId: number;
    /** Account display name. */
    name: string;
    username: string | null;
    /** Server-relative avatar paths (resolved to URLs when displayed). */
    avatars: string[];
    /** Canonical E.164 number that matched. */
    phone: string;
}

/** Shape persisted under `['contacts', 'matches']`. */
export interface ContactsMatchesData {
    /** `normalizedPhone` → registered user. Only matches are stored. */
    matches: Record<string, StoredContactMatch>;
    /** Normalized numbers already uploaded that did not match (no names). */
    checked: string[];
    /** When known matches were last re-uploaded; null = never. */
    matchesRefreshedAt: number | null;
}

export const EMPTY_CONTACTS_MATCHES: ContactsMatchesData = {
    matches: {},
    checked: [],
    matchesRefreshedAt: null,
};

/** Stored match → the DTO shape `buildMatchedContacts` consumes. */
function toStoredMatch(item: ContactsMatchItemDto): StoredContactMatch {
    return {
        userId: Number(item.userId),
        name: item.name,
        username: item.username ?? null,
        avatars: item.avatars ?? [],
        phone: item.phone,
    };
}

function uniquePhones(phones: Iterable<string>): string[] {
    return [...new Set(phones)];
}

export interface ContactMatchesApi {
    contacts: MatchedContact[];
    /** First device read / first match is still running and nothing to show. */
    isLoading: boolean;
    isRefreshing: boolean;
    error: string | null;
    refresh: () => void;
}

export function useContactMatches(enabled: boolean): ContactMatchesApi {
    const queryClient = useQueryClient();
    const [index, setIndex] = useState<AddressBookIndex | null>(() =>
        getAddressBookIndex(),
    );
    const [reading, setReading] = useState(false);
    const [readError, setReadError] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);
    const region = useMemo(() => deviceDefaultRegion(), []);

    const query = useQuery<ContactsMatchesData>({
        queryKey: CONTACTS_MATCHES_QUERY_KEY,
        staleTime: MATCHES_STALE_MS,
        // Reading the device needs permission; without it the persisted map is
        // still rendered (as app names) by the screen.
        enabled: enabled && index !== null,
        queryFn: async (): Promise<ContactsMatchesData> => {
            const previous =
                queryClient.getQueryData<ContactsMatchesData>(
                    CONTACTS_MATCHES_QUERY_KEY,
                ) ?? EMPTY_CONTACTS_MATCHES;
            const book = getAddressBookIndex();
            if (book === null) {
                return previous;
            }

            const checked = new Set(previous.checked);
            const unknown = book.phones.filter(
                (phone) =>
                    previous.matches[phone] === undefined &&
                    !checked.has(phone),
            );
            const now = Date.now();
            const refreshKnown =
                previous.matchesRefreshedAt === null ||
                now - previous.matchesRefreshedAt >= KNOWN_REFRESH_MS;
            const toSend = uniquePhones(
                refreshKnown
                    ? [...Object.keys(previous.matches), ...unknown]
                    : unknown,
            );
            if (toSend.length === 0) {
                return previous;
            }

            // Failures propagate: the query keeps its previous (persisted)
            // data, so an offline refresh never empties the list.
            const items = await matchContacts(toSend);
            const matches = { ...previous.matches };
            for (const item of items) {
                const phone = typeof item.phone === 'string' ? item.phone : '';
                if (phone === '') {
                    continue;
                }
                matches[phone] = toStoredMatch(item);
            }
            // A number is "checked" when it did not become a key of the map
            // (unmatched, or a second number of the same person) so it is not
            // uploaded again on every refresh.
            for (const phone of unknown) {
                if (!(phone in matches)) {
                    checked.add(phone);
                }
            }

            return {
                matches,
                checked: [...checked],
                matchesRefreshedAt: refreshKnown
                    ? now
                    : previous.matchesRefreshedAt,
            };
        },
    });

    const refetch = query.refetch;
    useEffect((): (() => void) | void => {
        if (!enabled) {
            return;
        }
        let active = true;
        // A pull-to-refresh re-reads the book FIRST and then refetches, so
        // contacts added since the last read are part of the request.
        const fromRefresh = reloadToken > 0;
        setReading(true);
        setReadError(null);
        readAddressBook(region)
            .then((next): void => {
                if (!active) {
                    return;
                }
                setAddressBookIndex(next);
                setIndex(next);
                if (fromRefresh) {
                    void refetch();
                }
            })
            .catch((): void => {
                if (active) {
                    setReadError('Could not read your contacts.');
                }
            })
            .finally((): void => {
                if (active) {
                    setReading(false);
                }
            });
        return (): void => {
            active = false;
        };
    }, [enabled, region, reloadToken, refetch]);

    // Local names are memory-only: the persisted map never contains the book.
    const nameByPhone = useMemo(
        () => index?.nameByPhone ?? new Map<string, string>(),
        [index],
    );
    const data = query.data;
    const contacts = useMemo(
        () =>
            buildMatchedContacts(
                Object.values(data?.matches ?? EMPTY_CONTACTS_MATCHES.matches),
                nameByPhone,
            ),
        [data, nameByPhone],
    );

    const refresh = useCallback((): void => {
        // The read effect refetches once the fresh book is in memory.
        setReloadToken((value): number => value + 1);
    }, []);

    const error =
        readError ??
        (query.isError ? describeContactsMatchError(query.error) : null);

    return {
        contacts,
        isLoading:
            enabled &&
            (reading ||
                index === null ||
                (query.isPending && query.data === undefined)),
        isRefreshing: reading || query.isRefetching,
        error,
        refresh,
    };
}
