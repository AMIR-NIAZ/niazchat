# Entities vs API Models

DB entities (TypeORM, `src/**/entities/*.entity.ts`) vs what the API actually returns. All ids are `bigint → number` in JSON (BaseEntity, `src/common/entities/base.entity.ts`: `id`, `createdAt`, `updatedAt` on every table).

## Important rule

Most list endpoints return **raw entity rows** (chats, links, reactions), while user-centric reads return the **merged `toUserResponse` projection** (auth/users/messages). Never assume an entity is returned directly — check the per-endpoint docs.

## users

```ts
{ id: UserId, phone: string (unique), isOnline: boolean (default false),
  lastSeen: Date|null, status: UserStatusEnum ENUM('active','deleted','baned') default 'active',
  refreshToken: string|null, roleId?: number  // role relation
}
```
Not in API output: `refreshToken` (never selected). API projection = `toUserResponse` (see users.md).

## user_profiles

```ts
{ id: ProfileId, name: string|null, username: string|null (unique, 30, nullable), 
  biografy: string|null, avatars: string[] (text[]), userId: UserId (UNIQUE) }
```
Never returned alone — always merged through `toUserResponse`.

## roles / permissions

```ts
Role:    { id, name: string }         // owner|admin|user (seeded)
Permission: { id, name: string }      // ban_user|ban_chat|manage_react (seeded)
UserPermission: { userId, permissionId } // join table
```

## chats

```ts
{ id: ChatId, title: string|null, avatars: string[] (text[]),
  type: TypeChatEnum ('private'|'groupe'|'channel'), isBan: boolean default false,
  lastMessageId?: number  // 1:1 relation, mostly unloaded
}
```
API output: raw rows in `getAllChats` (relations unloaded); `chatInfo` = `getInfoChat` raw row; `joinByInviteCode` returns the full entity with relations loaded.

## chat_members

```ts
{ id, chatId, userId, roleId }
```

## chat_seen

```ts
{ id, userId, chatId, messageId: MessageId /* nullable, ON DELETE SET NULL */ }
```
Not directly exposed; only influences `seen` WS event (`lastSeenId`).

## link (invite links)

```ts
{ id, code: string (unique, len 20 — ⚠ generated as 32 hex chars), usageLimit: int (0=unlimited? see below), 
  usageCount: int, expiresAt: Date|null, isActive: boolean default true, chatId }
FULL ROW RETURNED by POST/GET endpoints.
```

## messages

```ts
{ id: MessageId, content: string /* nullable, text */, senderId (eager load → Sender),
  chatId, replyToId?, typeId, isEdited: false, isDeleted: false }
```
API output: got with `sender` = `toUserResponse` object, `type` = `{id, name, …}`, `attachments` = the array. `typeId` etc. are raw FK numbers not resolved to names. (messages.md)

## type_messages

```ts
{ id, name: string }  // seeded: file, ice, image, text, video, voice
```
Returned inline on messages; never listed by any endpoint.

## attachments

```ts
{ id: AttachmentId, originalName: string (≤255 sanitized display name),
  storageKey: string (unique, uuid.ext — never exposed except as filename in download),
  mimeType: string (≤100), size: bigint, uploaderId, chatId, messageId?: number,
  status: 'pending'|'attached' }
```
API output: upload response = narrow `{id, originalName, mimeType, size, chatId, createdAt}`; messages include `id, originalName, mimeType, size, createdAt`; `GET /attachments/:id/download` = binary stream, **not** JSON.

## reacts / message_react

```ts
React:        { id, name: string (unique), emoji: string (unique) }
MessageReact: { id, userId, messageId, reactId, react: React (eager) }
```
`GET /react` returns `React[]` (raw rows; the active reaction-type allowlist). `reactMessage` acks and broadcasts an aggregated snapshot `{ chatId, messageId, reactions: [{ reactId, emoji, count }], myReaction, actor }`, never the raw `MessageReact` rows or reactor ids. `getMessageReactions` returns grouped users (`userId`, `name`, `username`, `avatars`) capped at 100. Message payloads carry count-only `reactions`; history also carries the caller's `myReaction`.

## Relations map

```
User 1—1 UserProfile
User *—1 Role
User *—1 ChatMember, ChatSeen, MessageReact, MessageReact.user
Chat *—* User (via ChatMember + RoleChat)
Chat 1—* Message, ChatSeen, InviteLink, Attachment
Message *—1 User (sender), *—1 Chat, self-ref replyTo, *—1 TypeMessage
Message 1—* Attachment (bound via status='attached'), MessageReact
ChatMember *—1 RoleChat
User *—* Permission (UserPermission)
ChatMember *—* PermissionChat (PermissionAdmin)
```
