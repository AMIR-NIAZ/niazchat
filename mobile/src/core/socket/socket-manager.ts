import { createAppSocket, AppSocket } from './socket';

/**
 * Process-wide Socket.IO connection.
 *
 * Created only after authentication (the handshake must carry the Bearer access
 * token, verified at connection time by the backend). Room memberships live
 * per-connection server-side: after a reconnect features re-run `joinChat`.
 *
 * The instance can be replaced (sign-in/sign-out, token refresh); hooks subscribe
 * with `subscribeSocket` so their listeners move to the new instance instead of
 * staying attached to a dead one.
 */
let socket: AppSocket | null = null;
/** Access token captured by the CURRENT handshake (headers are fixed there). */
let socketAccessToken: string | null = null;

type SocketListener = (socket: AppSocket | null) => void;
const socketListeners = new Set<SocketListener>();

function setSocket(next: AppSocket | null): void {
    socket = next;
    socketListeners.forEach((listener) => listener(next));
}

/**
 * Re-authentication in place: updates the token the next handshake carries
 * (both the header the guard reads and the `auth` baggage) and force-reconnects
 * without replacing the socket instance, so feature listeners survive.
 */
export function reconnectSocket(newAccessToken: string): AppSocket {
    if (socket === null) {
        const created = createAppSocket(newAccessToken);
        socketAccessToken = newAccessToken;
        setSocket(created);
        return created;
    }
    socketAccessToken = newAccessToken;
    const ioOptions = socket.io as unknown as {
        opts: { extraHeaders?: Record<string, string> };
    };
    ioOptions.opts.extraHeaders = {
        authorization: `Bearer ${newAccessToken}`,
    };
    socket.auth = { token: newAccessToken };
    if (socket.connected) {
        socket.disconnect();
    }
    socket.connect();
    return socket;
}

export function connectSocket(accessToken: string): AppSocket {
    disconnectSocket();
    const created = createAppSocket(accessToken);
    socketAccessToken = accessToken;
    setSocket(created);
    return created;
}

export function disconnectSocket(): void {
    if (socket) {
        socket.disconnect();
    }
    socketAccessToken = null;
    setSocket(null);
}

/** Token the live socket was created with; null when there is no socket. */
export function getSocketToken(): string | null {
    return socketAccessToken;
}

/** Returns the live socket; `null` only before authentication. */
export function getSocket(): AppSocket | null {
    return socket;
}

/**
 * Notifies on every socket instance change (including `null`). The callback
 * shape matches `useSyncExternalStore`'s subscribe signature.
 */
export function subscribeSocket(listener: SocketListener): () => void {
    socketListeners.add(listener);
    return () => {
        socketListeners.delete(listener);
    };
}
