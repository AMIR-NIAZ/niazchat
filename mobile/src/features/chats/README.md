# chats & groups feature — implemented surface

## WebSocket (chat list & info — no REST exists)
- `chats-socket-api.ts`: `fetchChats()` (`getAllChats`), `joinChat()` (`joinChat` → `chatInfo` + `getMessages`).
- `use-chats.ts`: TanStack Query over `getAllChats`, live-merged with `chatlist:updated` events.
- `use-groups.ts`: query/mutation hooks (`createGroup`, `addMemberByPhone`, `listBannedMembers`, avatar upload, `chatInfo`, leave-room-on-unmount).

## REST (`groups-service.ts`, via the centralized Axios client)
- `POST /chats/create` — no chat id returned → invalidate `['chats']` and refetch.
- `POST /chats/manage/:groupId/add/:userPhone` — members added by **phone**.
- `POST /chats/manage/upload/avatar/:chatId` — multipart field `avatar`.
- `DELETE /chats/manage/delete/avatar/:chatId`.
- `GET /chats/manage/:chatId/bans` → `{ data: BannedChatMemberDto[] }`.
- `POST /chats/:chatId/ban` — platform-admin surface.

## Members/lookup
`features/users/users-service.ts`: `GET /user/pv/:userName` (`{ data }`), `GET /auth/getme` (bare).

## Backend gaps honored (NOT faked anywhere in UI)
- No unread counts; no server-side search (client-side filter only); no pagination (single fetch of the full list).
- `lastMessage` preview only after live `chatlist:updated` events; private chats have no title.
- No normal-member list, no roles-per-member view, no leave/remove member, no group rename.
- No image-picker dependency yet → group avatar upload is exposed only as a service function until a picker (native module) is added.
