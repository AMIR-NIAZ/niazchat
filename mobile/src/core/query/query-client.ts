import { QueryClient } from '@tanstack/react-query';

/** Persisted queries must outlive the persister's `maxAge` (7 days). */
export const QUERY_GC_TIME_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Process-wide query cache. A module singleton (not component state) so the
 * logout flow can clear every cached query from outside React.
 *
 * `networkMode: 'offlineFirst'` makes queries attempt the network and keep
 * whatever cached data exists instead of pausing when React Query believes the
 * device is offline. Socket-backed queries still resolve the same way; a
 * failure only matters when there is no cached data to render.
 */
export const appQueryClient = new QueryClient({
    defaultOptions: {
        queries: {
            networkMode: 'offlineFirst',
            retry: 1,
            retryDelay: 1000,
            staleTime: 30_000,
            gcTime: QUERY_GC_TIME_MS,
            // Restored data refreshes once on mount, and again on reconnect.
            refetchOnMount: 'always',
            refetchOnReconnect: true,
            refetchOnWindowFocus: false,
        },
    },
});
