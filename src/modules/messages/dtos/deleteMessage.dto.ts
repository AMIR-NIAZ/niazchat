import { IsNumber } from 'class-validator';

export class deleteMessageDto {
    @IsNumber()
    messageId: number;

    @IsNumber()
    chatId: number;
}
