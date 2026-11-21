import {
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    Max,
    MaxLength,
    Min,
} from 'class-validator';
import { ChatId } from 'src/common/types/brands.type';

/** Types exposed by the shared-content tabs (wire values). */
export const CHAT_MEDIA_TYPES = [
    'media',
    'voice',
    'music',
    'links',
    'files',
] as const;

export type ChatMediaType = (typeof CHAT_MEDIA_TYPES)[number];

export const DEFAULT_CHAT_MEDIA_PAGE_SIZE = 30;
export const MAX_CHAT_MEDIA_PAGE_SIZE = 100;

/**
 * `getChatMedia` payload: one page of the chat's shared content, newest first.
 *
 * `cursor` is the opaque `nextCursor` from the previous page (`null`/absent
 * for the first page). It encodes `(createdAt, id)` so an insertion between
 * pages can never duplicate or skip an item.
 */
export class GetChatMediaDto {
    @IsInt()
    @Min(1)
    chatId: ChatId;

    @IsIn(CHAT_MEDIA_TYPES)
    type: ChatMediaType;

    @IsOptional()
    @IsString()
    @MaxLength(160)
    cursor?: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(MAX_CHAT_MEDIA_PAGE_SIZE)
    limit?: number;
}
