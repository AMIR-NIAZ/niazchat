import { IsString } from 'class-validator';

/** PATCH /chats/manage/:chatId/title — trimmed + length-checked (1–64) in the service. */
export class CreateChatTitleDto {
    @IsString()
    title: string;
}
