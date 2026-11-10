import { IsInt, Min } from 'class-validator';

/** `POST /chats/private` body: the target user id. */
export class CreatePrivateChatDto {
    @IsInt()
    @Min(1)
    userId: number;
}
