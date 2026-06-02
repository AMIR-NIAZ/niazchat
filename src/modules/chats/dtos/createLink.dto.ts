import {
    IsDateString,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    Min,
} from 'class-validator';

export class createLinkDto {
    @IsNumber()
    @IsNotEmpty()
    chatId: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    usageLimit?: number = 0;

    @IsOptional()
    @IsDateString()
    expiresAt?: string;
}
