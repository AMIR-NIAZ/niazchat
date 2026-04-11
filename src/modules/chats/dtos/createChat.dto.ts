import { ArrayMinSize, IsArray, IsString, MaxLength } from 'class-validator';

export class createChatDto {
    @IsString()
    @MaxLength(20)
    title: string;

    @IsArray()
    @ArrayMinSize(1)
    members: number[];
}
