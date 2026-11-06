# NiazChat Mobile

React Native + Expo + TypeScript client for the NiazChat backend (NestJS). **Phase 1: infrastructure only** — no login, chat, or messaging screens yet.

## Stack

- [Expo](https://docs.expo.dev/) + **Expo Router** (routes live in `src/app/`)
- TypeScript (`strict`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- [TanStack Query](https://tanstack.com/query) — server state
- [Zustand](https://zustand.docs.pmnd.rs) — session/auth state
- Axios — REST, centralized client with interceptors
- socket.io-client — WS (chat list and messaging are WebSocket-only)
- react-hook-form + zod, expo-secure-store, brand tokens in `src/shared/theme`

## Getting started

```bash
cd mobile
npm install
cp .env.example .env          # point EXPO_PUBLIC_API_URL at the running backend
npx expo start                # then press: i / a / w, or scan QR with Expo Go
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run start` | Expo dev server |
| `npm run typecheck` | `tsc --noEmit` |
| `npx expo-doctor` | Diagnose dependency/config issues |
| `npx expo install --fix` | Align package versions with the installed Expo SDK |

## Architecture

```
src/
  app/          Expo Router entry & screens (route files only)
  core/
    api/        Axios client, ApiError envelope, DTOs (wire types)
    socket/     Socket.IO client + typed events + connection manager
    storage/    Secure token storage (expo-secure-store)
    config/     Environment variables (EXPO_PUBLIC_*)
  features/
    auth/       OTP session lifecycle, token provider, refresh
    users/      Profile & lookups        (scope-only README)
    chats/      Chat list/info via WS    (scope-only README)
    groups/     Chat management REST     (scope-only README)
    messages/   WS-only messaging        (scope-only README)
    attachments Upload/download flows    (scope-only README)
  shared/
    components/ Reusable presentational components
    hooks/      Generic hooks
    theme/      Design tokens (palette / spacing / radii / typography)
```

## Backend contracts baked into this skeleton

Sourced from `../docs/mobile-api/`:

- REST error envelope `{ success: false, statusCode, message }` → normalized into `ApiError`; only `statusCode` is reliable for branching.
- 401 → single refresh round-trip via `POST /auth/refresh-token` on the non-standard raw `token` header, then the request is retried once; if refresh fails the session is cleared.
- Socket.IO authenticates per-event through the handshake `authorization: Bearer <token>` header (`extraHeaders`).
- The backend never acks message sends; use `emitWithAck` helpers so failures surface.
- Avatars are server-relative paths (`uploads/avatars/…`) → `absoluteUploadUrl()`.

## Phase-1 limitations (backend, pending server work)

- Presence (`isOnline`/`lastSeen`) is broken server-side.
- Reactions are broken; reacts are not seeded.
- No message pagination (fixed last 50), no chat member list, no leave/remove member, no group rename.
- `POST /chats/create` returns no chat id; invite-link creation likely fails (32 vs 20 char code).

See `../docs/mobile-api/feature-matrix.md` for the full matrix.
