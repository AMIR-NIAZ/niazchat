# users feature

Profile, multi-avatar gallery & user lookup (docs/mobile-api/users.md).

## Endpoints
- `GET /auth/getme` — own profile (bare `toUserResponse`, no `data` wrapper).
- `GET /user/pv/:userName` — lookup by username (`{ data: UserResponse }`).
- `PUT /user/updateme` — name/username/biografy all required by validation.
- `POST /user/avatars` — multipart field `avatar`, images only (jpeg/png/webp, ≤ 5 MB), max 10 photos. Prepends the new photo as `avatars[0]`. Returns `{ message, user }`. Legacy `PUT /user/uploade-avatar` still works and behaves the same.
- `DELETE /user/avatars/:fileName` — `:fileName` is the stored file NAME (basename, e.g. `<uuid>.png`), not the array index; returns `{ message, user }`.
- `PUT /user/avatars/:fileName/main` — promotes that photo to `avatars[0]`; returns `{ message, user }`.
- Legacy `DELETE /user/delete-avatar` — body `{ avatar: "<exact stored path>" }`; kept for old clients.

## Notes
- `avatars[0]` is the current photo everywhere; a user keeps up to 10. All writes happen server-side in a single SQL update under a row lock.
- `avatars` are server-relative paths that already include the `uploads/` mount (`uploads/avatars/…`) → resolve via `absoluteUploadUrl()`, which strips that segment before joining `uploadsBaseUrl` (never `/uploads/uploads/...`). Keep the basename next to each URL (`ProfileAvatar.fileName`) for mutate actions.
- Mutations MERGE their response into `['me']` (never replace it: `id` and fields the response omits survive) and invalidate `['me']`, `['chats']` and `['chat-info']`. `['messages']` is intentionally NOT invalidated. Already-open chats pick up a new avatar on their next fetch (no avatar socket event exists).
- The current user id for "is this mine?" (bubble direction, Edit/Delete, pending bubbles, unread bumps) comes from the access token's `sub` via `useCurrentUserId()`, never from `['me']`, so a profile refetch can never misclassify messages. `['me']` is only a profile display cache and is always normalized by `me-cache.ts`.
- Never set `Content-Type` on the avatar FormData request: React Native writes `multipart/form-data; boundary=…` itself; a manual header drops the boundary and the backend answers `400 Multipart: Boundary not found`.
- The local picker URI is only used for the upload; the profile always displays the path the backend stored.
- `expo-image-manipulator` is NOT installed: oversized picks show a size error instead of being resized client-side.
- `isOnline`/`lastSeen` are broken server-side; do not build presence UI on them.
