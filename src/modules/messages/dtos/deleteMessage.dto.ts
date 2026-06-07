import { IsNumber } from 'class-validator';
import { ChatId, MessageId } from 'src/common/types/brands.type';

export class deleteMessageDto {
    @IsNumber()
    messageId: MessageId;

    @IsNumber()
    chatId: ChatId;
}
