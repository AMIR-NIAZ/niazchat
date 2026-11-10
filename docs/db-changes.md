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
