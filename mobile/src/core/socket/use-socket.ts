import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
    getSocket,
    getSocketConnectionState,
    subscribeSocket,
    subscribeSocketConnection,
    type SocketConnectionState,
} from './socket-manager';
import { bindSocketEvent } from './socket-event';
import type { AppSocket, ServerToClientEvents } from './socket';

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

/** Transport state of the live socket (`connected` / `connecting` / down). */
export function useSocketConnectionState(): SocketConnectionState {
    return useSyncExternalStore(
        subscribeSocketConnection,
        getSocketConnectionState,
        (): SocketConnectionState => 'disconnected',
    );
}

/**
 * Subscribe to one server event on the CURRENT socket instance.
 *
 * - The handler is read from a ref at delivery time, so an inline handler never
 *   re-subscribes and never misses between renders.
 * - The subscription is torn down and re-created when the instance changes
 *   (token refresh / sign-in replacing the socket).
 * - Unmount removes exactly this listener: no duplicates under StrictMode.
 */
export function useSocketEvent<E extends keyof ServerToClientEvents>(
    event: E,
    handler: ServerToClientEvents[E],
): void {
    const socket = useSocket();
    const handlerRef = useRef(handler);

    useEffect((): void => {
        handlerRef.current = handler;
    });

    useEffect(
        (): (() => void) =>
            bindSocketEvent(
                socket,
                event as string,
                () => handlerRef.current as (...args: never[]) => void,
            ),
        [socket, event],
    );
}
