import { QueryClient } from '@tanstack/react-query';

/**
 * Process-wide query cache. A module singleton (not component state) so the
 * logout flow can clear every cached query from outside React.
 */
export const appQueryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: 1,
            staleTime: 30_000,
            refetchOnWindowFocus: false,
        },
    },
});
