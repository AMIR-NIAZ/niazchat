import { Transform } from 'class-transformer';
import { IsPhoneNumber } from 'class-validator';
import { normalizePhone } from 'src/common/utils/phone.util';

export class PhoneDto {
    // Canonicalise before validation so every endpoint sees one spelling.
    @Transform(({ value }): string => normalizePhone(value as string))
    @IsPhoneNumber('IR')
    phone: string;
}
