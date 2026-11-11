import type { AppSocket } from './socket';

type AnyListener = (...args: never[]) => void;

/**
 * Bind ONE socket.io listener to ONE instance and return its detach function.
 *
 * `readHandler` is called at delivery time, so a React hook can keep the
 * handler in a ref: a new handler identity never re-subscribes, while a socket
 * instance change always detaches the old listener and binds the new one.
 * Keeping this pure makes the re-subscription rule unit-testable without a
 * renderer.
 */
export function bindSocketEvent(
    socket: AppSocket | null,
    event: string,
    readHandler: () => AnyListener,
): () => void {
    if (socket === null) {
        return (): void => undefined;
    }
    const listener: AnyListener = (...args): void => {
        readHandler()(...args);
    };
    const on = socket.on.bind(socket) as unknown as (
        event: string,
        listener: AnyListener,
    ) => void;
    const off = socket.off.bind(socket) as unknown as (
        event: string,
        listener: AnyListener,
    ) => void;
    on(event, listener);
    return (): void => {
        off(event, listener);
    };
}
