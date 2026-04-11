import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateUserDto {
    @IsString()
    @MaxLength(20)
    name: string;

    @IsString()
    @MinLength(5)
    @MaxLength(32)
    @Matches(/^[a-zA-Z][a-zA-Z0-9_]*[a-zA-Z0-9]$/)
    username: string;

    @IsString()
    @MaxLength(100)
    biografy: string;
}
