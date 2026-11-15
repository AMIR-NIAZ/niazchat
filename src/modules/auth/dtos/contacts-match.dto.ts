import { ArrayMaxSize, IsArray, IsString } from 'class-validator';
import { CONTACTS_MATCH_MAX_PHONES } from '../utils/contacts-match.util';

export class ContactsMatchDto {
    @IsArray()
    @ArrayMaxSize(CONTACTS_MATCH_MAX_PHONES, {
        message: `phones must contain at most ${CONTACTS_MATCH_MAX_PHONES} numbers`,
    })
    @IsString({ each: true })
    phones: string[];
}
