import { IsString, MaxLength } from 'class-validator';

export class UpdateReactDto {
    @IsString()
    @MaxLength(60)
    name: string;

    @IsString()
    emoji: string;
}
