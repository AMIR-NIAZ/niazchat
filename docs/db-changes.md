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
