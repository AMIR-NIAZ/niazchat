import {
    IsEnum,
    IsNumber,
    IsOptional,
    IsString,
    MaxLength,
} from 'class-validator';
import { TypeMessageEnum } from 'src/common/enums/typeMessage.enum';

export class CreateMessageDto {
    @IsNumber()
    @IsOptional()
    reply?: number;

    @IsOptional()
    @IsNumber()
    chatId?: number;

    @IsOptional()
    @IsNumber()
    userId?: number;

    @IsString()
    @MaxLength(5000)
    content: string;

    @IsOptional()
    @IsEnum(TypeMessageEnum)
    type: TypeMessageEnum = TypeMessageEnum.TEXT;
}
