# chats & groups feature — implemented surface

## WebSocket (chat list & info — no REST exists)
- `chats-socket-api.ts`: `fetchChats()` (`getAllChats`), `joinChat()` (`joinChat` → `chatInfo` + `getMessages`).
- `use-chats.ts`: TanStack Query over `getAllChats`, live-merged with `chatlist:updated` events; `unreadCount` is authoritative from the fetch and incremented locally by live messages (never for own messages or the chat being read). `chat:read`/successful `markSeen` reset it; focus/reconnect refetch.
- `active-chat.ts`: module-level record of the open chat + whether the user is reading at the bottom.
- `active-room.ts`: which `chat:<id>` room the single socket owns and which chat screen is focused. The backend allows one active room per socket, so the room follows focus: blur leaves it, focus re-joins it (with a one-page resync) — this is what keeps read receipts/live events working after a chat is pushed over another and popped back. The marker is cleared on socket disconnect.
- `use-groups.ts`: query/mutation hooks (`createGroup`, `addMemberByPhone`, `leaveGroup`, `myChatRole`, `listBannedMembers`, avatar upload, `chatInfo`, leave-room-on-unmount — only for the screen that currently owns the room).
- `chat-list-actions.ts` + `chat-row-preview.tsx`: long-press floating popup (pin/unpin, mark as read with an optimistic badge, group info / view profile, leave group with the owner rule) over a lifted copy of the row. Mute/archive/delete-chat are intentionally absent: the backend has no behaviour for them yet, and `getChatListActions` is where they will be added.
- Owner moderation (chat role `manager`, never `admin`): the chat panel lists active members and bans them via `POST /chats/manage/ban/:memberId`; the message sheet offers "Delete for everyone" on other members' messages.
- `local-chat-prefs.ts`: pinned chat ids persisted per user in SecureStore (`usePinnedChatIds`).
- `chats-cache.ts`: `purgeChatFromCaches` — shared post-leave cache/active-chat cleanup.

## REST (`groups-service.ts`, via the centralized Axios client)
- `POST /chats/create` — no chat id returned → invalidate `['chats']` and refetch.
- `POST /chats/manage/:groupId/add/:userPhone` — members added by **phone**.
- `POST /chats/:chatId/leave` — the caller leaves a group; the group **owner** (`manager` chat role, never `admin`) is rejected server-side (400), no ownership transfer.
- `POST /chats/manage/upload/avatar/:chatId` — multipart field `avatar`.
- `DELETE /chats/manage/delete/avatar/:chatId`.
- `GET /chats/manage/:chatId/bans` → `{ data: BannedChatMemberDto[] }`.
- `POST /chats/:chatId/ban` — platform-admin surface.

## Private (one-to-one) chats
- `private-chat-service.ts`: `POST /chats/private { userId }` → `{ chatId, created, peer }`; server-side idempotent per unordered pair, 30 creations/hour (existing chats do not count).
- `open-private-chat.ts`: THE entry point. Reuses a cached private chat with the peer (no request), otherwise creates it, seeds the conversation cache with the peer (header paints immediately), never inserts the empty chat into the list cache, and navigates (`push` from a profile, `replace` from the new-chat screen). One in-flight request per peer blocks double taps.
- `new-chat.tsx`: debounced (300 ms) username search, auto-focused, min 2 chars after one optional `@`, stale answers dropped, `keyboardShouldPersistTaps="handled"`; result tap calls `openPrivateChat(..., { replace: true })`.
- `chat-search-model.ts`: pure query normalization + stale-response predicate (unit-tested).
- `chats-model.ts`: `isPrivateChat(chat)` is the ONLY private test (`type === 'private'`; unknown = group) and `getChatDisplay(chat)` is the ONLY name/avatar resolver (peer for private, group data otherwise). Chat list, header, context menu, forward picker and search all use them.
- Chat screen: private header shows the peer name/photo (tap → profile) and a presence subtitle from `useUserProfile` (30 s while focused + on foreground, seeded from `peer`); typing shows the animated "typing" line. No member count, no admin button, no sender names/avatars.

## Members/lookup
`features/users/users-service.ts`: `GET /user/pv/:userName` (`{ data }`), `GET /user/search?q=` (`{ data }` whitelist: id/name/username/current avatar only), `GET /auth/getme` (bare).

## Backend gaps honored (NOT faked anywhere in UI)
- Unread counts exist (`getAllChats`); no server-side search (client-side filter only); no chat-list pagination (single fetch of the full list).
- `lastMessage` preview only after live `chatlist:updated` events; private chats have no title.
- No normal-member list, no roles-per-member view, no remove-member route, no group rename.
- No pin, mute, per-user chat delete or mark-unread storage exists server-side: pinning is device-local (SecureStore, not synced), mute/delete/unread are intentionally not offered.
- Mark-as-read reuses the WS `markSeen` (monotonic); there is no way to mark a chat unread again.
- Owner identity is `myRole === 'manager'` from the `joinChat` ack (the creator is stored as `manager`; `admin` is a different role).
- No image-picker dependency yet → group avatar upload is exposed only as a service function until a picker (native module) is added.
