import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { deviceDefaultRegion } from './contacts-phone';
import { readAddressBook } from './contacts-device';
import type { AddressBookIndex } from './contacts-device';
import { describeContactsMatchError, matchContacts } from './contacts-service';
import { buildMatchedContacts } from './contacts-model';
import type { MatchedContact } from './contacts-model';
import { getAddressBookIndex, setAddressBookIndex } from './contacts-store';

/**
 * Address book → registered users.
 *
 * The device is read in slices (see `readAddressBook`), only normalized
 * numbers are uploaded (max 2 batches in flight), and the result is cached by
 * a hash of the uploaded list for 5 minutes.
 */

const MATCHES_STALE_MS = 5 * 60_000;

export function contactMatchesQueryKey(hash: string) {
    return ['contacts', 'match', hash] as const;
}

export interface ContactMatchesApi {
    contacts: MatchedContact[];
    /** First read or first match is still running. */
    isLoading: boolean;
    isRefreshing: boolean;
    error: string | null;
    refresh: () => void;
}

export function useContactMatches(enabled: boolean): ContactMatchesApi {
    const [index, setIndex] = useState<AddressBookIndex | null>(() =>
        getAddressBookIndex(),
    );
    const [reading, setReading] = useState(false);
    const [readError, setReadError] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);
    const region = useMemo(() => deviceDefaultRegion(), []);

    useEffect((): (() => void) | void => {
        if (!enabled) {
            return;
        }
        let active = true;
        setReading(true);
        setReadError(null);
        readAddressBook(region)
            .then((next): void => {
                if (!active) {
                    return;
                }
                setAddressBookIndex(next);
                setIndex(next);
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
    }, [enabled, region, reloadToken]);

    const hash = index?.hash ?? 'none';
    const query = useQuery({
        queryKey: contactMatchesQueryKey(hash),
        queryFn: (): Promise<MatchedContact[]> =>
            matchContacts(index?.phones ?? []).then((items) =>
                buildMatchedContacts(items, index?.nameByPhone ?? new Map()),
            ),
        enabled: enabled && index !== null,
        staleTime: MATCHES_STALE_MS,
    });

    const refresh = useCallback((): void => {
        setReloadToken((value): number => value + 1);
        void query.refetch();
        // `refetch` is stable across renders; adding the query object would
        // recreate the callback on every state change.
    }, [query.refetch]);

    const error =
        readError ??
        (query.isError ? describeContactsMatchError(query.error) : null);

    return {
        contacts: query.data ?? [],
        isLoading: enabled && (reading || index === null || query.isPending),
        isRefreshing: reading || query.isRefetching,
        error,
        refresh,
    };
}
