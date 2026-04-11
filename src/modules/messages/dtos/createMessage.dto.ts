import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateMessageDto {
    @IsNumber()
    @IsOptional()
    reply?: number;

    @IsOptional()
    @IsNumber()
    chatId?: number;

    @IsOptional()
    @IsNumber()
    userId?: number;

    @IsString()
    @MaxLength(5000)
    content: string;
}
