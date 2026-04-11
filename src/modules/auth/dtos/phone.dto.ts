import { IsPhoneNumber } from 'class-validator';

export class PhoneDto {
    @IsPhoneNumber('IR')
    phone: string;
}
