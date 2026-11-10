import { io, Socket } from 'socket.io-client';
import { env } from '../config/env';
import { ApiError } from '../api/api-error';
import type {
    ChatListUpdateDto,
    ForwardMessagesPayloadDto,
    ForwardMessagesResultDto,
    MessageDto,
} from '../api/dto/message.dto';
import type { ChatDto } from '../api/dto/chat.dto';

/**
 * Socket.IO setup (docs/mobile-api/websocket-contract.md).
 *
 * Key backend facts encoded here:
 * - No namespace, plain connection to the API origin.
 * - The access token rides the handshake `authorization` header; connection-time
 *   auth fails the handshake (`connect_error`) on an invalid/expired token. The
 *   `auth.token` field mirrors the token and is (re)set by the socket manager on
 *   rotation.
 * - Rooms: `user:<userId>` (joined server-side at connect) and `chat:<chatId>`
 *   (joined via the `joinChat` event).
 * - Every request/response event acks `{ ok: true, data }` on success and
 *   `{ ok: false, message, status }` on failure (guards/pipes/handlers all go
 *   through the same WsExceptionFilter). Use the single `request` helper.
 */

/** Server → client events (documented subset). */
export interface ServerToClientEvents {
    chatInfo: (chat: ChatDto) => void;
    getMessages: (messages: MessageDto[]) => void;
    exception: (payload: {
        ok: false;
        message: string;
        status: number;
    }) => void;
    'sendMessage:list': (message: MessageDto) => void;
    'editMessage:list': (message: MessageDto) => void;
    'deleteMessage:list': (messageId: number) => void;
    'chatlist:updated': (update: ChatListUpdateDto) => void;
    seen: (payload: {
        chatId: number;
        userId: number;
        lastSeenId: number | null;
    }) => void;
    /** Caller's read position advanced (any device) — clear the badge. */
    'chat:read': (payload: { chatId: number; unreadCount: number }) => void;
    /** Live non-banned member count after a membership change. */
    'chat:members': (payload: { chatId: number; membersCount: number }) => void;
    countUsersOnline: (count: number) => void;
    'typing:start': (payload: {
        chatId: number;
        userId: number;
        userName: string;
    }) => void;
    'typing:stop': (payload: {
        chatId: number;
        userId: number;
        userName: string;
    }) => void;
}

/** Standard ack shapes (backend WsExceptionFilter). */
export interface WsAck<T = unknown> {
    ok: boolean;
    data?: T;
    message?: string;
    status?: number;
}

export interface GetMessagesSocketPayload {
    chatId: number;
    /** Exclusive cursor: return messages with id < beforeId. */
    beforeId?: number;
    /** 1..100, server default 30. */
    limit?: number;
}

export interface ChatIdPayload {
    chatId: number;
}

export type SocketAckHandler = (response: WsAck) => void;

/** Client → server events. */
export interface ClientToServerEvents {
    getAllChats: (ack: (response: WsAck) => void) => void;
    joinChat: (payload: ChatIdPayload, ack: SocketAckHandler) => void;
    leaveChat: (payload: { chatId?: number }, ack: SocketAckHandler) => void;
    userTyping: (payload: ChatIdPayload, ack: SocketAckHandler) => void;
    userEndTyping: (payload: ChatIdPayload, ack: SocketAckHandler) => void;
    sendMessage: (
        payload: CreateMessageSocketPayload,
        ack: SocketAckHandler,
    ) => void;
    editMessage: (
        payload: EditMessageSocketPayload,
        ack: SocketAckHandler,
    ) => void;
    deleteMessage: (
        payload: DeleteMessageSocketPayload,
        ack: SocketAckHandler,
    ) => void;
    getMessages: (
        payload: GetMessagesSocketPayload,
        ack: SocketAckHandler,
    ) => void;
    markSeen: (payload: MarkSeenSocketPayload, ack: SocketAckHandler) => void;
    forwardMessages: (
        payload: ForwardMessagesSocketPayload,
        ack: SocketAckHandler,
    ) => void;
}

export type ForwardMessagesSocketPayload = ForwardMessagesPayloadDto;
export type ForwardMessagesResult = ForwardMessagesResultDto;

export interface MarkSeenSocketPayload {
    chatId: number;
    lastSeenId: number;
}

export interface CreateMessageSocketPayload {
    chatId?: number;
    userId?: number;
    content?: string;
    reply?: number;
    attachments?: number[];
    clientMessageId?: string;
}

export interface EditMessageSocketPayload {
    messageId: number;
    chatId: number;
    newContent: string;
}

export interface DeleteMessageSocketPayload {
    messageId: number;
    chatId: number;
}

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Connect-time listeners: every (re)connect of any fresh socket fires these. */
const connectListeners = new Set<(socket: AppSocket) => void>();
let firstConnectDone = false;

/**
 * Auth-failure observers (the session layer refreshes + reconnects). Socket
 * errors are never HTTP statuses, so detection is message/status based:
 * handshake `connect_error`, an `exception` event, or an ack with status 401.
 */
const authErrorListeners = new Set<() => void>();

export function registerSocketAuthErrorHandler(
    listener: () => void,
): () => void {
    authErrorListeners.add(listener);
    return () => {
        authErrorListeners.delete(listener);
    };
}

export function notifySocketAuthError(): void {
    authErrorListeners.forEach((listener) => listener());
}

/** Matches the backend's auth messages (guard: "token in valid, …"). */
export function isSocketAuthErrorMessage(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
        normalized.includes('token in valid') ||
        normalized.includes('jwt expired') ||
        normalized.includes('unauthorized') ||
        normalized.includes('invalid token')
    );
}

export function createAppSocket(accessToken: string): AppSocket {
    const socket: AppSocket = io(env.wsUrl, {
        // Header is what the `wsPayload` guard reads at handshake and per event.
        extraHeaders: {
            authorization: `Bearer ${accessToken}`,
        },
        auth: { token: accessToken },
        transports: ['websocket'],
        autoConnect: true,
    });

    socket.on('connect', () => {
        if (firstConnectDone) {
            connectListeners.forEach((listener) => listener(socket));
        }
        firstConnectDone = true;
    });

    socket.on('connect_error', (error: Error) => {
        if (isSocketAuthErrorMessage(String(error.message))) {
            notifySocketAuthError();
        }
    });

    socket.on('exception', (payload) => {
        if (
            payload.status === 401 ||
            isSocketAuthErrorMessage(String(payload.message))
        ) {
            notifySocketAuthError();
        }
    });

    return socket;
}

/**
 * Run `listener` on every socket (re)connect after the first one — the point
 * for re-joining rooms and refetching data after a reconnect. Safe across
 * reconnects and StrictMode double mounts: the listener set is process-global
 * and each effect adds/removes exactly one listener.
 */
export function onSocketReconnect(
    listener: (socket: AppSocket) => void,
): () => void {
    connectListeners.add(listener);
    return () => {
        connectListeners.delete(listener);
    };
}

const REQUEST_TIMEOUT_MS = 10_000;

/** The one timeout every WS request shares; failures surface on the ack. */
export const SOCKET_REQUEST_TIMEOUT_MS = REQUEST_TIMEOUT_MS;

/**
 * Single request/response helper: emits `event` with a trailing ack callback
 * and resolves `data` on `{ ok: true }`; rejects with `ApiError` on
 * `{ ok: false }`, a missing ack, or the single timeout. Callers must not add
 * their own timers or exception listeners.
 */
export function request<T>(
    socket: AppSocket,
    event: string,
    payload?: unknown,
): Promise<T | null> {
    return new Promise<T | null>((resolve, reject) => {
        const settle = once(resolve, reject);
        const timer = setTimeout(() => {
            settle.reject(
                new ApiError({
                    success: false,
                    statusCode: 0,
                    message: `Request '${event}' timed out.`,
                }),
            );
        }, REQUEST_TIMEOUT_MS);

        const ack = (response: unknown): void => {
            clearTimeout(timer);
            const parsed = response as WsAck | undefined;
            if (parsed?.ok === true) {
                settle.resolve((parsed.data as T | undefined) ?? null);
            } else {
                // Ack-level auth failures (after the handshake) share the
                // reconnect/refresh path with handshake failures.
                if (parsed?.status === 401) {
                    notifySocketAuthError();
                }
                settle.reject(
                    new ApiError({
                        success: false,
                        statusCode: parsed?.status ?? 0,
                        message:
                            parsed?.message ?? `Request '${event}' failed.`,
                    }),
                );
            }
        };

        const emit = socket.emit.bind(socket) as unknown as (
            event: string,
            ...args: unknown[]
        ) => void;
        emit(event, payload ?? undefined, ack);
    });
}

interface Once<T> {
    resolve: (value: T | null) => void;
    reject: (error: unknown) => void;
}

function once<T>(
    resolve: (value: T | null) => void,
    reject: (error: unknown) => void,
): Once<T> {
    let settled = false;
    return {
        resolve: (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        },
        reject: (error) => {
            if (settled) return;
            settled = true;
            reject(error);
        },
    };
}
