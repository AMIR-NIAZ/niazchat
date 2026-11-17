# Development demo seed

`npm run seed:demo` fills a **development** database with realistic Persian
demo data: 12 demo users, 6 groups that always include your own account, roles,
permissions, 14 days of conversations, service messages, reactions and
per-chat read state.

It is an explicit script. It is **not** in the boot seeder registry
(`SeederService.SEEDERS`) and is never run by `run-all` or container startup.

## Safety

- Refuses to run when `NODE_ENV=production` (clear error, no writes).
- Refuses without `SEED_ME`.
- Every group is written in its own transaction (all-or-nothing); users are
  written in a separate transaction.
- Idempotent: demo users are looked up by `demo_*` username, groups by their
  exact `[دمو]` title. A second run skips existing data and creates nothing.
- `SEED_RESET=1` deletes only demo-owned rows: users whose username is in the
  fixed `demo_*` list and groups whose title is in the fixed `[دمو]` list, plus
  their messages/members/seen state. Your `SEED_ME` account is never deleted,
  even if it is itself a demo account. It then reseeds immediately.
- DB-only: no sockets/events are emitted. The app gets everything on its next
  fetch.

## Run (dev Docker stack)

```bash
# First time / normal seed
docker compose -f docker-compose.dev.yml exec \
  -e SEED_ME=<your-username-or-phone> app npm run seed:demo

# Wipe the demo data and recreate it (demo rows only)
docker compose -f docker-compose.dev.yml exec \
  -e SEED_ME=<your-username-or-phone> -e SEED_RESET=1 app npm run seed:demo
```

`SEED_ME` accepts an existing `user_profiles.username` (case-insensitive) or an
existing `users.phone` (`+98912…`, `00989…` or `09…` are all accepted). The
usual account in this project is identified by phone because profiles may not
have a username yet, e.g.:

```bash
docker compose -f docker-compose.dev.yml exec \
  -e SEED_ME=+989199299879 app npm run seed:demo
```

When running outside Docker, `HOST_DB` must point at the database
(`.env` defaults to `localhost`; the compose file overrides it to `postgres`).

## Environment variables

| Variable        | Required | Default      | Meaning                                                     |
| --------------- | -------- | ------------ | ----------------------------------------------------------- |
| `SEED_ME`       | yes      | —            | Username or phone of the existing account to add everywhere |
| `SEED_RESET`    | no       | unset        | `1` deletes demo rows before seeding                        |
| `SEED_PASSWORD` | no       | `Demo@12345` | Printed in the summary; see the auth note below             |
| `NODE_ENV`      | no       | —            | `production` is refused                                     |

### Auth / password note

This backend authenticates with **phone OTP only** (`AuthService`,
`otp.service.ts`); `users` has no password column. `SEED_PASSWORD` is therefore
accepted for tooling compatibility and printed in the summary, but there is
nowhere to persist it and it cannot be used to log in. Demo users can sign in
with their seeded phone number (the dev OTP code is `00000`). Do not add a
password column just for demo data.

## What is created

- **Users**: the 12 fixed demo users in
  `src/modules/seeders/seeds/data/persian-messages.ts`, with Persian names,
  `demo_*` usernames and deterministic phones `+989120000001` …
  `+989120000012`. Role `user`, profile name/username, no avatars.
- **Groups**: 6 groups titled `[دمو] …` with Persian descriptions, 5–10 members
  each (always including `SEED_ME`), one `manager`, one or two `admin`s with
  different permissions (`all`, `ban_user`, `change_info_chat`,
  `delete_message`), the rest `user`. The “ورزش و کوهنوردی” group also has a
  `ban` member so the banned-users screen has data.
  `SEED_ME` is `manager` in two groups, `admin` in two and `user` in two.
- **Messages**: 40–120 per group (currently 47–103 regular messages plus 4–5
  service messages), from all active members. About 28 % are from
  `SEED_ME`. Timestamps cover the last 14 days including today, in bursts of
  3–6 messages, with multi-line messages, 300–600 character messages, emoji,
  numbers, English words and links. A few messages are edited and a couple
  reply to earlier messages in the same group.
- **Service messages**: when the `system` message type exists, chronological
  `member_added`, `member_joined_via_link`, `member_left` and `member_banned`
  rows with the full `meta` contract. If the type is missing they are skipped
  and a warning is logged (run `npm run seed:run-all` once to add it).
- **Read state**: a `chat_seen` row for every member. `SEED_ME` is left with a
  deterministic **0–12 unread** messages per group (7, 0, 3, 12, 5, 9), using
  the same `chat_seen.messageId` mechanism as the app; service messages and own
  messages never count.
- **Chat list**: each group’s `updatedAt` equals its newest message timestamp
  and message inserts are chronological, so previews/order are correct on the
  next fetch. Messages are inserted in batches of 200.
- **Reactions**: a few reactions per group when the `reacts` table is not empty.

All text lives in
`src/modules/seeders/seeds/data/persian-messages.ts` (90 short/medium lines,
6 long lines, 8 multi-line lines). Selection uses a seeded PRNG, so reruns on a
fresh database produce identical data.

## Summary output

The script prints a summary like:

```text
============================================================
  Demo seed complete
============================================================
  My account    : <name> (@<username>, <phone>, id=<id>)
  Demo users    : 12 created, 0 already existed
  Demo groups   : 6 created, 0 already existed
  Memberships   : 45 rows added
  Messages      : 484 added (25 service messages)
  Reset removed : 12 users, 6 groups, 484 messages   # only with SEED_RESET=1
  My unread     :
    - [دمو] دوستان دانشگاه: 7
    - [دمو] خانواده: 0
    - [دمو] تیم پروژه niazchat: 3
    - [دمو] کتاب‌خوان‌ها: 12
    - [دمو] سفر شمال: 5
    - [دمو] ورزش و کوهنوردی: 9
  Demo password : Demo@12345
  Login note    : this project authenticates with phone OTP only ...
============================================================
```

## Members / roles for demo changes

Do not add `DemoSeeder` to `SEEDERS`. It takes required options (`SEED_ME`)
that boot seeding does not provide, and demo data must never appear
automatically.
