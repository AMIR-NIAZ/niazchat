# Groups — group info panel, members and roles

Sources: `src/modules/chats/controllers/group.controller.ts`,
`services/group-members.service.ts`, `services/chat-permission.service.ts`,
`utils/group-members.util.ts`.

The legacy `/chats/manage/*` surface is unchanged. The panel below is a
separate, clean authorization path used by both the enforcement endpoints and
the per-row `actions` flags, so the UI can never offer something the server
would reject.

## Role model (`role_chat`, matched by NAME)

| Role | Panel role | Meaning |
|---|---|---|
| `manager` | `owner` | Group creator. Only the owner promotes/demotes/removes admins. |
| `admin` | `admin` | Can remove regular members only with `ban_user` or `all`. |
| `user` | `member` | Read-only panel. |
| `ban` | — | Banned; never listed, never counted, cannot use the panel. |

`createGroup` assigns the creator `manager` and every invited user `user`.
Groups created before this rule have no `manager`; their owner is `null` until
the backfill in `docs/db-changes.md` is applied. No owner is invented at
runtime.

## Permission matrix (server-enforced)

| Caller | Target owner | Target admin | Target member | Self |
|---|---|---|---|---|
| Owner | — | edit permissions, demote, remove | promote, remove | — |
| Admin with `ban_user`/`all` | — | — | remove | — |
| Admin without `ban_user` | — | — | — | — |
| Member / banned / outsider | — | — | — | — |

Every action re-checks, in one transaction: caller is a non-banned member of
that chat, chat is a live group, target row is in the SAME chat, caller
outranks the target and the target's locked (`FOR UPDATE`) role still matches.
Promoting an admin again / demoting a member again is an idempotent no-op with
`changed: false`.

`DEFAULT_ADMIN_PERMISSIONS` = `ban_user`, `delete_message`,
`change_info_chat` (one constant in `group-members.service.ts`). Promotion
replaces the target's grants with exactly these; demotion deletes ALL their
`permission_admin` rows.

"Remove from group" deletes every `chat_members` row of that user in that chat
(duplicates included) and their permission rows. It is NOT a ban: they can be
added/invited again.

## `GET /chats/:chatId/group`

Any non-banned member. Bare object (project convention, no `data` wrapper):

```json
{
  "id": 42,
  "title": "Team",
  "description": "Weekly sync and releases",
  "avatars": ["uploads/avatars/x.png"],
  "createdAt": "2026-01-01T00:00:00.000Z",
  "membersCount": 5,
  "myRole": "owner",
  "owner": { "userId": 7, "name": "Sara", "username": "sara" },
  "capabilities": {
    "canEditInfo": true,
    "canManageInviteLinks": true,
    "canManageBans": true
  }
}
```

- `description`: nullable group description (same value as `serializeChat`).
- `avatars`: every group photo (up to 10), current first. Chat lists and
  `chatInfo` expose only the current one; this endpoint exposes the full array
  so members can browse the gallery.
- `membersCount`: COUNT(DISTINCT user), banned excluded.
- `owner`: `manager` holder, or `null` when no `manager` exists.
- `myRole`: the caller's highest-ranking row (`owner`/`admin`/`member`).
- `capabilities`: computed for the caller. `canEditInfo` is true for the owner
  and for an admin holding `change_info_chat` or `all`; false for members,
  banned users and outsiders. `canManageBans` is true for the owner and for an
  admin holding `ban_user` or `all` — it gates the "Banned users" row, which is
  hidden for everybody else. The app shows the group-settings gear when
  `myRole` is `owner` or `admin` and lists only features whose capability is
  true.

## `GET /chats/:chatId/members?search=&cursor=&limit=`

Any non-banned member.

- `limit`: default 30, maximum 100.
- `search`: trimmed, case-insensitive on `name` or `username`; minimum 1
  character (empty = no search). `%`, `_` and `\` are escaped.
- Order: owner, then admins, then members; then `chat_members.id` ascending.
- Deduplicated by user (highest-ranking row, then lowest id). Banned excluded.
- Keyset cursor is opaque (base64url of rank + member id); an invalid cursor
  answers 400.
- One query plus the caller context; no N+1.

```json
{
  "items": [
    {
      "memberId": 88,
      "userId": 7,
      "name": "Sara",
      "username": "sara",
      "avatars": ["uploads/avatars/x.png"],
      "isOnline": true,
      "lastSeen": null,
      "role": "admin",
      "actions": {
        "canPromote": false,
        "canDemote": true,
        "canRemove": true,
        "canEditPermissions": true
      }
    }
  ],
  "nextCursor": "djE6Mjoz"
}
```

`actions` is computed for the CALLER with the same pure functions the action
endpoints use. `canEditPermissions` is true only when the caller is the owner
and the target is an ADMIN of that chat. No phone number is ever included.

## `GET /chats/:chatId/banned?cursor=&limit=`

Banned users (`role_chat.name = 'ban'` rows) of the group. Owner, or an admin
holding `ban_user`/`all`; every other caller answers 403 (`You don't have
permission to do this`), members and banned users included.

- `limit`: default 30, maximum 100 (same clamp as the members list).
- Order: newest ban first (`chat_members.id` DESC, so a fresh ban is always on
  the first page).
- Deduplicated by user: the OLDEST membership row of each banned user is the
  one listed.
- Keyset cursor is the last `memberId` of the previous page as a string; any
  other value answers 400. `nextCursor: null` means the last page.
- These rows are never part of `GET /chats/:chatId/members` and never counted
  in `membersCount`.

```json
{
  "items": [
    {
      "memberId": 91,
      "userId": 12,
      "name": "Nima",
      "username": "nima",
      "avatars": ["uploads/avatars/n.png"],
      "bannedAt": "2026-02-03T10:11:12.000Z"
    }
  ],
  "nextCursor": "91"
}
```

`avatars` is the current photo only, in the same stored-path wire format as the
members list (the app absolutizes it). `bannedAt` is the banned row's
`updatedAt`; `null` if the row has no timestamp.

## Unban

```
POST /chats/manage/onban/:memberId
```

Reuses the legacy route (the ban state lives on `chat_members`, not in a
separate table). Same rule as the banned-users list: the owner, or an admin
holding `ban_user`/`all`. An admin without the grant gets 403 `missing
permission(s): ban_user`; a target that is not banned answers 400; acting on
the owner is rejected.

Unbanning restores the member's `user` role — a former admin comes back as a
plain member, without permission grants — and does NOT join them to the chat
room: they receive `group:added { chatId }` on their personal room and join
on their next `joinChat`. Everyone currently in the chat room receives
`group:changed { chatId, reason: 'member_unbanned' }`, plus
`chat:members { chatId, membersCount }` with the restored count.

```json
{ "message": "user on baned successfully" }
```

## Actions

```
POST   /chats/:chatId/members/:memberId/promote
POST   /chats/:chatId/members/:memberId/demote
DELETE /chats/:chatId/members/:memberId
```

Any authenticated user may call them (global auth guard); the service decides.
Ids are validated integers.

```json
{ "memberId": 88, "role": "admin", "changed": true }
```

`role` is `null` after removal. Per-user rate limit: 30 actions per minute
(Redis fixed window through the existing `RateLimitService`, 429 otherwise).

## Admin permissions (owner only)

```
GET /chats/:chatId/members/:memberId/permissions
PUT /chats/:chatId/members/:memberId/permissions   { "permissions": string[] }
```

Only the owner (`manager`) may call either endpoint. The target must be an
ADMIN row of THAT chat; a plain member, the owner, the caller or a banned user
answers 409 `Only admins have permissions`, and a member id from another chat
answers 404. Saves use another per-user limit: 30 changes per minute (429).

```json
{
  "memberId": 88,
  "userId": 7,
  "role": "admin",
  "available": [
    { "key": "ban_user", "label": "Remove members" },
    { "key": "delete_message", "label": "Delete messages" },
    { "key": "change_info_chat", "label": "Edit group info" }
  ],
  "granted": ["ban_user", "delete_message", "change_info_chat"],
  "hasAll": false
}
```

`granted` is the effective set: a legacy `all` row reads as all three keys and
sets `hasAll: true` (the UI shows a note). `PUT` replaces the set with EXACTLY
the body's set. The body must be an array of at most three unique values from
`delete_message`, `change_info_chat`, `ban_user`; `[]` is valid and removes all
grants; `all`, duplicates and unknown names answer 400. Saving the same
effective set answers `changed: false` and writes nothing. A legacy `all` row
is converted to the explicit selected set (equivalent to today's bypass) and
the `all` row is removed.

```json
{ "memberId": 88, "granted": ["ban_user"], "changed": true }
```

One transaction locks the caller and every `chat_members` row of the target
user, re-checks owner/group/role, deletes all grants across duplicate rows and
inserts the new set on the canonical row (highest role, then lowest id). Reads
union grants across duplicate rows, so every duplicate stays consistent. A
role change between the pre-check and the lock answers 409.

### Enforcement today (measured)

| Permission | Enforced where | Enforced? |
|---|---|---|
| `ban_user` | New panel `DELETE /chats/:chatId/members/:memberId` and `GET /chats/:chatId/banned`; legacy kick, ban-list and unban routes | Yes |
| `change_info_chat` | New `PATCH /chats/:chatId/group` + group avatar routes (`GroupInfoService`); legacy `/chats/manage/*` | Yes |
| `delete_message` | No route checks it; message deletion allows the sender or group owner only | **No** |
| `all` | `ChatPermissionService.canEditInfo` / `ChatAccessService.assertPermissions` / legacy `ManagerChatGuard` bypass | Yes |

`change_info_chat` is now real for group info. `all` is never offered by the
editor, but a legacy `all` grant bypasses the check.

## Edit group info (title, description, photos)

Every endpoint below requires a non-banned member of THAT chat, a live group
(private chats answer 400) and `canEditInfo` (403 otherwise). The owner always
qualifies; an admin needs `change_info_chat` or `all`.

```
PATCH  /chats/:chatId/group                     { title?: string, description?: string | null }
POST   /chats/:chatId/group/avatars             multipart field `avatar` (exactly one image)
DELETE /chats/:chatId/group/avatars/:fileName   one photo, by stored file NAME
PUT    /chats/:chatId/group/avatars/:fileName/main
```

A group keeps up to **10** photos, current FIRST (`avatars[0]`). The wire
identifier is always the stored file NAME (basename), never an array index or
a client path. Every read (`GET /chats/:chatId/group`) returns the full array;
chat lists/headers and `chatInfo` expose only the current photo.

`PATCH` body: at least one field; unknown fields answer 400. The title is
sanitized (trimmed, line breaks collapsed to spaces, control characters
stripped) and must be 1..64 characters after sanitizing; an empty title is
400. The description is trimmed, at most 255 characters, and an empty value
clears it to `null`. One transaction locks the chat row; identical values
answer `changed: false` and emit nothing. Per-user limit: 20 text edits per
minute (429).

```json
{ "id": 42, "title": "Team", "description": null, "avatars": ["uploads/avatars/x.png"], "changed": true }
```

Photos: only jpeg/png/webp verified by content with `sharp` (declared MIME must
match), 5 MiB cap (413), `limitInputPixels` bounded, random server-generated
name in `uploads/avatars` (the same directory the thumbnail route serves).

- `POST .../avatars` PREPENDS the new photo (it becomes current) and keeps the
existing ones. The 10-photo limit is checked by a guard BEFORE multer stores
the file and again inside the locked transaction; two concurrent uploads
neither lose a photo nor exceed 10. When 10 already exist the answer is
**400** `This group has reached the limit of 10 photos. Delete one before
uploading a new photo.` and no file is left behind.
- `DELETE .../avatars/:fileName` removes exactly that entry (404 when the name
is not in THAT chat's array, 400 for path-shaped names). Deleting the current
photo makes the next one current; deleting the last leaves `[]` (initials).
The original file and every cached thumbnail are removed (best effort).
- `PUT .../avatars/:fileName/main` moves the photo to index 0, keeping the
relative order of the others; already-current answers `changed: false`.
- Every write returns the FULL new array:

```json
{ "id": 42, "avatars": ["uploads/avatars/<new>.png", "uploads/avatars/<old>.png"], "changed": true }
```

All three consume the same per-user photo limit (20/minute, 429).

### Legacy single-photo routes

`POST /chats/:chatId/group/avatar` and `DELETE /chats/:chatId/group/avatar`
still exist for old clients but no longer use the replace-and-delete-all
behavior:

- `POST` is an alias of `POST .../avatars`: it ADDS the photo as current.
- `DELETE` removes ONLY the current photo (`changed: false` when the group has
  none). The next photo becomes current.

Thumbnails: `GET /media/avatars/:size/:fileName` (64/128/256) already reads
`uploads/avatars`, so group photos need no extra route; file names are unique
per upload, so the URL is immutable and cacheable forever.

### Errors

| Status | Message / meaning |
|---|---|
| 400 | `This action is only available in groups` (private chat), invalid cursor, invalid title/description |
| 403 | `You don't have permission to do this`, not a member, banned, owner target |
| 404 | Target member not in this group / group gone |
| 409 | Role changed meanwhile / member already gone (`changed` not guessed) |
| 404 | Photo file name is not in this group's `avatars` |
| 413 | Avatar file larger than 5 MiB |
| 429 | `Too many group photo changes, please try again later` |

The global filter rewrites every 403 body to `user not access`; clients branch
on the status code.

## Realtime

After commit (never blocking the response):

| Event | Room | Payload |
|---|---|---|
| `group:changed` | `chat:<chatId>` | `{ chatId, reason: 'role_changed' \| 'member_removed' \| 'permissions_changed' \| 'info_changed' \| 'avatars_changed', userId }` |
| `group:updated` | every member's `user:<userId>` | `{ chatId, title, avatars }` after a committed info/photo change (FULL photo array, current first) |
| `group:removed` | `user:<userId>` | `{ chatId, reason: 'kicked' }` |
| `chat:members` | `chat:<chatId>` | `{ chatId, membersCount }` after removal |

A committed permission save emits `group:changed` with
`reason: 'permissions_changed'` and the target `userId`; it is sent after commit
and never blocks the HTTP response.

For a removed user every socket of that user leaves `chat:<chatId>`, its
`data.chatId` is cleared, `typing:stop` is emitted once and the room's online
count is recomputed. Membership checks already make `joinChat` / `getMessages`
fail and `getAllChats` no longer returns the group.

## Existing-group backfill

See `docs/db-changes.md` — the SQL promotes the earliest-created `admin` row of
every manager-less group to `manager`. It is documented, ready to run, and NOT
executed by this change.

## Invite links (group settings)

Owner/admin only management, plus an authenticated preview/join pair so links
actually work. Capability: `GET /chats/:chatId/group` now also returns
`capabilities.canManageInviteLinks` (true for `manager` and every `admin`,
false for members, banned users and outsiders). Every manage call re-checks the
caller, group type and ban state inside the transaction.

### Manage endpoints (30 requests/minute per user)

`GET /chats/:chatId/invite-links`

```json
{
  "items": [
    {
      "id": 12,
      "code": "kQ3v8m2Xy7pLr4Tz1aBcDe",
      "status": "active",
      "createdBy": { "userId": 42, "name": "Sara" },
      "createdAt": "2026-11-11T10:00:00.000Z",
      "expiresAt": null,
      "maxUses": 10,
      "usesCount": 2,
      "revokedAt": null
    }
  ],
  "activeCount": 1,
  "maxActive": 10
}
```

All ACTIVE links (server clock: not revoked, not expired, uses remain) plus the
20 most recent inactive links, newest first. `status` is one of `active`,
`expired`, `used_up`, `revoked`. `expiresAt: null` = never; `maxUses: null` =
unlimited; `createdBy.userId: null` = legacy link whose creator is unknown.

`POST /chats/:chatId/invite-links` body (both fields optional; strict
allowlists, anything else is 400):

```json
{ "expiresInSeconds": 86400, "maxUses": 10 }
```

- `expiresInSeconds`: `3600 | 86400 | 604800 | 2592000 | null`
- `maxUses`: `1 | 5 | 10 | 50 | 100 | null`
- Codes are 22 characters, `^[A-Za-z0-9_-]{22}$`, generated server-side from
  `crypto.randomBytes(16)` base64url; a unique collision is retried up to 3
  times.
- More than 10 active links: **409** `Too many active invite links. Revoke one first.`
  The count and insert share one transaction with the chat row locked.

`DELETE /chats/:chatId/invite-links/:linkId` → `{ "id": 12, "status": "revoked", "changed": true }`.
Idempotent: revoking twice answers `changed: false`. A link id from another
chat is 404. Revoking never touches members who already joined.

Errors: 400 private chat / invalid body; 403 not a member or no capability;
404 link not in this chat; 409 active limit; 429 rate limit.

### Join endpoints (authenticated)

`GET /invites/:code`

```json
{
  "title": "Team",
  "description": "Release group",
  "avatar": "uploads/avatars/group.jpg",
  "membersCount": 8,
  "alreadyMember": false,
  "chatId": null
}
```

`chatId` is only set when `alreadyMember` is true. `avatar` is the current
group photo path or `null`.

`POST /invites/:code/join` → `{ "chatId": 3, "title": "Team", "joined": true, "alreadyMember": false }`.

Rules:

- New members get role `user`; one row only (duplicate membership rows are
  deduped by user). An existing member answers `alreadyMember: true`, inserts
  nothing and consumes no use.
- A user with a `ban` row in that chat always gets **403**
  `You can't join this group`.
- Every other invalid state — unknown code, malformed code, revoked, expired,
  used up, private/banned chat, legacy short code — answers the SAME **404**
  `This invite link is invalid or has expired` so states are not leaked.
- Join locks the link row, inserts the member and increments `usesCount` with a
  conditional UPDATE (`usesCount < maxUses`) in one transaction; rolling back
  when the limit was reached meanwhile.
- Rate limits: 20 joins/minute and 30 previews/minute per user → 429 with a
  clear message.
- `membersCount` everywhere counts DISTINCT non-banned users.

### Realtime

After commit (never blocking the response): create/revoke emits
`group:changed { chatId, reason: 'invite_links_changed', userId }` to
`chat:<chatId>`; a new join emits `group:changed { chatId, reason:
'member_joined', userId }`, `group:added { chatId }` to the joiner's
`user:<id>` room (the app refetches its chat list on `group:added`) and
`chat:members { chatId, membersCount }`.

### Legacy routes

`POST /chats/join/:code` delegates to the new join service (same checks, same
404/403 behavior), so banned users cannot re-join and duplicate rows are never
created. The legacy manage routes (`POST|GET /chats/manage/:chatId/link`,
`DELETE /chats/manage/:chatId/link/:linkId`) delegate to the new service too
(used by `scripts/private-chat.js`): revoke now verifies the link belongs to the
same chat, and create/list use the clean authorization. Missing checks are no
longer reachable.
