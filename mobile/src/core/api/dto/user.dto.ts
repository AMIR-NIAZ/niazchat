/**
 * Backend-configured user shapes (docs/mobile-api/users.md, entities.md).
 * These are wire DTOs, not domain models.
 */

export type UserStatus = 'active' | 'deleted' | 'baned';

/**
 * Merged `toUserResponse` projection returned by
 * `getme`, `user/pv/:userName`, message senders, banned-member lists, etc.
 * `avatars` are server-relative paths ("uploads/avatars/…") — resolve with `absoluteUploadUrl`.
 */
export interface UserDto {
  id: number;
  createdAt: string;
  updatedAt: string;
  phone: string;
  /** Defaults to 'بدون نام' when the profile has no name. */
  name: string;
  biografy: string | null;
  username: string | null;
  avatars: string[];
  isOnline: boolean;
  lastSeen: string | null;
  status: UserStatus;
  /** Only present when the backend loaded the role relation (e.g. `getme`). */
  role?: { id: number; name: string };
}

/** `GET /chats/manage/:chatId/bans` → `{ data: [...] }` item (docs/mobile-api/groups.md). */
export interface BannedChatMemberDto {
  id: number;
  createdAt: string;
  updatedAt: string;
  chatId: number;
  userId: number;
  roleId: number;
  user: UserDto;
}
