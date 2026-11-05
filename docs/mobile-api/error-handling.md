# Error Handling

Source: `src/common/filters/http-exception.filter.ts` (global), `src/main.ts` (global ValidationPipe).

## REST error envelope

Every HTTP error response (any exception class, including uncaught 500s) is normalized by the global `HttpExceptionFilter`:

```json
{
  "success": false,
  "statusCode": 400,
  "message": "..."   // string, or string[] for ValidationPipe errors
}
```

Behavior details:

- `HttpException` → its status + `message` from its body (`string` or `.message` of an object).
- `QueryFailedError` (raw DB errors) → **400** with the driver message (so FK violations from bad ids in service code surface as 400, not 500).
- Any other `Error` → status stays **500**, message = `error.message` (raw internal errors are leaked in the body!).
- **403 is rewritten** to `{ message: 'user not access' }` (guards' original messages are lost).
- ValidationPipe errors keep Nest's format inside `message`: `["chatId must be a number", "username must be shorter than or equal to 32 characters", ...]` — always an **array** of strings when validation fails.

## REST status codes actually raised

| Code | Common causes |
|---|---|
| 400 | request body validation (`forbidNonWhitelisted: true` → extra fields are rejected with `property <x> should not exist`), `sendChat`/`sendPv` misuse, invite-link errors |
| 401 | missing/invalid Bearer token (`PayloadGuard`), banned phone on `send-otp` |
| 403 | platform role checks (`RoleGurd`), chat-admin permission shortfall (`ManagerChatGuard`), attachment access → rewritten to `user not access` |
| 404 | entities not found (`user not found`, `attachment not found`, `role not found`, ...) |
| 409 | username already exists (`UserService.updateUser`) |
| 429 | OTP already requested (`code sent`) |
| 500 | unexpected service errors, raw TypeORM `QueryFailedError` mishandled by some paths |

## WebSocket errors

The WS gateways throw `WsException` (or plain `BadRequestException`) from guards and services. Nest's default WS exception filter returns the ACK-style error callback payload:

```json
{ "message": "You are not a member of this chat", "status": 400 }
```

- On validation failures from the WS `ValidationPipe`, `message` is an array of strings (same as REST).
- Emitted to the **error callback of that specific emit**, unless the client doesn't pass an ack callback — then the failure is swallowed for them (no broadcast occurs).

## Message strings to be aware of

Because some strings are non-standard Persian/typo'd, hardcoding them is fragile; match on `statusCode` instead. Notables: `'user logined successfull'`, `'user added succeccfull'`, `'token in valid, …'`, `'user baned is …'`, `'file exceeds the maximum allowed size of …'`.

## Mobile recommendation

- Treat only `statusCode` as stable; `message` is informational.
- Centralize an interceptor that maps 401 → refresh → retry → logout, 403 → permission UI, 400/validation → form errors (`message` array), 429 → toast, 5xx → generic retry UI.
- For WS: always pass an ack callback (even a no-op `() => {}`) and handle the error callback, otherwise the send failure will be reported as an emit that eventually "never succeeded" with no cause.
