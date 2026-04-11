import { IsPhoneNumber, IsString } from 'class-validator';

export class VerifyDto {
    @IsPhoneNumber('IR')
    phone: string;

    @IsString()
    code: string;
}
