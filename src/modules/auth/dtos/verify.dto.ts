import { Transform } from 'class-transformer';
import { IsPhoneNumber, IsString } from 'class-validator';
import { normalizePhone } from 'src/common/utils/phone.util';

export class VerifyDto {
    // Same canonical form as PhoneDto, so the OTP key matches on verify.
    @Transform(({ value }): string => normalizePhone(value as string))
    @IsPhoneNumber('IR')
    phone: string;

    @IsString()
    code: string;
}
