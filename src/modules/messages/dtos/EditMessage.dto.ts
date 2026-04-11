import { IsNumber, IsString, MaxLength } from 'class-validator';

export class EditMessageDto {
    @IsNumber()
    messageId: number;

    @IsNumber()
    chatId: number;

    @IsString()
    @MaxLength(5000)
    newContent: string;
}
