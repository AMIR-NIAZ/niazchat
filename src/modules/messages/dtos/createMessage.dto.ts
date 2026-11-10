import {
    ArrayMaxSize,
    ArrayMinSize,
    ArrayUnique,
    IsArray,
    IsEnum,
    IsNumber,
    IsOptional,
    IsPositive,
    IsString,
    Matches,
    MaxLength,
} from 'class-validator';
import { TypeMessageEnum } from 'src/common/enums/typeMessage.enum';
import {
    AttachmentId,
    ChatId,
    MessageId,
    UserId,
} from 'src/common/types/brands.type';
import { MAX_ATTACHMENTS_PER_MESSAGE } from 'src/modules/attachments/attachment.constants';

export class CreateMessageDto {
    /**
     * Id of the message being replied to. Missing/non-numeric means "no reply"
     * (normalized server-side); a valid id must belong to the same chat and be
     * not deleted, otherwise the request is rejected.
     */
    @IsOptional()
    reply?: MessageId;

    @IsOptional()
    @IsNumber()
    chatId: ChatId;

    @IsOptional()
    @IsNumber()
    userId?: UserId;

    /**
     * Text body / caption. Optional when attachments are present; required for
     * text-only messages. Empty strings are allowed with attachments.
     */
    @IsString()
    @IsOptional()
    @MaxLength(5000)
    content?: string;

    /** Ids of files previously uploaded via POST /chats/:chatId/attachments. */
    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(MAX_ATTACHMENTS_PER_MESSAGE)
    @ArrayUnique()
    @IsPositive({ each: true })
    @IsNumber({}, { each: true })
    attachments?: AttachmentId[];

    /**
     * Client-generated id echoed back on the room event and the ack so the app
     * can match its optimistic bubble even when the caption is empty or two
     * identical messages are sent in a row.
     */
    @IsOptional()
    @IsString()
    @Matches(/^[A-Za-z0-9_-]{1,64}$/, {
        message: 'clientMessageId must be 1-64 characters of A-Z a-z 0-9 _ -',
    })
    clientMessageId?: string;

    @IsOptional()
    @IsEnum(TypeMessageEnum)
    type: TypeMessageEnum = TypeMessageEnum.TEXT;
}
