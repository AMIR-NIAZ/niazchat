import { IsInt, Min } from 'class-validator';
import { ChatId, MessageId } from 'src/common/types/brands.type';

/**
 * Shared payload for `pinMessage` / `unpinMessage`. The message must belong to
 * this chat; the service enforces that on the server and never trusts the
 * client's pairing.
 */
export class PinMessageDto {
    @IsInt()
    @Min(1)
    chatId: ChatId;

    @IsInt()
    @Min(1)
    messageId: MessageId;
}
