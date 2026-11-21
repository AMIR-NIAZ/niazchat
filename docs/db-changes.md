# Database changes (video + voice attachments)

There is no migration infrastructure in this project. Development relies on
TypeORM `synchronize` (`SYNCHRONIZE=true`), so a backend restart applies the
entity changes automatically. **Never run these statements against the dev
database yourself**; this file is the hand-maintained production SQL.

All columns are nullable and additive, so the statements are safe to re-run
(`ADD COLUMN IF NOT EXISTS`). Existing rows keep `NULL`, which means "not a
video / not a voice message" for the flags.

```sql
ALTER TABLE "attachments"
    ADD COLUMN IF NOT EXISTS "width" integer,
    ADD COLUMN IF NOT EXISTS "height" integer,
    ADD COLUMN IF NOT EXISTS "duration" numeric(10, 1),
    ADD COLUMN IF NOT EXISTS "posterPath" character varying(255),
    ADD COLUMN IF NOT EXISTS "voice" boolean,
    ADD COLUMN IF NOT EXISTS "waveform" smallint[];
```

| Column            | Added by      | Meaning                                                       |
| ----------------- | ------------- | ------------------------------------------------------------- |
| `width`, `height` | video         | Display dimensions (rotation applied), images too.            |
| `duration`        | video + voice | Seconds, one decimal (`numeric(10,1)`).                       |
| `posterPath`      | video         | Server-relative WebP poster path; never sent on the wire.     |
| `voice`           | voice         | `true` only for rows uploaded with `voice=1`; `NULL` = false. |
| `waveform`        | voice         | 64 RMS bars, integers `0..100`; `NULL` = flat bars.           |

`kind: "voice"` is derived in the serializer from `voice = true` (no enum
change). No indexes are required: the cleanup job filters on `status` /
`createdAt` / `isDeleted`, already covered by the existing schema.

After deploying the SQL (or restarting dev with `synchronize`), the backend
must also be running an image that contains `ffmpeg`/`ffprobe` — otherwise
video and voice uploads answer `503`.

## Message forwarding

Forward origin is an entity-only, nullable addition on the real `messages`
table. Dev gets both columns from TypeORM `synchronize` on the next backend
restart; production applies the idempotent SQL below.

```sql
ALTER TABLE "messages"
    ADD COLUMN IF NOT EXISTS "forwardedFromUserId" bigint,
    ADD COLUMN IF NOT EXISTS "forwardedFromName" character varying(100);
```

| Column                | Meaning                                                               |
| --------------------- | --------------------------------------------------------------------- |
| `forwardedFromUserId` | Original sender's user id snapshot; `NULL` when the user was deleted. |
| `forwardedFromName`   | Original sender's display-name snapshot taken at first forward.       |

Both `NULL` means an ordinary (non-forwarded) message. Forwarding a forwarded
message copies both values unchanged, so the first origin is never replaced.

## Message pinning

Entity-only, additive columns on the real `messages` table. A chat may pin any
number of messages; the pinned row IS the original message (no copy, no
duplicate record), so attachments and replies stay intact. Dev gets both
columns from TypeORM `synchronize` on the next backend restart; production
applies the idempotent SQL below.

```sql
ALTER TABLE "messages"
    ADD COLUMN IF NOT EXISTS "isPinned" boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "pinnedAt" timestamp;
```

| Column     | Meaning                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| `isPinned` | Currently pinned. Cleared together with the soft delete.                |
| `pinnedAt` | Pin time; orders the pinned list (newest first). `NULL` when unpinned.  |

No new table or index is required: `getPinnedMessages` filters by
`chatId = ? AND isPinned = true AND isDeleted = false`, and the chat's message
id index already bounds that scan. The `pin_message` capability is a row in
the existing `permission_chats` catalog (seeded by `PermissionChatSeeder`), not
a schema change.

## Private (one-to-one) chats

Entity-only, nullable, additive column for the canonical pair key. Dev gets it
(and its unique index) from TypeORM `synchronize` on the next backend restart;
production applies the idempotent SQL below. Postgres allows any number of
`NULL`s in a unique index, so every group row stays valid.

```sql
ALTER TABLE "chats"
    ADD COLUMN IF NOT EXISTS "pairKey" character varying(40);

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_chats_pairKey"
    ON "chats" ("pairKey")
    WHERE "pairKey" IS NOT NULL;
```

`pairKey` is `"<smallerUserId>:<largerUserId>"` for private chats and `NULL`
for groups. `type = 'private'` already exists in the `chats_type_enum` created
by the entity enum, so no `ALTER TYPE` is required.

Optional backfill for private chats created before this change (ready to run,
NOT executed; measured count was unavailable because the dev stack was down):

```sql
UPDATE "chats" c
SET "pairKey" = p."pairKey"
FROM (
    SELECT m."chatId" AS "chatId",
           LEAST(MIN(m."userId"), MAX(m."userId"))::text || ':' ||
           GREATEST(MIN(m."userId"), MAX(m."userId"))::text AS "pairKey"
    FROM "chat_members" m
    JOIN "chats" ch ON ch.id = m."chatId" AND ch.type = 'private'
    GROUP BY m."chatId"
    HAVING COUNT(DISTINCT m."userId") = 2
) p
WHERE c.id = p."chatId" AND c."pairKey" IS NULL;
```

## Default reaction types

No schema change: the `reacts` table already has `name` and `emoji`, both
unique. Production only needs the six defaults; the backend seeder
(`src/modules/seeders/seeds/react.seeder.ts`) inserts missing rows on every
startup, and this is the equivalent idempotent SQL:

```sql
INSERT INTO "reacts" ("name", "emoji")
VALUES
    ('thumbs_up', '👍'),
    ('heart', '❤️'),
    ('joy', '😂'),
    ('open_mouth', '😮'),
    ('cry', '😢'),
    ('pray', '🙏')
ON CONFLICT DO NOTHING;
```

The table is the allowlist: `reactMessage` only accepts emoji strings present
in it, and admins manage additional types through `/react`.

One reaction per user per message is additionally enforced by the entity
definition; dev gets it from `synchronize`. Production applies:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_message_react_user_message"
    ON "message_react" ("messageId", "userId");
```

`LOWER(username)` prefix search is served by the existing unique index only for
exact/case-sensitive lookups; if it becomes hot, create (do NOT run here):

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_user_profiles_username_lower"
    ON "user_profiles" (LOWER("username") varchar_pattern_ops);
```

## Group owner role (backfill) and duplicate members

No schema change: the panel uses the seeded `role_chat` names (`manager` =
owner, `admin`, `user`, `ban`). New groups already give their creator
`manager` (`ChatService.createGroup`). Groups created before that rule have no
`manager`, so `GET /chats/:chatId/group` reports `owner: null` and nobody sees
owner actions until this idempotent SQL is applied.

For every group chat that has **no** `manager`, promote its earliest-created
`admin` member row (tie: lowest `chat_members.id`). Groups with no admin are
left alone. It is safe to re-run: a group that gained a `manager` is skipped.

```sql
WITH first_admin AS (
    SELECT DISTINCT ON (m."chatId")
           m.id AS "memberId",
           m."chatId" AS "chatId"
      FROM "chat_members" m
      JOIN "role_chat" r ON r.id = m."roleId"
      JOIN "chats" c ON c.id = m."chatId" AND c.type = 'groupe'
     WHERE r.name = 'admin'
       AND NOT EXISTS (
           SELECT 1
             FROM "chat_members" mm
             JOIN "role_chat" rr ON rr.id = mm."roleId"
            WHERE mm."chatId" = m."chatId"
              AND rr.name = 'manager'
       )
     ORDER BY m."chatId", m."createdAt" ASC, m.id ASC
)
UPDATE "chat_members" cm
   SET "roleId" = (SELECT id FROM "role_chat" WHERE name = 'manager')
  FROM first_admin fa
 WHERE cm.id = fa."memberId";
```

Inspect before running (read-only):

```sql
SELECT c.id AS "chatId", c.title
  FROM "chats" c
 WHERE c.type = 'groupe'
   AND NOT EXISTS (
       SELECT 1
         FROM "chat_members" m
         JOIN "role_chat" r ON r.id = m."roleId"
        WHERE m."chatId" = c.id AND r.name = 'manager'
   );
```

### Duplicate `(chatId, userId)` rows

`chat_members` has no unique constraint today, so a user can appear twice in
one chat (observed: chat 1, user 3). The panel deduplicates by user (highest
role, then lowest id), counts `DISTINCT userId`, and removal deletes every row
of the removed user. This cleanup is ready to run but **NOT executed**.

Preview duplicates:

```sql
SELECT m."chatId", m."userId", COUNT(*) AS rows,
       array_agg(m.id ORDER BY m.id) AS "memberIds"
  FROM "chat_members" m
 GROUP BY m."chatId", m."userId"
HAVING COUNT(*) > 1
 ORDER BY 1, 2;
```

Repoint every `permission_admin` grant to the row that will be kept (highest
role, then lowest id):

```sql
WITH ranked AS (
    SELECT m.id AS "memberId",
           m."chatId",
           m."userId",
           FIRST_VALUE(m.id) OVER (
               PARTITION BY m."chatId", m."userId"
               ORDER BY CASE r.name
                            WHEN 'manager' THEN 3
                            WHEN 'admin' THEN 2
                            WHEN 'user' THEN 1
                            ELSE 0
                        END DESC,
                        m.id ASC
           ) AS "keepId",
           ROW_NUMBER() OVER (
               PARTITION BY m."chatId", m."userId"
               ORDER BY CASE r.name
                            WHEN 'manager' THEN 3
                            WHEN 'admin' THEN 2
                            WHEN 'user' THEN 1
                            ELSE 0
                        END DESC,
                        m.id ASC
           ) AS rn
      FROM "chat_members" m
      JOIN "role_chat" r ON r.id = m."roleId"
)
UPDATE "permission_admin" pa
   SET "memberId" = ranked."keepId"
  FROM ranked
 WHERE pa."memberId" = ranked."memberId"
   AND ranked.rn > 1;
```

Then delete the duplicate rows (permissions already repointed; any remaining
grant on a doomed row would be a race and is deleted by the FK cascade when
present):

```sql
WITH ranked AS (
    SELECT m.id AS "memberId",
           ROW_NUMBER() OVER (
               PARTITION BY m."chatId", m."userId"
               ORDER BY CASE r.name
                            WHEN 'manager' THEN 3
                            WHEN 'admin' THEN 2
                            WHEN 'user' THEN 1
                            ELSE 0
                        END DESC,
                        m.id ASC
           ) AS rn
      FROM "chat_members" m
      JOIN "role_chat" r ON r.id = m."roleId"
)
DELETE FROM "chat_members" cm
 USING ranked
 WHERE cm.id = ranked."memberId"
   AND ranked.rn > 1;
```

### Admin permission editor

No schema change: the editor reuses the existing `permission_admin` /
`permission_chats` rows. It deletes/reinserts grants inside one transaction;
duplicate membership rows need no cleanup for it to work (grants are read as a
union and written to the canonical row). No SQL is required for this feature.

Optional hardening (describe only, do NOT apply before the cleanup succeeds):

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "UQ_chat_members_chat_user"
    ON "chat_members" ("chatId", "userId");
```

`CONCURRENTLY` cannot run inside a transaction. The application keeps working
without the index (queries deduplicate), so it is purely a data-integrity
guard against future duplicates.

## Saved contacts

New table, entity-only. Dev gets it from TypeORM `synchronize` on the next
backend restart (do not run SQL against dev); production applies the
idempotent statements below. `phone` is nullable and set only when the contact
was saved by phone number, which is what lets `GET /contacts` echo that number
back to its owner.

```sql
CREATE TABLE IF NOT EXISTS "contact" (
    "id" bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    "ownerId" bigint NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "contactUserId" bigint NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "alias" varchar(60) NULL,
    "phone" varchar(32) NULL,
    "createdAt" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_contact_owner_contact_user"
    ON "contact" ("ownerId", "contactUserId");

CREATE INDEX IF NOT EXISTS "IDX_contact_owner"
    ON "contact" ("ownerId");
```

`(ownerId, contactUserId)` is unique, so saving the same person twice answers
`409` instead of creating a duplicate row. Both foreign keys cascade, so a
deleted account removes its saved-contact rows (as owner and as target).
`users.phone` already exists, is unique and E.164; no change is required for
matching.

## Group description (edit group info)

Entity-only, nullable, additive column on `chats`. Dev gets it from TypeORM
`synchronize` on the next backend restart (do not run SQL against dev);
production applies the idempotent statement below.

```sql
ALTER TABLE "chats"
    ADD COLUMN IF NOT EXISTS "description" varchar(255) NULL;
```

`description` is trimmed, at most 255 characters, and `NULL` means "no
description". Existing rows keep `NULL`, so no backfill is required. Group
photos need no schema change: they already live in the `avatars` text array
(first element = current photo).

## Invite links

Entity-only and additive. Dev gets these columns from TypeORM `synchronize` on
the next backend restart (do not run SQL against dev); production applies the
idempotent statements below.

```sql
ALTER TABLE "link"
    ADD COLUMN IF NOT EXISTS "createdByUserId" bigint NULL,
    ADD COLUMN IF NOT EXISTS "maxUses" integer NULL,
    ADD COLUMN IF NOT EXISTS "usesCount" integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "revokedAt" timestamptz NULL,
    ALTER COLUMN "expiresAt" TYPE timestamptz
        USING "expiresAt" AT TIME ZONE 'UTC',
    ALTER COLUMN "code" TYPE varchar(32);

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_link_code"
    ON "link" ("code");
```

- `code` is widened for the new 22-character base64url code. Old 32-hex/20-char
  codes are preserved but rejected by the new preview/join endpoints.
- `maxUses` NULL = unlimited. `usesCount` counts admitted new members. The
  legacy `usageLimit`/`usageCount` columns stay for old readers; the service
  mirrors `maxUses` into `usageLimit` and increments both counters.
- `expiresAt` NULL = never. The `USING` clause assumes the old naive timestamps
  were UTC; existing rows are not rewritten beyond the type conversion.
- Revoking sets `revokedAt` and keeps the legacy `isActive` flag `false`.
  `createdByUserId` NULL means a legacy link with an unknown creator.
- The unique index cannot fail on existing rows because `code` is already
  unique; no backfill is needed (the dev table has no rows).

## Music attachments (`type: "music"`)

Additive and nullable, so the statements are safe to re-run. Dev gets the four
columns and the new catalog row from TypeORM `synchronize` + the startup seeder
on the next backend restart; production applies the SQL below. (Never run these
against the dev database yourself — this file is the hand-maintained production
SQL.)

```sql
ALTER TABLE "attachments"
    ADD COLUMN IF NOT EXISTS "title" character varying(255),
    ADD COLUMN IF NOT EXISTS "artist" character varying(255),
    ADD COLUMN IF NOT EXISTS "durationSeconds" numeric(10, 1),
    ADD COLUMN IF NOT EXISTS "coverPath" character varying(255);
```

| Column            | Meaning                                                                  |
| ----------------- | ------------------------------------------------------------------------ |
| `title`           | Embedded tag title, or the file name without extension (never `NULL`).   |
| `artist`          | Embedded tag artist; `NULL` means "Unknown artist" in the app.           |
| `durationSeconds` | Container duration in seconds, one decimal; `NULL` when unparsable.      |
| `coverPath`       | Server-relative WebP cover path (≤256 px); never sent on the wire.       |

`kind: "music"` is derived in the serializer from the audio MIME type plus
`voice IS NOT TRUE` (no enum change). `coverUrl` is derived from `coverPath` as
`/attachments/<id>/cover`. The message-type catalog needs one new row; the
`TypeMessageSeeder` inserts it on every startup, and this is the equivalent
idempotent SQL:

```sql
INSERT INTO "type_messages" ("name", "createdAt", "updatedAt")
VALUES ('music', now(), now())
ON CONFLICT DO NOTHING;
```

No index is required: music tracks are found through their message id, exactly
like images/videos/voice. `music-metadata` is a pure-JS dependency, so no
system package is needed for music uploads (ffmpeg is still required for video
and voice only).

## Group service (`system`) messages

Membership changes are stored as real `system` messages. Dev gets both changes
from TypeORM `synchronize` on the next backend restart; production applies the
idempotent SQL below. The new column is nullable and additive, so existing rows
keep `NULL` (an ordinary, user-authored message).

```sql
ALTER TABLE "messages"
    ADD COLUMN IF NOT EXISTS "meta" jsonb;

INSERT INTO "type_messages" ("name", "createdAt", "updatedAt")
VALUES ('system', now(), now())
ON CONFLICT DO NOTHING;
```

| Column | Added by | Meaning                                                           |
| ------ | -------- | ----------------------------------------------------------------- |
| `meta` | system   | `NULL` for user messages; the service contract below for `system`. |

```json
{
    "action": "member_joined_via_link",
    "actorId": 12,
    "actorName": "Sara",
    "targetId": 12,
    "targetName": "Sara"
}
```

`action` is one of `member_joined`, `member_joined_via_link`, `member_added`,
`member_left`, `member_banned`, `member_removed`. Names are snapshots at the
time of the action. `messages.content` carries an English fallback sentence.
No index is required: these rows are read through the normal `messages`
pagination and `MAX(id)` last-message subquery. `TypeMessageSeeder` inserts the
`system` catalog row on every startup; the SQL above is the production
equivalent.

## User blocks and one-sided chat deletion

Entity-only, additive. Dev gets both changes from TypeORM `synchronize` on the
next backend restart (do not run this SQL against dev); production applies the
idempotent statements below.

```sql
CREATE TABLE IF NOT EXISTS "user_blocks" (
    "id" bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    "blockerId" bigint NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "blockedId" bigint NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_user_blocks_blocker_blocked"
    ON "user_blocks" ("blockerId", "blockedId");

CREATE INDEX IF NOT EXISTS "IDX_user_blocks_blocked"
    ON "user_blocks" ("blockedId");

ALTER TABLE "chat_members"
    ADD COLUMN IF NOT EXISTS "clearedBeforeId" bigint NULL;
```

| Change                             | Meaning                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `user_blocks`                      | One directional row per blocker → blocked pair; blocking is NOT symmetric.                  |
| `UQ_user_blocks_blocker_blocked`   | Makes repeated/concurrent block requests idempotent (second insert fails `23505`, treated as success). |
| `chat_members.clearedBeforeId`     | Per-member "delete chat for me" boundary: messages with `id <=` it are hidden from this member only. `NULL` = no deletion. |

No backfill is required: existing members have `clearedBeforeId = NULL` (no
deletion) and no user has blocked anybody yet. Deleting a chat for both needs
no schema change — `messages`, `attachments`, `chat_members` and `chat_seen`
already cascade from `chats`.

### Visibility guards (blocked users / banned groups)

No new SQL. The visibility feature reuses the table and indexes above
(`UQ_user_blocks_blocker_blocked` for the directional lookup,
`IDX_user_blocks_blocked` for "who blocked this viewer") and the existing
`chat_members` → `role_chat(name = 'ban')` marker for group bans. No backfill
is required.

> **Avatar files are public.** They are served by `ServeStaticModule` from
> `uploads/avatars` at `/uploads/**` (and thumbnails at
> `/media/avatars/:size/:fileName`) without authentication. Hiding URLs in
> DTOs prevents discovery through the API, but an already-known direct URL
> stays reachable. Making them private would mean replacing the static mount
> with an authenticated controller; that is not part of this change.

See `docs/mobile-api/visibility.md` for the endpoint/DTO/event matrix.

## Group admin permissions (12 keys)

Entity-only except `chat_members.promotedById`. Dev gets the column from TypeORM
`synchronize` on the next backend restart (do not run this SQL against dev); the
backend also normalizes legacy permission names on read and (best effort, at
startup) rewrites stored grants. Production applies the idempotent statements
below.

```sql
-- Who promoted an admin (owner/legacy rows stay NULL).
ALTER TABLE "chat_members"
    ADD COLUMN IF NOT EXISTS "promotedById" bigint NULL
    REFERENCES "users"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "IDX_chat_members_promotedById"
    ON "chat_members" ("promotedById");

-- Every contract permission name plus the `all` wildcard.
INSERT INTO "permission_chats" (name)
VALUES
    ('all'),
    ('edit_group_info'),
    ('manage_members'),
    ('remove_members'),
    ('ban_users'),
    ('manage_invites'),
    ('pin_messages'),
    ('delete_other_messages'),
    ('manage_messages'),
    ('restrict_members'),
    ('manage_voice_chats'),
    ('manage_admins'),
    ('manage_permissions')
ON CONFLICT (name) DO NOTHING;

-- Legacy → current. Copy the grant first (idempotent), then delete the old one.
INSERT INTO "permission_admin" ("memberId", "permissionId")
SELECT pa."memberId", current.id
  FROM "permission_admin" pa
  JOIN "permission_chats" legacy ON legacy.id = pa."permissionId"
  JOIN "permission_chats" current ON current.name = 'edit_group_info'
 WHERE legacy.name = 'change_info_chat'
   AND NOT EXISTS (
       SELECT 1 FROM "permission_admin" dup
        WHERE dup."memberId" = pa."memberId"
          AND dup."permissionId" = current.id
   );

INSERT INTO "permission_admin" ("memberId", "permissionId")
SELECT pa."memberId", current.id
  FROM "permission_admin" pa
  JOIN "permission_chats" legacy ON legacy.id = pa."permissionId"
  JOIN "permission_chats" current ON current.name = 'ban_users'
 WHERE legacy.name = 'ban_user'
   AND NOT EXISTS (
       SELECT 1 FROM "permission_admin" dup
        WHERE dup."memberId" = pa."memberId"
          AND dup."permissionId" = current.id
   );

INSERT INTO "permission_admin" ("memberId", "permissionId")
SELECT pa."memberId", current.id
  FROM "permission_admin" pa
  JOIN "permission_chats" legacy ON legacy.id = pa."permissionId"
  JOIN "permission_chats" current ON current.name = 'delete_other_messages'
 WHERE legacy.name = 'delete_message'
   AND NOT EXISTS (
       SELECT 1 FROM "permission_admin" dup
        WHERE dup."memberId" = pa."memberId"
          AND dup."permissionId" = current.id
   );

INSERT INTO "permission_admin" ("memberId", "permissionId")
SELECT pa."memberId", current.id
  FROM "permission_admin" pa
  JOIN "permission_chats" legacy ON legacy.id = pa."permissionId"
  JOIN "permission_chats" current ON current.name = 'pin_messages'
 WHERE legacy.name = 'pin_message'
   AND NOT EXISTS (
       SELECT 1 FROM "permission_admin" dup
        WHERE dup."memberId" = pa."memberId"
          AND dup."permissionId" = current.id
   );

DELETE FROM "permission_admin" pa
 USING "permission_chats" p
 WHERE pa."permissionId" = p.id
   AND p.name IN ('change_info_chat', 'ban_user', 'delete_message', 'pin_message');
```

| Change | Meaning |
| ------ | ------- |
| `chat_members.promotedById` | User who promoted this admin. `NULL` for the owner, plain members and legacy admins. `manage_admins`/`manage_permissions` holders may only act on their own promotees; the owner may act on anyone. |
| 12 `permission_chats` rows | One row per contract key; `all` stays the wildcard ("Full admin"). |
| Legacy grant rewrite | `change_info_chat → edit_group_info`, `ban_user → ban_users`, `delete_message → delete_other_messages`, `pin_message → pin_messages`, `all` unchanged. |

Notes:

- Storage shape is unchanged: grants are `permission_admin` rows pointing at
  `permission_chats.name`; the editor deletes/reinserts inside one transaction.
- `manage_messages` is an umbrella: it implies `delete_other_messages` and
  `pin_messages` (resolved by `hasPermission`, nothing is duplicated in storage).
- `restrict_members` and `manage_voice_chats` are storable/editable but marked
  inactive: no feature enforces them yet.
- The owner implicitly holds every permission and can never be restricted.

## Group member permission policy

A group can now configure what REGULAR MEMBERS may do. The policy is one JSONB
column on `chats`; owners always pass and admins keep their existing
`permission_admin` grants, so no new join table is needed. Existing groups get
the centralized defaults from the column default (no NULL state).

```sql
ALTER TABLE "chats"
    ADD COLUMN IF NOT EXISTS "memberPermissions" jsonb NOT NULL
    DEFAULT '{"send_messages":true,"send_media":true,"send_files":true,"send_voice":true,"send_links":true,"add_members":false,"invite_via_link":true,"pin_messages":false,"edit_own_messages":true,"delete_own_messages":true}'::jsonb;

-- Safety for a table that already had a nullable column from an earlier run.
UPDATE "chats"
   SET "memberPermissions" = '{"send_messages":true,"send_media":true,"send_files":true,"send_voice":true,"send_links":true,"add_members":false,"invite_via_link":true,"pin_messages":false,"edit_own_messages":true,"delete_own_messages":true}'::jsonb
 WHERE "memberPermissions" IS NULL;
```

| Change | Meaning |
| ------ | ------- |
| `chats."memberPermissions"` | Complete `Record<permission, boolean>` for the ten member keys. Reads normalize a partial/legacy object with the same defaults, so a missing key behaves like the default. |
| Default policy | `send_*: true`, `add_members: false`, `invite_via_link: true`, `pin_messages: false`, `edit_own_messages: true`, `delete_own_messages: true`. |

Notes:

- The column is written only by `PATCH /chats/:chatId/member-permissions`
  (owner or admin with `manage_permissions`) under a `FOR UPDATE` chat lock.
- No index is required: the column is read with the chat row and never
  filtered on in SQL.
- A newly created group uses the same entity default; the create path does not
  need a separate INSERT value.

## Individual member permission overrides

A regular member can have ONE optional row of tri-state overrides. The group
policy remains the default; only explicit `allow`/`deny` keys are stored (an
all-`inherit` result deletes the row, so inheriting creates no records).

```sql
CREATE TABLE IF NOT EXISTS "chat_member_permission_overrides" (
    "id"        bigserial PRIMARY KEY,
    "chatId"    bigint NOT NULL REFERENCES "chats"(id) ON DELETE CASCADE,
    "userId"    bigint NOT NULL REFERENCES "users"(id) ON DELETE CASCADE,
    "overrides" jsonb  NOT NULL DEFAULT '{}'::jsonb,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now(),
    CONSTRAINT "UQ_chat_member_permission_overrides_chat_user"
        UNIQUE ("chatId", "userId")
);

CREATE INDEX IF NOT EXISTS "IDX_chat_member_permission_overrides_user"
    ON "chat_member_permission_overrides" ("userId");
```

| Change | Meaning |
| ------ | ------- |
| `chat_member_permission_overrides` | One row per `(chat, user)`; the unique constraint makes concurrent inserts safe. Cascade deletes follow the chat/user. |
| `overrides` | Sparse JSONB map of explicit `"allow"`/`"deny"` values only, e.g. `{"send_files":"deny"}`. Missing key = `inherit`. Reads still normalize malformed/legacy objects. |
| `IDX_..._user` | Optional lookup aid for a user's overrides across groups; the unique index already serves `(chatId, userId)` lookups. |

Notes:

- Owners and admins never get override rows; the service rejects them as
  targets (409) and keeps their role/admin-grant hierarchy untouched.
- Writes lock the chat row first, then the caller and target membership rows,
  merge field-wise and re-check the caller's `manage_permissions` grant, so
  concurrent edits serialize and a demotion cannot leave a stale capability.
- The effective value (`override ?? groupDefault`) is resolved by
  `MemberPermissionResolverService` and stored in every caller context; no
  enforcement site reads the client's view.

## Shared content (chat profile tabs)

The profile's "Media / Voice / Music / Links / Files" tabs read two additive
structures: a new `message_links` table (URLs extracted at write time) and an
index on `attachments`. Both are safe to re-run.

```sql
CREATE TABLE IF NOT EXISTS "message_links" (
    "id"        bigserial PRIMARY KEY,
    "messageId" bigint NOT NULL REFERENCES "messages"(id) ON DELETE CASCADE,
    "chatId"    bigint NOT NULL REFERENCES "chats"(id)    ON DELETE CASCADE,
    "url"       character varying(2048) NOT NULL,
    "domain"    character varying(255)  NOT NULL,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now(),
    CONSTRAINT "UQ_message_links_message_url" UNIQUE ("messageId", "url")
);

CREATE INDEX IF NOT EXISTS "IDX_message_links_chat_created_id"
    ON "message_links" ("chatId", "createdAt", "id");

CREATE INDEX IF NOT EXISTS "IDX_attachments_chat_message"
    ON "attachments" ("chatId", "messageId");
```

| Change | Meaning |
| ------ | ------- |
| `message_links` | One row per distinct URL of a message. `createdAt` mirrors the MESSAGE time (not the insert time), so backfilled links group under their real month. |
| `(messageId, url)` unique | Re-extraction and the backfill are idempotent; a concurrent retry cannot duplicate a link. |
| `IDX_message_links_chat_created_id` | The Links tab's stable newest-first pagination cursor is `(createdAt, id)`. |
| `IDX_attachments_chat_message` | Media/Voice/Music/Files pages and counts filter one chat's attachments by message; avoids a full attachments scan. |

Notes:

- `message_links` rows are written in the SAME transaction as their message
  (create and forward), replaced on edit, and deleted when the message is
  soft-deleted.
- Old messages need one backfill (idempotent): `npm run backfill:links` (add
  `-- --chat <id>` for one chat, `--dry-run` to only report).
- No index is needed on `messages` for these tabs: the attachment join uses
  `attachments."messageId"` and the cursor filters on the joined message.
