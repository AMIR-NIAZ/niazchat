import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ChatId } from 'src/common/types/brands.type';

/** Page size when the client does not send `limit`. */
export const DEFAULT_MESSAGES_PAGE_SIZE = 30;

/** Upper bound accepted for `limit` (validated, never clamped silently). */
export const MAX_MESSAGES_PAGE_SIZE = 100;

/**
 * `getMessages` payload: one page of chat history, newest first.
 *
 * - no `beforeId` → the latest page (older clients keep working);
 * - `beforeId` → messages with `id < beforeId` (the previous `nextCursor`).
 */
export class GetMessagesDto {
    @IsInt()
    @Min(1)
    chatId: ChatId;

    @IsOptional()
    @IsInt()
    @Min(1)
    beforeId?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(MAX_MESSAGES_PAGE_SIZE)
    limit?: number;
}
