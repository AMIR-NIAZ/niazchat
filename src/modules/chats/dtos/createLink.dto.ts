import {
    IsDateString,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    Min,
} from 'class-validator';
import { ChatId } from 'src/common/types/brands.type';

export class createLinkDto {
    @IsNumber()
    @IsNotEmpty()
    chatId: ChatId;

    @IsOptional()
    @IsNumber()
    @Min(0)
    usageLimit?: number = 0;

    @IsOptional()
    @IsDateString()
    expiresAt?: string;
}
