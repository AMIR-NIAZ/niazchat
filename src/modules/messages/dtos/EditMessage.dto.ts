import { IsNumber, IsString, MaxLength } from 'class-validator';
import { ChatId, MessageId } from 'src/common/types/brands.type';

export class EditMessageDto {
    @IsNumber()
    messageId: MessageId;

    @IsNumber()
    chatId: ChatId;

    @IsString()
    @MaxLength(5000)
    newContent: string;
}
