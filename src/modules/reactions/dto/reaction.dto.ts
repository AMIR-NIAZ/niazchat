import { IsNumber } from 'class-validator';
import { ChatId, MessageId, ReactId } from 'src/common/types/brands.type';

export class ReactionDto {
    @IsNumber()
    messageId: MessageId;

    @IsNumber()
    reactId: ReactId;

    @IsNumber()
    chatId: ChatId;
}
