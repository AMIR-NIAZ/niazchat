/**
 * Chats feature.
 *
 * Backend reality (docs/mobile-api/chats.md, websocket.md):
 * - Chat list & info: WebSocket ONLY (`getAllChats`, `joinChat`/`chatInfo`, `getMessages`).
 * - No unread counts, no server-side search, no pagination.
 * - `POST /chats/create` returns no chat id — the list is refetched after mutation.
 */
export * from './chats-model';
export * from './chats-mapper';
export * from './chats-socket-api';
export * from './use-chats';
export * from './use-groups';
export * from './groups-service';
