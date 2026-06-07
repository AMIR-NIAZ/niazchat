import { IsNumber } from 'class-validator';
import { ChatId, MessageId } from 'src/common/types/brands.type';

export class SeenDto {
    @IsNumber()
    chatId: ChatId;

    @IsNumber()
    messageId: MessageId;
}
