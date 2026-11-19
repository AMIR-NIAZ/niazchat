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
| `manager` | `owner` | Group creator. Implicitly holds every permission and cannot be restricted. |
| `admin` | `admin` | Acts according to its permission set (see the matrix below). |
| `user` | `member` | Read-only panel; may still hold explicit grants (e.g. `pin_messages`). |
| `ban` | — | Banned; never listed, never counted, cannot use the panel. |

`createGroup` assigns the creator `manager` and every invited user `user`.
Groups created before this rule have no `manager`; their owner is `null` until
the backfill in `docs/db-changes.md` is applied. No owner is invented at
runtime.

## Permission matrix (server-enforced)

| Caller | Target owner | Target admin | Target member |
|---|---|---|---|
| Owner | — | edit permissions, demote, remove, **ban** | promote, remove, **ban** |
| Admin with `manage_admins` | — | demote **only own promotees** (`promotedById`) | promote |
| Admin with `manage_permissions` | — | edit permissions **only own promotees** | — |
| Admin with `remove_members` | — | — | remove |
| Admin with `ban_users` | — | — | **ban** |
| Admin without the matching permission | — | — | — |
| Member / banned / outsider | — | — | — |

`hasPermission(role, permissions, key)` is the only resolver: the owner passes
everything, `all` is a wildcard, and `manage_messages` implies
`delete_other_messages` + `pin_messages`. Nobody may act on themselves, and no
route ever targets the owner.

### The 12 permissions (contract)

| Key | English | Persian | Active |
|---|---|---|---|
| `edit_group_info` | Edit Group Info | ویرایش اطلاعات گروه | yes |
| `manage_members` | Manage Members | مدیریت اعضا | yes |
| `remove_members` | Remove Members | حذف اعضا | yes |
| `ban_users` | Ban Users | مسدود کردن کاربران | yes |
| `manage_invites` | Manage Invites | مدیریت دعوت‌ها | yes |
| `pin_messages` | Pin Messages | سنجاق کردن پیام‌ها | yes |
| `delete_other_messages` | Delete Other Messages | حذف پیام دیگران | yes |
| `manage_messages` | Manage Messages | مدیریت پیام‌ها | yes (implies delete + pin) |
| `restrict_members` | Restrict Members | محدود کردن دسترسی اعضا | **no** — stored/editable only |
| `manage_voice_chats` | Manage Voice Chats | مدیریت چت صوتی | **no** — stored/editable only |
| `manage_admins` | Manage Admins | مدیریت ادمین‌ها | yes |
| `manage_permissions` | Manage Permissions | مدیریت پرمیژن‌ها | yes |

Legacy stored values are migrated on read: `change_info_chat → edit_group_info`,
`ban_user → ban_users`, `delete_message → delete_other_messages`,
`pin_message → pin_messages`; `all` stays the wildcard ("Full admin").

A ban sets the target's `role_chat` to `ban` (the same representation the
banned list reads) and deletes their permission grants. The row is NOT
deleted: this is what distinguishes a ban from "remove". Nobody can ban the
owner or themselves, an admin can never ban another admin, and a target that
is already banned answers 409.

Every action re-checks, in one transaction: caller is a non-banned member of
that chat, chat is a live group, target row is in the SAME chat, caller
outranks the target and the target's locked (`FOR UPDATE`) role still matches.
Promoting an admin again / demoting a member again is an idempotent no-op with
`changed: false`.

`DEFAULT_ADMIN_PERMISSIONS` = `delete_other_messages`, `ban_users`,
`remove_members`, `pin_messages` (only used by the legacy promote route with no
body). The panel promote route accepts `{ "permissions": string[] }` and stores
exactly that set. Demotion deletes ALL the target's `permission_admin` rows and
clears `promotedById`.

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
    "canManageInvites": true,
    "canManageInviteLinks": true,
    "canManageBans": true,
    "canRemoveMembers": true,
    "canManageMembers": true,
    "canDeleteOthersMessages": true,
    "canPinMessages": true,
    "canManageAdmins": true,
    "canManagePermissions": true,
    "canRestrictMembers": true,
    "canManageVoiceChats": true,
    "canManageMemberPermissions": true,
    "canAddMembers": true,
    "canInviteViaLink": true
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
- `capabilities`: computed for the caller with `hasPermission` (additive; every
  new flag is derived from the 12-key contract). `canManageInviteLinks` is kept
  as an alias of `canManageInvites`. Each flag gates exactly the feature named
  after it; the settings hub lists only rows whose flag is true. The app shows
  the gear when `myRole` is `owner` or `admin`.
- `canManageMemberPermissions`: owner, or admin with `manage_permissions`.
- `canAddMembers`: owner/admin with `manage_members`, or a regular member when
  the group's `add_members` switch is on.
- `canInviteViaLink`: owner/admin with `manage_invites`, or a regular member
  when the group's `invite_via_link` switch is on.
- `canPinMessages` for a regular member follows `memberPermissions.pin_messages`
  (admins keep their own grant).

## Add members (User ID or saved contacts)

```
GET  /chats/:chatId/add-members/lookup?userId=<numeric User ID>
POST /chats/:chatId/members   { "userIds": [12, 34, 56] }
```

The **User ID** is the numeric `users.id` that the profile screens display
(`docs/mobile-api/users.md`); it is never a `chat_members.id`, a contact row id
or any other internal join-table key. Mobile sends only that public numeric id
and the backend resolves it to the user record. The saved contacts path uses the
existing `GET /contacts` list and sends the same `contact.userId` values, so both
methods reach one server operation.

Authorization is enforced by `canAddMembersCapability`: the owner or an admin
holding `manage_members`, or a regular member whose **effective** `add_members`
state is on (group default resolved with that member's individual
`inherit`/`allow`/`deny` override). `lookup` and `add` use the same check, so a
screen can never offer an action the server would reject.

`GET .../add-members/lookup` returns a narrow projection only:

```json
{
  "userId": 42,
  "name": "Sara",
  "username": "sara",
  "avatars": ["uploads/avatars/current.png"],
  "isMember": false,
  "isBanned": false
}
```

Unknown/inactive ids answer `404 User not found`. A blocked pair answers the same
generic `404`, so the endpoint cannot be used to probe accounts. No phone,
status, timestamps or membership row ids are included.

`POST /chats/:chatId/members` accepts 1–50 positive user ids per request
(deduplicated server-side) and answers `200` with partial success:

```json
{
  "added": [
    {
      "memberId": 88,
      "userId": 42,
      "name": "Sara",
      "username": "sara",
      "avatars": ["uploads/avatars/current.png"],
      "role": "member"
    }
  ],
  "failed": [
    {
      "userId": 99,
      "code": "already_member",
      "message": "This user is already a member"
    }
  ],
  "membersCount": 6
}
```

`failed[].code` is one of `not_found`, `already_member`, `banned`, `blocked`
(blocked deliberately says only that the person "cannot be added", never why).
The accepted users commit in ONE transaction; a per-chat advisory lock plus an
in-transaction permission/membership re-check prevents duplicate rows under
concurrent requests. Banned membership rows are never restored by this route.
Rate limit: 30 additions/minute per caller (`429`).

After commit the server emits `group:changed { chatId, reason: 'member_joined' }`
to `chat:<chatId>`, `group:added { chatId }` to every added user's
`user:<id>` room, one `system` `member_added` message per accepted user (live
`sendMessage:list` + `chatlist:updated`), and the final
`chat:members { chatId, membersCount }`. Offline clients resync from
`GET /chats/:chatId/group` / `GET /chats/:chatId/members`.

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
      "permissions": ["delete_other_messages", "ban_users"],
      "promotedById": 42,
      "actions": {
        "canPromote": false,
        "canDemote": true,
        "canRemove": true,
        "canEditPermissions": true,
        "canBan": true
      }
    }
  ],
  "nextCursor": "djE6Mjoz"
}
```

`permissions` is the normalized grant set for an ADMIN (empty for members and
the owner); `promotedById` is who promoted that admin (`null` for legacy rows,
the owner and plain members). `actions` is computed for the CALLER with the
same pure functions the endpoints use, including the `promotedById` rules:
`canDemote`/`canEditPermissions` are owner-always and admin-with-the-permission
for their OWN promotees only. No phone number is ever included.

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
POST   /chats/:chatId/members/:memberId/promote   { "permissions": string[] }
POST   /chats/:chatId/members/:memberId/demote
DELETE /chats/:chatId/members/:memberId
POST   /chats/:chatId/members/:memberId/ban
```

Any authenticated user may call them (global auth guard); the service decides.
Ids are validated integers.

```json
{ "memberId": 88, "role": "admin", "changed": true }
```

`role` is `null` after removal (and after a ban, which has no group role).
Per-user rate limit: 30 actions per minute (Redis fixed window through the
existing `RateLimitService`, 429 otherwise).

Every membership change (join via invite link, add by admin, leave, ban, kick)
also writes exactly one `system` message in the same transaction and broadcasts
it to the group (see [messages.md](./messages.md#service-system-messages)). A
repeated call that changes nothing (already a member / already banned) writes
no message.

## Ban a member

```
POST /chats/:chatId/members/:memberId/ban
```

Rules (the app's `canBan` row flag is the same pure function):

| Caller | Owner | Admin | Member | Self |
|---|---|---|---|---|
| Owner | 403 | ban | ban | 403 |
| Admin with `ban_users`/`all` | 403 | 403 | ban | 403 |
| Admin without `ban_users` | 403 | 403 | 403 | 403 |
| Member / banned / outsider | 403 | 403 | 403 | 403 |

One transaction locks the caller and every `chat_members` row of the target
user, re-checks the live group (private chats answer 400), the caller's role
and `ban_users`, self/owner protection and the target's locked role. Every
duplicate row of the target becomes `ban`; all their `permission_admin` grants
are deleted. The membership rows are kept (that IS the ban); the user
disappears from `GET /chats/:chatId/members` and `membersCount`, and appears
in `GET /chats/:chatId/banned` immediately.

Response:

```json
{ "memberId": 88, "role": null, "changed": true }
```

Errors:

| Status | Meaning |
|---|---|
| 400 | private chat (`This action is only available in groups`), invalid ids |
| 403 | `You don't have permission to do this` — no capability, self, or owner target |
| 404 | member not found in this group |
| 409 | `user is already banned`, or `cannot ban this user` when the role changed before the lock |
| 429 | `Too many group actions, please try again later` |

The global filter rewrites every 403 body to `user not access`; clients branch
on the status code. A ban is reversible only through unban; the other paths
that would restore access already reject a `ban` row: invite-link join answers
403 `You can't join this group`, adding by phone answers 409 `user is banned
from this group and cannot be added`, and the message/room guards (`wsIsBanMember`,
`ChatAccessService`) reject reads and sends.

Realtime after commit: the banned user's `user:<id>` room receives
`group:removed { chatId, reason: 'banned' }`, every socket of theirs leaves
`chat:<chatId>` (chat list, open chat and typing state are dropped client
side), and the chat room receives
`group:changed { chatId, reason: 'member_banned', userId }` followed by
`chat:members { chatId, membersCount }`. The legacy owner-only
`POST /chats/manage/ban/:memberId` is unchanged.

## Admin permissions (`manage_permissions`)

```
GET /chats/:chatId/members/:memberId/permissions
PUT /chats/:chatId/members/:memberId/permissions   { "permissions": string[] }
```

The owner may read/edit any admin. An admin holding `manage_permissions` may
read/edit only admins whose `promotedById` is them, and may only grant keys it
holds itself (`canGrantPermissions`). The target must be an ADMIN of THAT chat;
a plain member, the owner, the caller or a banned user answers 409 `Only admins
have permissions`, and a member id from another chat answers 404. Saves use a
per-user limit of 30/minute (429).

```json
{
  "memberId": 88,
  "userId": 7,
  "role": "admin",
  "available": [
    {
      "key": "delete_other_messages",
      "label": "Delete Other Messages",
      "active": true,
      "description": "Delete messages written by other members.",
      "implies": []
    },
    {
      "key": "manage_messages",
      "label": "Manage Messages",
      "active": true,
      "description": "Moderate messages. Includes deleting others’ messages and pinning.",
      "implies": ["delete_other_messages", "pin_messages"]
    }
  ],
  "granted": ["delete_other_messages", "ban_users"],
  "hasAll": false,
  "grantable": ["delete_other_messages", "manage_messages"],
  "promotedById": 42
}
```

- `available` always lists all 12 keys (with `active`, `description`, `implies`).
- `grantable` is the subset the CALLER may grant (owner: all 12).
- `granted` is the effective explicit set; a legacy `all` row reads as all 12
  keys with `hasAll: true` ("Full admin").
- `PUT` replaces the set with EXACTLY the body's set. Unknown keys → 400;
  duplicates are removed; `[]` removes every grant; `all` is owner-only (403 for
  anybody else). A non-owner editor may not grant a key they lack (403).
- Saving the same effective set answers `changed: false` and writes nothing.

```json
{ "memberId": 88, "granted": ["ban_users"], "hasAll": false, "changed": true }
```

One transaction locks the caller and every `chat_members` row of the target
user, re-checks `manage_permissions`, `promotedById`, the grant subset and the
role, then deletes all grants across duplicate rows and inserts the new set on
the canonical row. A role change between the pre-check and the lock answers 409.

### Enforcement matrix (measured)

| Permission | Endpoint / action it gates | Active |
|---|---|---|
| `edit_group_info` | `PATCH /chats/:chatId/group`, group avatar add/remove/set-main, legacy title/avatar routes | yes |
| `manage_members` | `POST /chats/:chatId/members`, `GET /chats/:chatId/add-members/lookup`, legacy `POST /chats/manage/:groupId/add/:userPhone` | yes |
| `remove_members` | `DELETE /chats/:chatId/members/:memberId`, legacy kick | yes |
| `ban_users` | `POST /chats/:chatId/members/:memberId/ban`, `GET /chats/:chatId/banned`, unban + legacy ban routes | yes |
| `manage_invites` | invite link create/list/revoke | yes |
| `pin_messages` | message pin/unpin (WS) | yes |
| `delete_other_messages` | deleting another member's message (WS); own messages always allowed | yes |
| `manage_messages` | umbrella — implies `delete_other_messages` + `pin_messages` | yes |
| `manage_admins` | promote and demote (demote only own promotees unless owner) | yes |
| `manage_permissions` | read/save an admin's permission set (own promotees unless owner) | yes |
| `restrict_members` | stored/editable only — no feature behind it | **no** |
| `manage_voice_chats` | stored/editable only — no feature behind it | **no** |

`all` is never offered as a normal key, but a legacy `all` grant bypasses every
check. Inactive permissions are storable and editable, marked `active: false`
and clearly labelled "Not available yet".

## Edit group info (title, description, photos)

Every endpoint below requires a non-banned member of THAT chat, a live group
(private chats answer 400) and `canEditInfo` (403 otherwise). The owner always
qualifies; an admin needs `edit_group_info` or `all`.

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

## Member permissions (group-wide policy)

Separate from the 12 per-admin grants: these ten switches define what the
REGULAR MEMBER role may do in this group. Owners always pass; admins keep
their `permission_admin` grants. Every default is centralized in
`member-permissions.util.ts` and mirrored by the app.

| Key | Default | Enforced at |
|---|---|---|
| `send_messages` | `true` | `sendMessage` for every message without attachments |
| `send_media` | `true` | `sendMessage` when any attachment kind is `image`/`video` |
| `send_files` | `true` | `sendMessage` for `file` (and `music`) attachments |
| `send_voice` | `true` | `sendMessage` for a voice attachment / `type: voice` |
| `send_links` | `true` | `sendMessage` when the text contains a link |
| `add_members` | `false` | `POST /chats/:chatId/members` + `GET /chats/:chatId/add-members/lookup` (regular members, effective override applied); legacy `POST /chats/manage/:groupId/add/:userPhone` |
| `invite_via_link` | `true` | invite-link list/create for regular members |
| `pin_messages` | `false` | `pinMessage` **and** `unpinMessage` |
| `edit_own_messages` | `true` | `editMessage` (own message only) |
| `delete_own_messages` | `true` | `deleteMessage` (own message only) |

Checks run server-side before the operation is accepted; a raw Socket.IO call
cannot bypass them. Unknown/partial stored objects are normalized with these
defaults on read.

### `GET /chats/:chatId/member-permissions`

Any non-banned member (clients need the policy to render their own controls):

```json
{
  "chatId": 42,
  "permissions": {
    "send_messages": true,
    "send_media": true,
    "send_files": true,
    "send_voice": true,
    "send_links": true,
    "add_members": false,
    "invite_via_link": true,
    "pin_messages": false,
    "edit_own_messages": true,
    "delete_own_messages": true
  },
  "canEdit": true
}
```

### `PATCH /chats/:chatId/member-permissions`

Owner, or an admin with `manage_permissions`. Partial body; every present key
must be a boolean. Unknown keys are rejected by the global `ValidationPipe`
(`forbidNonWhitelisted`), then re-validated in the service.

```json
{ "send_links": false, "add_members": true }
```

- Locks the chat row (`FOR UPDATE`), re-checks the caller's role/grants under
the lock, merges field-wise and writes only when something changed.
- Response: the complete updated object plus `changed`; an identical patch is
  `changed: false` and writes/notifies nothing.
- 400: empty/non-object body, unknown key, non-boolean value, private chat.
- 403: not a member, banned, regular member, admin without `manage_permissions`.

```json
{
  "chatId": 42,
  "permissions": { "send_links": false, "add_members": true },
  "canEdit": true,
  "changed": true
}
```

### Realtime

On a committed change, to `chat:<chatId>`:

| Event | Payload |
|---|---|
| `group:member-permissions` | `{ chatId, permissions }` (complete config) |
| `group:changed` | `{ chatId, reason: 'member_permissions_changed' }` |

Offline clients resync from the GET endpoint on their next join/reconnect; the
config query is not persisted in the mobile cache, so a stale policy is never
reused for authorization decisions.

## Individual member overrides

Every regular member can additionally have one optional row of tri-state
overrides. The group policy stays the default; overrides only change that
member:

```
effective(allow)   = true
effective(deny)    = false
effective(inherit) = groupDefault
```

Only `allow`/`deny` keys are stored (`chat_member_permission_overrides`);
`inherit` keys are omitted and the row is deleted when no explicit key
remains, so inheriting never creates records. Owners and admins cannot be
targeted: their power comes from the role/admin-grant hierarchy, which this
feature never bypasses. A regular member can never edit overrides (not even
their own).

### `GET /chats/:chatId/members/:memberId/permission-overrides`

Any non-banned member (the target must be a regular member; 409 otherwise):

```json
{
  "chatId": 42,
  "memberId": 17,
  "userId": 9,
  "role": "member",
  "groupPermissions": { "send_files": true, "add_members": false },
  "overrides": {
    "send_messages": "inherit",
    "send_media": "inherit",
    "send_files": "deny",
    "send_voice": "inherit",
    "send_links": "inherit",
    "add_members": "allow",
    "invite_via_link": "inherit",
    "pin_messages": "inherit",
    "edit_own_messages": "inherit",
    "delete_own_messages": "inherit"
  },
  "effective": { "send_files": false, "add_members": true },
  "canEdit": true
}
```

`overrides` always contains every key (`inherit` when unset); `effective` is
the resolved boolean config enforced by the backend.

### `PATCH /chats/:chatId/members/:memberId/permission-overrides`

Owner, or an admin with `manage_permissions`. Partial body; values are exactly
`"inherit" | "allow" | "deny"`. `inherit` resets that single key.

```json
{ "send_files": "deny", "add_members": "allow" }
```

- Locks the chat row, then the caller and target membership rows, and
  re-checks authorization/role inside the transaction.
- Field-wise merge; only explicit keys are stored. Returns the full response
  above plus `changed`; an identical patch writes/notifies nothing.
- 400: empty/non-object body, unknown key, invalid state, private chat.
- 403: not a member, banned, regular member, admin without `manage_permissions`.
- 409: target is the owner, an admin, or banned.

### `DELETE /chats/:chatId/members/:memberId/permission-overrides`

Same authorization; removes the row and returns the response above with every
override back to `inherit` (and `changed: false` when there was no row).

### Realtime

On a committed change, `chat:<chatId>` **and** the affected `user:<userId>`
room receive:

| Event | Payload |
|---|---|
| `group:member-permission-overrides` | `{ chatId, userId, overrides, effective }` |
| `group:changed` | `{ chatId, reason: 'member_permission_overrides_changed', userId }` |

Offline clients resync from the GET endpoint; enforcement always reads the
current database state, so a stale client cannot act on an old permission.

## Realtime

After commit (never blocking the response):

| Event | Room | Payload |
|---|---|---|
| `group:changed` | `chat:<chatId>` | `{ chatId, reason: 'member_promoted' \| 'member_demoted' \| 'role_changed' \| 'member_removed' \| 'member_banned' \| 'permissions_changed' \| 'member_permissions_changed' \| 'member_permission_overrides_changed' \| 'info_changed' \| 'avatars_changed', userId }` |
| `group:updated` | every member's `user:<userId>` | `{ chatId, title, avatars }` after a committed info/photo change (FULL photo array, current first) |
| `group:removed` | `user:<userId>` | `{ chatId, reason: 'kicked' \| 'banned' }` |
| `chat:members` | `chat:<chatId>` | `{ chatId, membersCount }` after removal or ban |

A committed permission save emits `group:changed` with
`reason: 'permissions_changed'`; a promotion emits `member_promoted` and a
demotion `member_demoted` (both with the target `userId`). They are sent after
commit and never block the HTTP response; the affected admin's app refetches
`GET /chats/:chatId/group` so its capabilities change live.

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
actually work. Capability: `GET /chats/:chatId/group` returns `capabilities.canManageInvites`
(and the kept alias `canManageInviteLinks`), true for the owner and an admin
holding `manage_invites` or `all`. Every manage call re-checks the
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
  "isMember": false,
  "myRole": null,
  "chatId": 3
}
```

`avatar` is the current group photo path or `null`. `chatId` is ALWAYS set (it
used to be `null` for non-members) so the app can open a group it already
belongs to without a second request. `isMember` duplicates `alreadyMember` as
an explicit membership flag; `myRole` is the caller's wire role (`owner`,
`admin`, `member`) or `null` for a non-member. A banned caller still gets 403,
so `myRole: "banned"` is never delivered.

`POST /invites/:code/join` →
`{ "chatId": 3, "title": "Team", "joined": true, "alreadyMember": false, "role": "member" }`.

Rules:

- New members get role `user`; one row only (duplicate membership rows are
  deduped by user). An existing member (any role except `ban`) gets **200**
  `alreadyMember: true`, `joined: false`, their current `role`, inserts
  nothing, changes no role and consumes no use — so the app can treat a join as
  idempotent and go straight to the chat.
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
404/403 behavior and the same idempotent answer `{ chatId, title,
 alreadyMember, role }`), so banned users cannot re-join and duplicate rows are never
created. The legacy manage routes (`POST|GET /chats/manage/:chatId/link`,
`DELETE /chats/manage/:chatId/link/:linkId`) delegate to the new service too
(used by `scripts/private-chat.js`): revoke now verifies the link belongs to the
same chat, and create/list use the clean authorization. Missing checks are no
longer reachable.
