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
