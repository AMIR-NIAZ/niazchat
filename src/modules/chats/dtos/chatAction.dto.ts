import { IsInt, Min } from 'class-validator';
import { ChatId } from 'src/common/types/brands.type';

/**
 * Shared payload for the private-chat actions (`blockUser`, `unblockUser`,
 * `deleteChatForMe`, `deleteChatForBoth`): the conversation the caller acts on.
 * The peer is ALWAYS derived from membership server-side, never sent by the
 * client, so one user can never target another user's conversation.
 */
export class ChatActionDto {
    @IsInt()
    @Min(1)
    chatId: ChatId;
}
