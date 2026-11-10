# Feature Matrix

Backend-verified capabilities (each row cites the source modules analyzed). "Partial" = exists but incomplete/broken; mark accordingly in the mobile UX.

## Authentication & identity

| Feature                    | State        | Notes / Source                                                                                                                                  |
| -------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Phone (Iran) OTP login     | ✅ (caveats) | Works, but OTP delivery is a stub (`console.log`), 60 s rate limit, `00000` in non-production (`otp.service.ts`, `message.service.ts` [common]) |
| JWT access + refresh       | ✅           | 1 h / 30 d; refresh requires non-standard `token` header (`auth.service.ts`, `jwt.service.ts`)                                                  |
| Logout / token revocation  | ❌           | No endpoint; ban clears refresh token only for admins (`auth.service.ts#banUser`)                                                               |
| User profiles & avatar     | ✅           | Name/username/bio update; multi-avatar gallery (up to 10, set current, delete) via `user.controller.ts`                                         |
| Ban phone / platform admin | ✅           | owner/admin routes (`auth.controller.ts`)                                                                                                       |

## Chats

| Feature             | State          | Notes                                                                                                                                        |
| ------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Private 1:1 chats   | ⚠️ Partial     | Created implicitly by sending a message (`message.service.ts#sendPv`); no direct "start chat"/chat-header REST; unlock via WS `getAllChats`  |
| Group creation      | ⚠️ Partial     | `POST /chats/create` returns no chat id; only message + refetch (`chat.service.ts#createGroup`)                                              |
| Channel type        | ⚠️ Unsupported | Enum + seeded rows exist; no creation path, no broadcast semantics (`typeChat.enum.ts`)                                                      |
| Chat list           | ⚠️ WS-only     | `getAllChats`; no REST; `lastMessage` not populated in list                                                                                  |
| Chat info           | ⚠️ Partial     | `chatInfo` event per `joinChat`; no "edit title" endpoint                                                                                    |
| Chat avatars        | ✅             | upload/delete via `chats/manage/*` (`change_info_chat`)                                                                                      |
| Invite links        | ⚠️ Partial     | Create/list/deactivate; but `code` is 32 chars in a 20-char column → likely DB error on create (`link.entity.ts` vs `inviteLink.service.ts`) |
| Chat ban (platform) | ✅             | `POST /chats/:chatId/ban` (admin)                                                                                                            |

## Groups & members

| Feature                         | State      | Notes                                                                                                      |
| ------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| Add member by phone             | ✅         | `POST /chats/manage/:groupId/add/:userPhone`                                                               |
| Member list                     | ❌         | No REST or WS event to list normal members; only banned list (`chats.service.getAllBanUser`)               |
| Promote/demote chat admin       | ✅         | manage/admin/\* routes                                                                                     |
| Per-admin permissions           | ⚠️ Partial | `addPermissionforAdmin` looks up role `ban` instead of `admin` — broken (`permissionChat.service.ts`)      |
| Manager (owner) role assignment | ❌         | Group creator gets `admin`, no flow sets `manager`; `ManagerChatGuard` has a manager tier nobody can reach |
| Leave / remove member           | ❌         | No endpoint                                                                                                |
| Ban / unban member              | ✅         | `ban/:memberId`, `onban/:memberId`, `:chatId/bans`                                                         |

## Messaging

| Feature                               | State             | Notes                                                                                                                                                                                                                              |
| ------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Send text (both contexts)             | ✅                | WS `sendMessage`, membership-required for chat flow, PV auto-creates                                                                                                                                                               |
| Reply to message                      | ⚠️ Partial        | `reply` id accepted, but `replyTo` is **not loaded** in list/single payloads (added via `loadMessage` relationships — only `id` in rows)                                                                                           |
| Edit message                          | ⚠️ Partial        | Own, text-type only; no time limit                                                                                                                                                                                                 |
| Delete message                        | ⚠️ Partial        | Own-only soft delete; no admin/moderator deletion uses `delete_message` permission; peers get just the id (no tombstone)                                                                                                           |
| History fetch                         | ✅                | Cursor pagination via `getMessages { chatId, beforeId?, limit? }` (default 30, max 100); newest-first pages with `hasMore`/`nextCursor` (`message.service.ts#getPage`)                                                             |
| Message type ↑ image/video/voice/file | ⚠️ Partial        | DTO accepts the types & `type_messages` rows are seeded; UI-wise only text handler registered; content isn't validated. Voice is delivered as `kind: 'voice'` on a text-type message with a single attachment (see attachments.md) |
| Read receipts                         | ✅ (single level) | Monotonic `markSeen` per viewer per chat (`chat_seen`); `seen` room event, `othersLastSeenId` in `chatInfo`; unread counts in `getAllChats`. No per-member seen list.                                                              |
| Typing                                | ✅                | `userTyping`/`userEndTyping` → `typing:start/stop` (only bubbles to the current room; emitter excluded)                                                                                                                            |
| Reactions                             | ❌ Broken         | `addReaction` throws `user already reacted` when none exists — inverted guard (`reactions.service.ts`); kits also assume reacts seeded (they are not)                                                                              |
| Forward messages                      | ✅                | WS `forwardMessages`: 1–20 source messages → 1–5 targets, copied attachments (new rows/files), `forwardedFrom` origin snapshot, per-target isolation, request idempotency + rate limit (`message-forward.service.ts`)              |

## Attachments

| Feature                                 | State          | Notes                                                                                                                                                |
| --------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload → send flow                      | ✅             | pending → attached single-use in a transaction; size/MIME validated (`attachment.service.ts`)                                                        |
| Download                                | ✅             | authorized streaming; per-chat membership or uploader; inline for images/videos/voice, `attachment` for files                                        |
| Preview of images in chat               | ⚠️ Client-side | Backend always forces `attachment;` disposition / no inline rendering — RN clients fetch & cache locally                                             |
| Cleanup of orphaned pending attachments | ✅             | 6 h TTL job; soft-deleted message files removed after 24 h (`attachment-cleanup.service.ts`)                                                         |
| Voice messages                          | ✅             | `voice=1` upload, ffprobe container/codec validation, 15 MB / 11 min limits, 64-bar waveform, single-attachment + empty-text rule (`attachments.md`) |

## Presence

| Feature                     | State      | Notes                                                                                                  |
| --------------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| isOnline / lastSeen updates | ❌ Broken  | `UserGateway` has no auth guard; `client.data.user` is never set → no state change (`user.gateway.ts`) |
| Online count per chat       | ⚠️ Partial | `countUsersOnline` event exists and works at the room level even if presence flags are broken          |

---

## Summary of what the backend CAN support today (mobile build guidance)

1. Authenticating with phone+OTP and keeping the JWT session alive.
2. Building both private and group conversations using only WS events (`getAllChats`, `joinChat`, `sendMessage`, `getMessages`) plus `chatlist:updated` for list previews.
3. Sending text and text+attachments; uploading files (chat attachments) with proper validation; authorized downloads for media.
4. Showing someone's read position per chat (`seen` lastSeenId) and live typing when the user has joined the chat room.
5. Admin actions in groups (add by phone, ban/unban, chat avatar, invite links) when the caller has permission.

## What the backend CANNOT support yet — backend changes required before frontend integration

1. **Fix presence**: authenticate `UserGateway` (`wsPayload` at handshake or connection) and join personal rooms; update `isOnline/lastSeen`.
2. **Fix reactions service** (inverted already-reacted check; wrongly rejects valid users).
3. **Return `chat.id`** from `POST /chats/create` (and probably normalize list/info responses into DTOs with `lastMessage`, member count).
4. ~~Paginate message history~~ — done: cursor-based `getMessages` (`beforeId`/`limit`, `hasMore`/`nextCursor`). Still missing: full `replyTo` data and deleted-message tombstones.
5. **Fix invite-link `code` length** mismatch (32 vs 20) in the DB/entity.
6. **Fix `addPermissionforAdmin`** role lookup (`ban` → `admin`).
7. **Member list endpoint** (REST or WS) per chat; group title update; leave/remove member flows.
8. **Wire a real OTP sender** and confirm production phone validation (`IsPhoneNumber('IR')` limits to Iranian numbers).
9. **Optional but recommended**: standardize response envelopes (all wrapped vs bare), fix REST/WS naming typos (`groupe`, `baned`, `uploade-avatar`, refresh `token` header) or document them as canonical, add per-message read receipts if chat UI requires them, and expose admin `delete_message` permission functionality.
10. **Confirm chat type semantics for `channel`** or remove it from the mobile surface for now.
