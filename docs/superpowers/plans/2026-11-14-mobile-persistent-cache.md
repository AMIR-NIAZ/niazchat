# Persistent Cache (offline-first) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On app start, account info, chat list and the last messages of previously opened chats render instantly from local storage, then refresh from the server (stale-while-revalidate).

**Architecture:** TanStack Query persistence to AsyncStorage (allowlisted query families, per-user storage key) for account/lists; a dedicated expo-sqlite mirror for messages (write path = debounced batched mirror of the messages query cache; read path = local seed before the first server fetch, then reconcile-merge). Per-user isolation: query-cache storage key and SQLite file both include the user id; logout removes both.

**Tech Stack:** `@tanstack/react-query-persist-client` + `@tanstack/query-async-storage-persister` (JS-only, Expo Go safe), `@react-native-async-storage/async-storage`, `expo-sqlite` (async API), TanStack Query v5.

**Spec:** the feature brief in the conversation (Parts 1–4, done criteria). Scope: caching only, no UI redesign.

**All paths below are relative to `mobile/`** (the app lives in `/home/amirniaz/projects/niazchat/mobile`; the repo root is the NestJS backend).

## Global Constraints

- App runs in Expo Go: only `@react-native-async-storage/async-storage` and `expo-sqlite`; NO `react-native-mmkv`, no custom native modules. Install with `npx expo install`.
- Query cache persistence allowlist (persist ONLY `status === 'success'` queries with these key families): `['me']`, `['chats']` (the exact chat list entry only — NOT `['chats','members'|'bans'|'my-role', …]`), `['chat-info', chatId]`, `['group', chatId]` and `['group', chatId, 'members', …]` (group info + members), `['user', userId]` (public profiles), `['contacts','saved']`. NEVER persist: messages (`['messages', chatId]`), banned users (`['group', chatId, 'banned']`), invite links/invite preview, member permissions, contact matches, reaction catalog, mutations, errored/pending queries.
- Persist options: `buster` constant `PERSIST_BUSTER = 'niazchat-query-cache-v1'` (bump to invalidate), `maxAge = 7 * 24 * 60 * 60 * 1000`, `throttleTime >= 1000`, storage key `niazchat-query-cache:<userId>`. Default query `gcTime` must be ≥ `maxAge` (set `gcTime: 7 * 24 * 60 * 60 * 1000` in `query-client.ts`).
- `refetchOnMount: 'always'` in query defaults so restored data refreshes once on mount.
- No full-screen loader flash on cold start when cached data exists; the existing bootstrap gate may wait up to 1.5 s extra for the persisted restore, then falls back to normal rendering.
- Messages SQLite: table `messages(chatId INTEGER, id INTEGER, createdAtIso TEXT, json TEXT NOT NULL, PRIMARY KEY(chatId, id))` + index on `(chatId, id DESC)`; optional `chat_sync(chatId INTEGER PRIMARY KEY, newestId INTEGER, oldestId INTEGER, updatedAt TEXT)`. Schema versioned via a version table (or `PRAGMA user_version`); migrations start at v1. DB file name includes the user id.
- Only confirmed messages stored: `id !== null && status === 'sent' && !isDeleted`. Never pending/failed/deleted.
- Keep at most the latest 200 messages per chat (prune after writes) and at most 100 chats' worth (prune least recently opened; update `chat_sync.updatedAt` on every write).
- Mirror writes: debounced ~500 ms, one transaction, `INSERT OR REPLACE`; deleted messages remove their row. Never block the UI thread, never write per-render.
- Seed on chat open: latest ≤ 50 rows from SQLite (ascending, normalized ids) into the query cache before the first server fetch resolves; then the server page merges via a reconcile-merge (server wins, adds missing, removes locally cached ids inside the server page range) and `mergeMessages` (dedupe, pending/failed last, numeric ids).
- Older-pages pagination: try SQLite first; when local rows run out, fetch from the server.
- No crash on corruption: restore or SQLite read throwing → delete that cache and continue from the network.
- Strings only inside `<Text>`; no `{number && <X/>}`; stable unique keys; no leftover debug logs in production code.
- Run `npx tsc --noEmit` and `npx expo lint` at the end of every task that touches code (working dir `mobile/`).

## Review Focus

- **Per-user isolation:** user B must never see user A's data — pinned by the key-derivation test in Task 4 (persister key includes the id; logout clears it) and the SQLite filename test in Task 5.
- **Pending/failed never stored:** a cache write containing `status:'pending'`/`'failed'` or `id === null` rows must not insert them — pinned by the mirror filter in Task 6.
- **No reordering/duplication when the server resolves after the local seed** — pinned by the reconcile + `mergeMessages` path in Task 7 (ascending confirmed, pending last).
- **Prune limits:** >200 confirmed messages per chat and >100 chats must shrink to the limits after a mirror flush — pinned in Task 6.
- **Corruption fallback:** a throwing AsyncStorage read or SQLite read must be swallowed (cache deleted, network continues) — pinned by the defensive try/catch in Tasks 2, 5, 7.

---

### Task 1: Install dependencies

**Files:** none (package.json + lockfile only).

- [ ] **Step 1:** In `mobile/`, run:
  ```bash
  npx expo install @react-native-async-storage/async-storage expo-sqlite
  npm install @tanstack/react-query-persist-client @tanstack/query-async-storage-persister
  ```
  (The persister packages are pure JS; `expo install` is not required for them, but versions must match `@tanstack/react-query@5.105.1` — verify the installed persister packages are v5, i.e. `@tanstack/query-async-storage-persister@^5` / `@tanstack/react-query-persist-client@^5`.)
- [ ] **Step 2:** `npx expo-doctor` passes (or reports nothing new); `npx tsc --noEmit` passes.
- [ ] **Step 3:** Commit: `chore(mobile): add async-storage, expo-sqlite and query persister deps`

### Task 2: Query persister module (allowlist + per-user key)

**Files:**
- Create: `mobile/src/core/query/query-persister.ts`

**Interfaces:**
- Consumes: `@tanstack/query-async-storage-persister` (`createAsyncStoragePersister`), `@tanstack/react-query-persist-client` (`Persister` type), `@react-native-async-storage/async-storage`.
- Produces:
  - `PERSIST_BUSTER: string`, `PERSIST_MAX_AGE_MS: number` (7 days), `QUERY_CACHE_KEY_PREFIX = 'niazchat-query-cache:'`
  - `setCurrentCacheUserId(userId: number | null): void`
  - `getCurrentCacheUserId(): number | null`
  - `removePersistedCacheForCurrentUser(): Promise<void>` (deletes only the current user's AsyncStorage key; resolves silently on error)
  - `persistedQueryClientPersister: Persister` — a `createAsyncStoragePersister` whose storage client routes to AsyncStorage under `${QUERY_CACHE_KEY_PREFIX}${currentUserId}` and whose `getItem`/`setItem`/`removeItem` no-op (resolve/reject cleanly) when the current user id is `null`.

Implementation decisions (the contract above leaves these open — they are fixed here):
- Serialize with the default `JSON.stringify` (cached shapes are plain DTOs/arrays).
- `throttleTime: 1000`.
- `dehydrateOptions.shouldDehydrateQuery(query)`: `query.state.status === 'success'` (not `isError`, not pending) AND `isPersistableQueryKey(query.queryKey)`; also add `shouldRedactErrors: false` is NOT needed — leave defaults. Do NOT include `dehydrateMutations`.
- Key allowlist predicate `isPersistableQueryKey(key: readonly unknown[]): boolean` — exact families from Global Constraints. Export it for the unit review; the family table:
  - `key[0] === 'me'` (exact length 1)
  - `key[0] === 'chats'` with `key.length === 1`
  - `key[0] === 'chat-info'` with `key.length === 2`
  - `key[0] === 'group'` with `key.length === 2` (info) or (`key.length === 4 && key[2] === 'members'`)
  - `key[0] === 'user'` with `key.length === 2`
  - `key[0] === 'contacts' && key[1] === 'saved'`
  - everything else → false (messages, bans, my-role, permissions, invite-links, invite-preview, contacts matches, reactions)
- Per-user isolation inside one storage client: `setItem(key, value)` → `AsyncStorage.setItem(`${PREFIX}${id}`, value)`; `getItem` → `AsyncStorage.getItem(`${PREFIX}${id}`)`; `removeItem` → `AsyncStorage.removeItem(`${PREFIX}${id}`)`. If `id === null`: `getItem` returns `null`, `setItem`/`removeItem` resolve without touching storage (nothing may be persisted without an identity).
- Every storage call is wrapped: on `getItem` failure (corrupt/unavailable), log nothing, delete that AsyncStorage key best-effort and return `null`; on `setItem` failure, swallow.

- [ ] **Step 1:** Implement the module exactly per the contract above.
- [ ] **Step 2:** `npx tsc --noEmit` passes.
- [ ] **Step 3:** Self-check: read back the module and confirm messages/bans/mutations cannot pass the allowlist (e.g. `['messages', 3]`, `['group', 3, 'banned']`, `['chats','members',3,'']` → false; `['me']`, `['chats']`, `['chat-info',3]`, `['group',3]`, `['group',3,'members','']`, `['user',7]`, `['contacts','saved']` → true).
- [ ] **Step 4:** Commit: `feat(mobile): per-user async-storage query persister with allowlist`

### Task 3: Wire the persister into the root layout + query defaults

**Files:**
- Modify: `mobile/src/core/query/query-client.ts`
- Modify: `mobile/src/app/_layout.tsx`

**Interfaces:**
- Consumes: Task 2 module; `PersistQueryClientProvider`, `persistQueryClientSubscribe` (not needed — the Provider subscribes itself).
- Produces: a root provider tree where authenticated users restore persisted queries on mount.

Implementation decisions:
- `query-client.ts`: add to `defaultOptions.queries`: `gcTime: 7 * 24 * 60 * 60 * 1000` (≥ maxAge) and `refetchOnMount: 'always'`. Keep everything else unchanged.
- `_layout.tsx`: replace the inner `QueryClientProvider` with `PersistQueryClientProvider` (same `client`), `persistOptions={{ persister, buster: PERSIST_BUSTER, maxAge: PERSIST_MAX_AGE_MS, throttleTime: 1000 }}`. `onSuccess`: leave mutations alone (the app does not queue offline mutations — documented decision), only resolve the restore gate.
- Restore gate: add state `persistRestored` in `RootLayout`; while `false`, keep rendering `BootstrapPlaceholder` inside the provider tree, but set a 1.5 s timeout at provider mount that flips it to `true` regardless (fallback). `PersistQueryClientProvider onSuccess` flips it to `true` immediately. The `unreachable` branch keeps the plain `QueryClientProvider` (nothing to restore for a broken session).
- When the auth store is not authenticated (status `guest`), pass `persistOptions.enabled: false` so a guest never touches storage.

- [ ] **Step 1:** Update `query-client.ts` defaults.
- [ ] **Step 2:** Rewire `_layout.tsx` per the decisions above.
- [ ] **Step 3:** `npx tsc --noEmit` and `npx expo lint` pass.
- [ ] **Step 4:** Manual reasoning check: with cached data, the chat list tab renders from `initialData`/persisted cache (no `isPending` loader) while `refetchOnMount: 'always'` refreshes in the background.
- [ ] **Step 5:** Commit: `feat(mobile): restore persisted query cache at startup behind a 1.5s gate`

### Task 4: Per-user lifecycle (identity set + logout clearing)

**Files:**
- Modify: `mobile/src/features/auth/auth-store.ts`
- Modify: `mobile/src/features/auth/logout.ts`

**Interfaces:**
- Consumes: Task 2 (`setCurrentCacheUserId`, `getCurrentCacheUserId`, `removePersistedCacheForCurrentUser`), Task 8 (`clearAllLocalData`) — Task 4 is written first with a **forward-declared placeholder**: import from `src/shared/local-db` only after Task 8 exists? NO — to keep tasks independent, Task 4 introduces `src/shared/local-db/index.ts` exporting `clearUserLocalData(userId: number): Promise<void>` as a temporary no-op (the SQLite implementation lands in Tasks 5–8). Task 8 fills it in.
- Produces: `auth-store.restoreSession`/`storeSession` set the cache identity; `logout` clears persister key + `clearUserLocalData` + existing `appQueryClient.clear()`.

Implementation decisions:
- In `auth-store.ts`, wherever the session becomes authenticated with `userId` (both `restoreSession` success branch and `storeSession`), call `setCurrentCacheUserId(userId)` right before/with `set({ status: 'authenticated', userId, … })`. On every guest/`unreachable`/`restoring` reset, call `setCurrentCacheUserId(null)`.
- In `logout.ts` `performLogout`, after `await clearTokens()` and before `appQueryClient.clear()`: read `const userId = getCurrentCacheUserId()`; `setCurrentCacheUserId(null)`; `await removePersistedCacheForCurrentUser()`; `if (userId !== null) await clearUserLocalData(userId)`.
- Guest login flow: a new `storeSession` sets the new id; the persisted key of the previous user was already removed at logout. (If the refresh token fails permanently and logout runs, the same path clears everything — no separate handling needed.)

- [ ] **Step 1:** Create `src/shared/local-db/index.ts` with the temporary no-op `clearUserLocalData(userId: number): Promise<void>` (JSDoc: implementation lands with the SQLite module).
- [ ] **Step 2:** Wire `auth-store.ts` and `logout.ts` per the decisions above.
- [ ] **Step 3:** `npx tsc --noEmit` passes; read back and confirm: user id is set before any provider renders (restoreSession completes before `providersReady`), and logout sequence is `removePersistedCacheForCurrentUser` → `clearUserLocalData` → `appQueryClient.clear()` → `resetSessionState`.
- [ ] **Step 4:** Commit: `feat(mobile): per-user query-cache identity and logout cleanup`

### Task 5: SQLite wrapper + schema + migrations

**Files:**
- Create: `mobile/src/shared/local-db/local-db.ts`
- Modify: `mobile/src/shared/local-db/index.ts` (export the module)

**Interfaces:**
- Consumes: `expo-sqlite` async API (`openDatabaseAsync` from `expo-sqlite` for SDK 52+; if the installed SDK 58 API differs — `openDatabaseSync` vs `openDatabaseAsync` — read the expo-sqlite doc page for the installed version and use the documented async-first API).
- Produces (used by Tasks 6–8):
  - `openUserDb(userId: number): Promise<SQLiteDB>` — opens (and caches in a module map) `niazchat-<userId>.db`, runs migrations, returns the database handle.
  - `getOpenUserDb(userId: number): SQLiteDB | null` (null when never opened)
  - `closeAndDeleteUserDb(userId: number): Promise<void>` (logout: close if open, delete the file, drop the cache entry)
  - `SCHEMA_VERSION = 1`
- Schema v1 (exact):
  ```sql
  CREATE TABLE IF NOT EXISTS messages (
      chatId INTEGER NOT NULL,
      id INTEGER NOT NULL,
      createdAtIso TEXT NOT NULL,
      json TEXT NOT NULL,
      PRIMARY KEY (chatId, id)
  );
  CREATE INDEX IF NOT EXISTS idx_messages_chat_desc ON messages (chatId, id DESC);
  CREATE TABLE IF NOT EXISTS chat_sync (
      chatId INTEGER PRIMARY KEY,
      newestId INTEGER,
      oldestId INTEGER,
      updatedAt TEXT NOT NULL
  );
  ```
- Migration mechanism: after opening, read the version (a `db_version(key TEXT PRIMARY KEY, value INTEGER)` table — the spec asks for "a schema version table", use that, not `PRAGMA user_version`); when lower than `SCHEMA_VERSION`, run the migration list in order inside one transaction, then set the version. A fresh file starts at 0 → v1 runs.
- Defensive: any open/read error during this task's helpers must throw a typed `LocalDbError` (callers decide to fall back).

- [ ] **Step 1:** Implement `local-db.ts` per the contract.
- [ ] **Step 2:** Export from `src/shared/local-db/index.ts`.
- [ ] **Step 3:** `npx tsc --noEmit` passes.
- [ ] **Step 4:** Commit: `feat(mobile): per-user expo-sqlite wrapper with versioned schema`

### Task 6: Message mirror (write path)

**Files:**
- Create: `mobile/src/shared/local-db/messages-mirror.ts`
- Modify: `mobile/src/shared/local-db/index.ts` (exports)
- Modify: `mobile/src/app/_layout.tsx` (start the mirror once the providers are ready and the user is authenticated)

**Interfaces:**
- Consumes: `openUserDb` (Task 5), `getCurrentCacheUserId` (Task 2), `messagesQueryKey` from `features/messages/use-chat-messages`, `appQueryClient` — mirror subscribes to the `QueryCache`.
- Produces:
  - `startMessagesMirror(): void` (idempotent) — subscribes to `queryClient.getQueryCache()`; any cache event whose key starts with `['messages', chatId]` schedules a debounced (500 ms) flush; `stopMessagesMirror(): void`.
  - `clearUserLocalData(userId: number): Promise<void>` (real implementation now, replacing the Task 4 no-op): `stopMessagesMirror`-safe — opens nothing; closes + deletes the user's SQLite file.

Implementation decisions:
- Flush algorithm per chat (all inside ONE transaction on the user's db):
  1. Read the cached `ConversationDetail` for `['messages', chatId]`; if absent, skip (never an error).
  2. `current = detail.messages.filter(m => m.id !== null && m.status === 'sent' && !m.isDeleted)` (confirmed only — pending/failed/deleted are never stored).
  3. `INSERT OR REPLACE` each as `(chatId, id, createdAtIso, JSON.stringify(chatMessage))`.
  4. Deletes: maintain an in-memory `lastWrittenIds: Map<number, Set<number>>`. On the first flush of a chat after cold start, seed it from `SELECT id FROM messages WHERE chatId = ?`. Delete rows for `lastWritten − current` (covers `deleteMessage:list` mirrors).
  5. Prune per chat: keep the latest 200 by id — `DELETE FROM messages WHERE chatId = ? AND id NOT IN (SELECT id FROM messages WHERE chatId = ? ORDER BY id DESC LIMIT 200)`.
  6. Upsert `chat_sync` row (`newestId` = max id, `oldestId` = min id, `updatedAt` = new ISO stamp).
- Global prune after the flush (same or follow-up transaction): keep at most 100 chats — `DELETE FROM messages WHERE chatId IN (SELECT chatId FROM chat_sync ORDER BY updatedAt ASC LIMIT ?) - 100` where `?` = `max(0, count - 100)`; delete the corresponding `chat_sync` rows.
- Writes never block the UI: the flush is `await`-free from the caller's perspective (fire-and-forget with an internal `flushing` flag so overlapping flushes collapse into the next debounce tick); a failed flush is swallowed and retried on the next cache event.
- The mirror must no-op (schedule nothing, flush nothing) while `getCurrentCacheUserId() === null` or the db cannot open.
- `_layout.tsx`: call `startMessagesMirror()` in the same bootstrap effect that calls `startSessionLifecycle()`; the mirror internally re-checks identity per flush (covers logout/login without re-subscription).

- [ ] **Step 1:** Implement `messages-mirror.ts`.
- [ ] **Step 2:** Replace the Task 4 no-op `clearUserLocalData` with the real one (close + delete + drop from the open-db map; on error swallow — logout must always finish).
- [ ] **Step 3:** Call `startMessagesMirror()` from `_layout.tsx`.
- [ ] **Step 4:** `npx tsc --noEmit`, `npx expo lint` pass.
- [ ] **Step 5:** Commit: `feat(mobile): debounced SQLite mirror of confirmed messages with prune limits`

### Task 7: Read path — local seed, reconcile-merge, local-first pagination

**Files:**
- Create: `mobile/src/shared/local-db/messages-reader.ts`
- Modify: `mobile/src/features/messages/use-chat-messages.ts`
- Modify: `mobile/src/shared/local-db/index.ts` (exports)

**Interfaces:**
- Consumes: `openUserDb`, `getCurrentCacheUserId`, `ChatMessage`, `mergeMessages` (from `messages-mapper.ts`), `messagesQueryKey`, `ConversationDetail` (from `use-chat-messages.ts` — define the reader AFTER adding the shared types, or move `ConversationDetail`-agnostic parsing into the reader to avoid an import cycle: the reader may import types from `messages-model.ts` only, and `use-chat-messages.ts` maps rows → `ChatMessage`).
- Produces (used only by `use-chat-messages.ts`):
  - `loadLatestLocalMessages(userId: number, chatId: number, limit = 50): Promise<ChatMessage[]>` — `SELECT json FROM messages WHERE chatId = ? ORDER BY id DESC LIMIT ?` reversed to ascending; rows parsed with a defensive `JSON.parse` (a corrupt row is skipped, not fatal); guaranteed `id` number and `status === 'sent'`.
  - `loadOlderLocalMessages(userId: number, chatId: number, beforeId: number, limit = MESSAGES_PAGE_SIZE): Promise<ChatMessage[]>` — `id < beforeId ORDER BY id DESC LIMIT ?`, ascending output.

Implementation decisions in `use-chat-messages.ts`:
- `ConversationDetail` gains one optional field: `nextCursorSource?: 'local' | 'server'` (undefined ⇒ treat as `'server'`).
- Seed: a `useEffect` on `[chatId, enabled, currentUserId]` runs once per chat open: if the query has no data yet (`getQueryState(...)?.status !== 'success'` — i.e. it is still pending or has no data), load `loadLatestLocalMessages(userId, chatId, 50)` and `setQueryData(messagesQueryKey(chatId), { info: null, messages: local, hasMore: true, nextCursor: oldestLocalId ?? null, nextCursorSource: 'local', myLastSeenId: null, othersLastSeenId: null })` when the local list is non-empty. If the query already succeeded before the read completes, skip (server won the race; the mirror keeps SQLite fresh). Guard against identity/user changes: no user id → no seed.
- Server merge: the initial `queryFn` (and `rejoin`/`mergeLatestPage` paths that produce a fresh full page) run their result through a new exported helper `reconcileMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[]` implemented in `messages-mapper.ts`: remove from `current` every confirmed message whose id lies strictly inside `[min(incoming ids), max(incoming ids)]` but is not present in `incoming` (deleted elsewhere), then `mergeMessages(current, incoming, currentUserId)` (existing behavior: dedupe, pending last). The initial `queryFn` composes: `const cached = queryClient.getQueryData<ConversationDetail>(messagesQueryKey(chatId))`; result messages = `reconcileMessages(cached?.messages ?? [], serverMessages, me)`; pagination state (`hasMore`, `nextCursor`, `info`, seen ids) comes from the server result, and `nextCursorSource: 'server'`.
- Local-first pagination inside `loadOlderPage`: when the current `nextCursorSource === 'local'` (and a user db exists), fetch `loadOlderLocalMessages(chatId, beforeId, MESSAGES_PAGE_SIZE)`:
  - non-empty → merge via `mergeMessages` into the cache, `nextCursor` = new oldest id, `nextCursorSource` stays `'local'` when the page was full (`length === MESSAGES_PAGE_SIZE`), else `'server'` (locals exhausted — the next page must come from the network at the same `beforeId` boundary).
  - empty → immediately fall through to the network path (same `beforeId`, set `nextCursorSource: 'server'`).
  - The db read failure also falls through to the network path.
  - The network path is unchanged except it sets `nextCursorSource: 'server'` on success.
- No UI changes: the existing inverted FlatList and scroll behavior are untouched; seeding only fills the cache earlier so the first render shows messages instead of a loader.

- [ ] **Step 1:** Implement `messages-reader.ts` (row → `ChatMessage` parsing with `JSON.parse` + shape guard + `status === 'sent'`).
- [ ] **Step 2:** Add `reconcileMessages` to `messages-mapper.ts` with the exact contract above.
- [ ] **Step 3:** Modify `use-chat-messages.ts`: `nextCursorSource` field, seed effect, queryFn reconcile-merge, local-first `loadOlderPage`.
- [ ] **Step 4:** `npx tsc --noEmit`, `npx expo lint` pass.
- [ ] **Step 5:** Reason-through check (documented in the commit message body): with seed present, opening a chat renders ≤50 ascending local messages immediately; the server page merges without duplicates or reordering; pending bubbles stay last; deleting a cached message inside the server's page range removes it after refetch.
- [ ] **Step 6:** Commit: `feat(mobile): seed chat from SQLite and merge server pages over it`

### Task 8: Housekeeping — `clearAllLocalData` + corruption fallback review

**Files:**
- Modify: `mobile/src/shared/local-db/index.ts`
- Modify: `mobile/src/features/auth/logout.ts` (only if needed)

**Interfaces:**
- Produces: `clearAllLocalData(userId: number): Promise<void>` — removes the persisted query-cache key AND deletes the user's SQLite file (media/image cache deliberately NOT cleared); logout switches to it (it supersedes calling `removePersistedCacheForCurrentUser` + `clearUserLocalData` separately, but may keep both — one call site, one semantic).

Implementation decisions:
- `index.ts` composes `removePersistedCacheForCurrentUser()`-equivalent for an explicit id: to avoid an identity race after the id is cleared, implement `removePersistedCacheForUserId(userId: number): Promise<void>` in `query-persister.ts` (removes `${PREFIX}${userId}` directly) and make `removePersistedCacheForCurrentUser()` delegate to it with the current id. `clearAllLocalData(userId)` = `removePersistedCacheForUserId(userId)` + `clearUserLocalData(userId)`, both swallowed on error.
- `logout.ts`: single call — `await clearAllLocalData(userId)` (after capturing the id, before `appQueryClient.clear()`).
- Corruption fallback final pass: confirm every restore/SQLite entry point (persister storage client, reader, mirror, `openUserDb`) catches its own storage errors and falls back to network/skip rather than throwing into React. Remove any temporary debug logs.
- Export everything from `src/shared/local-db/index.ts` for the future Settings tab.

- [ ] **Step 1:** Add `removePersistedCacheForUserId` + `clearAllLocalData`, update `logout.ts`.
- [ ] **Step 2:** Sweep for debug logs and uncaught storage errors.
- [ ] **Step 3:** `npx tsc --noEmit`, `npx expo lint` pass.
- [ ] **Step 4:** Commit: `feat(mobile): clearAllLocalData for logout and future settings`

### Task 9: Final verification + media/avatars confirmation + report

**Files:** none (verification only).

- [ ] **Step 1:** Confirm every avatar path goes through `UserAvatar` (expo-image, `cachePolicy="memory-disk"`, `recyclingKey` = file name) — check `message-bubble.tsx`, `chat-row-content.tsx`, `profile.tsx` render via `UserAvatar`/`Avatar`; fix any direct `expo-image` usage missing a stable `cacheKey`/`recyclingKey` (avoids duplicate disk caches and stale swaps).
- [ ] **Step 2:** Full `npx tsc --noEmit` + `npx expo lint` on `mobile/`.
- [ ] **Step 3:** Write the manual-test report (see Done criteria) as the final message to the user: cold start offline (airplane mode), cold start online (no flicker/reorder, socket message survives restart), logout/switch-user isolation, confirmed-only storage + prune limits, persisted key allowlist, SQLite schema/version, prune limits, seed/merge flow, changed/added files, and any query family intentionally NOT persisted (bans, member permissions, invite links, contact matches, reaction catalog, `['chats','my-role']`) with reasons.

---

## Self-review notes (done)

- Spec coverage: Part 1 → Tasks 1–4; Part 2 → Tasks 5–7; Part 3 → Task 9 Step 1; Part 4 → Task 8. Done criteria → Task 9 Step 3.
- `PersistQueryClientProvider onSuccess` resumes paused mutations only if the app queues them — it does not; documented in Task 3.
- Banned users: the spec's "banned users (no)" is read as **not persisted** (admin-only, ephemeral); if the user meant persist them, flip `['group', chatId, 'banned']` in the Task 2 allowlist table.
- `chat_sync` is populated by the mirror (used for LRU prune); `oldestId`/`newestId` are informational.
- Messages reader avoids importing `use-chat-messages.ts` to prevent a feature↔shared cycle; `ChatMessage` lives in `messages-model.ts`.
