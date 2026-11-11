# groups feature (app)

Group info panel and group settings for group chats. The panel is reachable by
tapping the avatar/title in the chat header; the gear (owner/admin only) opens
`/group-settings/:chatId`. Private chats never open either screen (the server
answers 400).

## Files

- `group-model.ts` — wire models (including `description` and `capabilities`),
  query keys, `visibleMemberActions`, role badges, cached-page transforms, the
  `GROUP_SETTINGS_FEATURES` list filtered by capabilities, and the pure
  group-info form helpers (validation, dirty detection, changed-field diff).
- `groups-api.ts` — the group REST calls, ids normalized to numbers; includes
  `PATCH /chats/:chatId/group`, the multi-photo set
  (`POST .../group/avatars`, `DELETE .../group/avatars/:fileName`,
  `PUT .../group/avatars/:fileName/main`) and the multipart helper.
- `use-group.ts` — TanStack Query hooks (`['group', chatId]`,
  `['group', chatId, 'members', search]` infinite query,
  `['group', chatId, 'permissions', memberId]`), mutations with an immediate
  cache patch (group info, chat list row, chat-info query and open conversation
  `detail.info`) + authoritative refetch, and socket listeners bound to the
  CURRENT socket instance. `invite_links_changed` / `member_joined` also
  invalidate `['group', chatId, 'invite-links']`; `avatars_changed` refreshes
  the gallery, `chat-info` and the chat list. `groupAvatarItems()` maps stored
  paths to `{ fileName, url }` for the shared gallery/viewer.
- `invite-links-model.ts` — invite wire model, query key, `inviteLinkUrl`
  (expo-linking `createURL`), `parseInviteInput`, expiry/usage allowlists,
  status/relative-time labels and share text.
- `invite-links-api.ts` / `use-invite-links.ts` — invite REST calls and hooks
  (`['group', chatId, 'invite-links']`, staleTime 0, no retry on 403/404),
  create/revoke mutations patch the cache immediately, preview/join hooks.
- `pending-invite.ts` — in-memory code continuation for a link opened while
  logged out (cleared on logout, lost on app kill).
- `open-invite-link.ts` — tap routing shared by chat messages and the
  invite-links screen: a link carrying an invite code opens `/join/<code>` in
  the app (deduped per tap), any other absolute URL is opened by the OS.
- `member-actions-sheet.tsx` — bottom sheet that renders only the permitted
  actions (no disabled rows), in server order: Edit permissions, Remove admin,
  Remove from group.
- `member-permissions-sheet.tsx` — owner-only admin permission editor with
  local toggles, discard confirmation, save spinner and stale handling.
- `../../app/(app)/group/[chatId].tsx` — the group info screen; shows the
  description when present and the gear for the owner/admin.
- `../../app/(app)/group-settings/[chatId]/index.tsx` — settings hub: renders
  only features whose capability is true; empty state otherwise.
- `../../app/(app)/group-settings/[chatId]/info.tsx` — edit title, description
  and the photo gallery (add up to 10, view, set current, delete).
- `../../app/(app)/group-settings/[chatId]/invite-links.tsx` — owner/admin link
  management: status cards, copy/share/revoke, create sheet (expiry and usage
  chips), pull-to-refresh, focus refetch and a relative-time timer.
- `../../app/join/[code].tsx` — public join route: preview, join/open chat,
  invalid/banned/network states, login continuation through the auth guard.
- `../../app/(app)/new-chat.tsx` — "Join a group with a link" row with paste
  and `parseInviteInput` routing to the join screen.

## Rules

- The server is the only authority: the three-dot trigger appears only when at
  least one `actions` flag is true, and `GROUP_SETTINGS_FEATURES` is filtered by
  the server-computed `capabilities` (never derived locally).
- The gear appears only when `myRole` is `owner` or `admin`, read from the
  cached group info (hidden while unknown). It is never rendered in private
  chats or for members. The legacy outlined "Admin" button is unchanged.
- Only the owner sees `canEditPermissions`, and only on an ADMIN row. The
  editor never offers `all`; saving replaces the set and converts a legacy
  `all` grant into the three explicit permissions.
- Group changes (`group:changed`, including `permissions_changed`) invalidate
  the open group's info, member pages and permission query. `info_changed` and
  `avatars_changed` also refresh the chat list/chat info.
- Group photos reuse the user-avatar components: `AvatarGallery` shows the
  thumbnails/current badge/`+` tile (limit hint at 10) and `AvatarViewer` pages
  the originals with `subject="Group photo"`, "Set as group photo" and a
  confirmed delete. Non-editors get the viewer in `readOnly` mode. Every tile
  keeps its file name for mutate calls; `avatars[0]` is always the photo shown
  in the header, chat list and forward picker.
- `group:updated { chatId, title, avatars }` arrives in the caller's personal
  room after an info change: it patches the group info, chat list and open
  conversation immediately, so titles/photos update without a refetch.
- If the caller loses `canEditInfo` while the edit screen is open
  (`permissions_changed` / `role_changed` for them), the group info is refetched
  and the screen leaves with a short notice.
- A 409/404 while saving means the admin was demoted or removed meanwhile: the
  sheet closes and the list is refreshed with a short notice.
- `group:removed` purges the chat from every cache and replaces the screen with
  the chat list plus “You were removed from this group”. Chat, group and
  settings screens listen, deduped per chat.
- The panel/settings never join or leave the chat room, so the chat below keeps
  its scroll position and draft.
- Invite links are server-authorized: the settings row only renders when
  `capabilities.canManageInviteLinks` is true (owner/any admin). If the caller
  loses it while the links screen is open, the screen refetches and leaves with
  a notice. `group:removed` behaves like the other group screens.
- A join link opened while logged out keeps its code in memory only, goes
  through the normal login, and the guest-only guard returns to `/join/<code>`;
  killing the app drops the pending code.
- Deep links use the existing `scheme: "niazchat"` (`app.json`); Expo Router
  maps `niazchat://join/<code>` / `exp://…/--/join/<code>` to `/join/[code]`
  for cold starts and running apps. Automatic clickability inside
  WhatsApp/Telegram needs HTTPS Universal Links / App Links (an owned domain,
  AASA + assetlinks files, `ios.associatedDomains` / `android.intentFilters`);
  none is configured, so those apps keep the link as text and the recipient
  uses the share text's bare code through “Join a group with a link”.
- Message bodies split into text/link segments with `splitLinkifiedText`
  (`invite-links-model.ts`): only the absolute URL becomes an underlined,
  tappable nested `<Text>`; the rest of the message (formatting, newlines,
  emoji, private or group chat) renders exactly as before. Invite URLs cover
  `niazchat://join/<code>`, `exp://…/--/join/<code>` and `/join/<code>` (or
  `/invite/<code>`) paths on http(s); the code is still previewed and joined
  server-side, so a forged URL cannot grant access.
