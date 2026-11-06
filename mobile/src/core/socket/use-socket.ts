import { useSyncExternalStore } from 'react';
import { getSocket, subscribeSocket } from './socket-manager';
import type { AppSocket } from './socket';

/**
 * The live socket instance, re-rendering subscribers when it is replaced.
 * Effects that attach socket listeners should depend on this value so they
 * re-register on the new instance instead of listening to a dead one.
 */
export function useSocket(): AppSocket | null {
    return useSyncExternalStore(
        subscribeSocket,
        getSocket,
        (): AppSocket | null => null,
    );
}
