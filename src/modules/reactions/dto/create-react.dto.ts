import { IsString, MaxLength } from 'class-validator';

export class CreateReactDto {
    @IsString()
    @MaxLength(60)
    name: string;

    @IsString()
    emoji: string;
}
