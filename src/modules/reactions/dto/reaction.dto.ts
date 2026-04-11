import { IsNumber } from 'class-validator';

export class ReactionDto {
    @IsNumber()
    messageId: number;

    @IsNumber()
    reactId: number;

    @IsNumber()
    chatId: number;
}
