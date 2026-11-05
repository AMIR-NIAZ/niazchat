# Mobile API Documentation — NiazChat Backend

Backend analysis for the **NiazChat** messaging backend (NestJS + PostgreSQL + Redis + Socket.IO), produced as the first step before building the React Native client.

**Stack detected:** NestJS (`src/main.ts`), TypeORM + PostgreSQL (`src/common/configs/typeorm.config.ts`), Redis/BullMQ for OTP jobs (`src/modules/auth/processor/otp.processor.ts`), Socket.IO WebSockets (`@nestjs/websockets`), JWT access/refresh tokens (`src/modules/auth/services/jwt.service.ts`), local disk file storage (`uploads/`, `storage/`).

## Documents

| File | Content |
|---|---|
| [authentication.md](./authentication.md) | OTP login, JWT tokens, guard behavior |
| [users.md](./users.md) | Profile, avatar, user lookup |
| [chats.md](./chats.md) | Chats, members, management, invite links |
| [groups.md](./groups.md) | Group/roles/permissions model |
| [messages.md](./messages.md) | Sending/editing/deleting/history |
| [attachments.md](./attachments.md) | Chat attachment upload/download lifecycle |
| [websocket.md](./websocket.md) | All Socket.IO gateways, events, rooms |
| [entities.md](./entities.md) | DB entities vs. API response models |
| [enums.md](./enums.md) | All enums and seeded catalog tables |
| [error-handling.md](./error-handling.md) | Error envelope, validation, statuses |
| [feature-matrix.md](./feature-matrix.md) | Supported / partial / unsupported features |

## How the backend is composed

- **Global setup** (`src/main.ts`): global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`), global `HttpExceptionFilter` (`src/common/filters/http-exception.filter.ts`), CORS with `origin: true, credentials: true`, default port `process.env.PORT ?? 3000`.
- **Global REST guards** (`src/modules/app/app.module.ts`, `APP_GUARD`):
  1. `PayloadGuard` (`src/common/guards/restGuards/payload.guard.ts`) — validates `Authorization: Bearer <accessToken>` unless the route is `@IsPublic()`.
  2. `RoleGurd` (`src/common/guards/restGuards/role.guard.ts`) — checks the `@Role([...])` metadata; `owner` passes everything, `RoleEnum.ALL` means "any authenticated user".
- **Static files**: `ServeStaticModule` serves the `uploads/` directory under **`/uploads`** (`src/modules/app/app.module.ts`) — used for user/chat avatars.
- **No API prefix**: controllers register at the root (`/auth`, `/user`, `/chats`, `/react`, `/attachments`, `/health`).

## ⚠️ Critical facts for the mobile client

1. **Messaging, chat list, reads, typing and reactions are WebSocket-only.** There is almost no REST surface for messages (`src/modules/messages/` has no controller at all).
2. **`POST /chats/create` does not return the created chat.** It returns only `{ message: 'group created successfully' }` (`src/modules/chats/services/chat.service.ts#createGroup`). You must refetch the chat list over WS.
3. **Presence (`isOnline`, last-seen) is broken server-side**: `UserGateway.handleConnection` reads `client.data.user`, but nothing populates it (no auth guard on that gateway) — see [websocket.md](./websocket.md) and [feature-matrix.md](./feature-matrix.md).
4. Private chat creation is implicit: send a message with `userId` and the backend creates the private chat (`src/modules/messages/services/message.service.ts#sendPv`).
5. There is **no pagination** on message history (fixed last 50) and **no REST endpoint to list a user's chats** (`ChatService.getAllUser` exists but is unused).

## Unresolved questions

- Is there a production SMS provider for OTP? Currently the OTP "sender" is a 5-second sleep + `console.log` (`src/common/services/message.service.ts`), and in non-production the code is always `00000` (`src/modules/auth/services/otp.service.ts#generateOtp`).
- Will the deployment expose a base URL for `/uploads` avatars distinct from the API host? Mobile must rewrite `uploads/avatars/...` paths into `/uploads/avatars/...` URLs. See [attachments.md](./attachments.md).
- Is the token header name for refresh token refresh (`token` header, not `Authorization`) intentional? It is inconsistent with the rest of the API.

> Backend source was not modified. All findings are backed by file references in each document.
