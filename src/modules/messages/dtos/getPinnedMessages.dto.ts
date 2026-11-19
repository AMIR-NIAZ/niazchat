import { IsInt, Min } from 'class-validator';
import { ChatId } from 'src/common/types/brands.type';

/** Payload of `getPinnedMessages`: one chat's pinned messages (offline sync). */
export class GetPinnedMessagesDto {
    @IsInt()
    @Min(1)
    chatId: ChatId;
}
