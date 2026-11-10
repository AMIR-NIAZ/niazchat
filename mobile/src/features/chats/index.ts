/**
 * Chats feature.
 *
 * Backend reality (docs/mobile-api/chats.md, websocket.md):
 * - Chat list & info: WebSocket ONLY (`getAllChats`, `joinChat`/`chatInfo`, `getMessages`).
 * - Unread counts come from `getAllChats` (authoritative); `chatlist:updated`
 *   increments locally and `seen`/`chat:read` reset them.
 * - No server-side search, no chat-list pagination.
 * - `POST /chats/create` returns no chat id — the list is refetched after mutation.
 */
export * from './chats-model';
export * from './chats-mapper';
export * from './chats-socket-api';
export * from './chats-cache';
export * from './active-chat';
export * from './local-chat-prefs';
export * from './chat-context-menu';
export * from './use-chats';
export * from './use-groups';
export * from './groups-service';
export * from './private-chat-service';
export * from './open-private-chat';
export * from './chat-search-model';
