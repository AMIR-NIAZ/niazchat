import { IsNumber } from 'class-validator';

export class SeenDto {
    @IsNumber()
    chatId: number;

    @IsNumber()
    messageId: number;
}
