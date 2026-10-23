import {
    IsEnum,
    IsNumber,
    IsOptional,
    IsString,
    MaxLength,
} from 'class-validator';
import { TypeMessageEnum } from 'src/common/enums/typeMessage.enum';
import { ChatId, MessageId, UserId } from 'src/common/types/brands.type';

export class CreateMessageDto {
    @IsNumber()
    @IsOptional()
    reply?: MessageId;

    @IsOptional()
    @IsNumber()
    chatId: ChatId;

    @IsOptional()
    @IsNumber()
    userId?: UserId;

    @IsString()
    @MaxLength(5000)
    content: string;

    @IsOptional()
    @IsEnum(TypeMessageEnum)
    type: TypeMessageEnum = TypeMessageEnum.TEXT;
}
