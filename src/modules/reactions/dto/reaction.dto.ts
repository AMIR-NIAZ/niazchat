import {
    IsNumber,
    IsOptional,
    IsString,
    MaxLength,
    Min,
} from 'class-validator';
import { ChatId, MessageId } from 'src/common/types/brands.type';

/**
 * Toggle payload for `reactMessage`: `emoji: null` clears the caller's one
 * reaction on the message; a string sets (or switches to) that type.
 */
export class MessageReactionsQueryDto {
    @IsNumber()
    @Min(1)
    chatId: ChatId;

    @IsNumber()
    @Min(1)
    messageId: MessageId;
}

export class ReactMessageDto {
    @IsNumber()
    @Min(1)
    chatId: ChatId;

    @IsNumber()
    @Min(1)
    messageId: MessageId;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    emoji?: string | null;
}
