import { IsInt, Min } from 'class-validator';
import { ChatId } from 'src/common/types/brands.type';

/** `markSeen` payload: advance the caller's read position in one chat. */
export class MarkSeenDto {
    @IsInt()
    @Min(1)
    chatId: ChatId;

    @IsInt()
    @Min(1)
    lastSeenId: number;
}
