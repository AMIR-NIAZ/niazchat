import {
    ArrayMaxSize,
    ArrayMinSize,
    ArrayUnique,
    IsArray,
    IsInt,
    IsPositive,
    IsString,
    Length,
    Matches,
} from 'class-validator';
import { ChatId, MessageId } from 'src/common/types/brands.type';

export const MAX_FORWARD_MESSAGES = 20;
export const MAX_FORWARD_TARGETS = 5;
export const MAX_FORWARD_REQUESTS_PER_MINUTE = 20;
export const FORWARD_IDEMPOTENCY_TTL_SECONDS = 120;

export class ForwardMessagesDto {
    @IsInt()
    @IsPositive()
    fromChatId: ChatId;

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(MAX_FORWARD_MESSAGES)
    @ArrayUnique()
    @IsInt({ each: true })
    @IsPositive({ each: true })
    messageIds: MessageId[];

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(MAX_FORWARD_TARGETS)
    @ArrayUnique()
    @IsInt({ each: true })
    @IsPositive({ each: true })
    toChatIds: ChatId[];

    @IsString()
    @Length(8, 64)
    @Matches(/^[A-Za-z0-9_-]+$/, {
        message: 'requestId must be 8-64 characters of A-Z a-z 0-9 _ -',
    })
    requestId: string;
}
