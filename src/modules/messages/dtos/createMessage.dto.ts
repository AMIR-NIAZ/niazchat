import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsEnum,
    IsNumber,
    IsOptional,
    IsString,
    MaxLength,
} from 'class-validator';
import { TypeMessageEnum } from 'src/common/enums/typeMessage.enum';
import {
    AttachmentId,
    ChatId,
    MessageId,
    UserId,
} from 'src/common/types/brands.type';

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
     * Text body. Optional when attachments are present (attachment-only or
     * text+attachment messages); required for text-only messages.
     */
    @IsString()
    @IsOptional()
    @MaxLength(5000)
    content?: string;

    /** Ids of files previously uploaded via POST /chats/:chatId/attachments. */
    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(10)
    @IsNumber({}, { each: true })
    attachments?: AttachmentId[];

    @IsOptional()
    @IsEnum(TypeMessageEnum)
    type: TypeMessageEnum = TypeMessageEnum.TEXT;
}
