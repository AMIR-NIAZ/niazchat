import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class createChatDto {
    @IsString()
    @MaxLength(20)
    title: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    members?: string[];
}
