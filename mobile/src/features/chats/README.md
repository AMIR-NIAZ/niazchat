# chats & groups feature — implemented surface

## WebSocket (chat list & info — no REST exists)
- `chats-socket-api.ts`: `fetchChats()` (`getAllChats`), `joinChat()` (`joinChat` → `chatInfo` + `getMessages`).
- `use-chats.ts`: TanStack Query over `getAllChats`, live-merged with `chatlist:updated` events; `unreadCount` is authoritative from the fetch and incremented locally by live messages (never for own messages or the chat being read). `chat:read`/successful `markSeen` reset it; focus/reconnect refetch.
- `active-chat.ts`: module-level record of the open chat + whether the user is reading at the bottom.
- `use-groups.ts`: query/mutation hooks (`createGroup`, `addMemberByPhone`, `leaveGroup`, `myChatRole`, `listBannedMembers`, avatar upload, `chatInfo`, leave-room-on-unmount).
- `chat-context-menu.tsx`: long-press bottom sheet (pin/unpin, mark as read, leave group with the owner rule).
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

## Members/lookup
`features/users/users-service.ts`: `GET /user/pv/:userName` (`{ data }`), `GET /auth/getme` (bare).

## Backend gaps honored (NOT faked anywhere in UI)
- Unread counts exist (`getAllChats`); no server-side search (client-side filter only); no chat-list pagination (single fetch of the full list).
- `lastMessage` preview only after live `chatlist:updated` events; private chats have no title.
- No normal-member list, no roles-per-member view, no remove-member route, no group rename.
- No pin, mute, per-user chat delete or mark-unread storage exists server-side: pinning is device-local (SecureStore, not synced), mute/delete/unread are intentionally not offered.
- Mark-as-read reuses the WS `markSeen` (monotonic); there is no way to mark a chat unread again.
- Owner identity is `myRole === 'manager'` from the `joinChat` ack (the creator is stored as `manager`; `admin` is a different role).
- No image-picker dependency yet → group avatar upload is exposed only as a service function until a picker (native module) is added.
