import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Req,
} from '@nestjs/common';
import { Role } from 'src/common/decorators/role.decorator';
import { RoleEnum } from 'src/common/enums/role.enum';
import { RequestAuth } from 'src/common/types/RequestAuth.type';
import { CreateContactDto, UpdateContactDto } from '../dtos/contact.dto';
import { ContactsMatchDto } from '../dtos/contacts-match.dto';
import { ContactsService } from '../services/contacts.service';
import { UserService } from '../services/user.service';

/** Absolute base URL of the current request, used for avatar URLs. */
function requestOrigin(req: RequestAuth): string {
    const host = req.get('host');
    if (host === undefined || host === '') {
        return '';
    }
    return `${req.protocol}://${host}`;
}

/**
 * Saved contacts + phone-contact matching for the app's Contacts tab.
 *
 * Every route is authenticated and scoped to the caller. The match endpoint
 * only ever echoes numbers the caller already uploaded, and neither stores nor
 * logs them.
 */
@Controller('contacts')
export class ContactsController {
    constructor(
        private readonly contactsService: ContactsService,
        private readonly userService: UserService,
    ) {}

    @Get()
    @Role([RoleEnum.ALL])
    list(@Req() req: RequestAuth) {
        return this.contactsService.list(req.user.sub, requestOrigin(req));
    }

    @Post()
    @Role([RoleEnum.ALL])
    create(@Body() dto: CreateContactDto, @Req() req: RequestAuth) {
        return this.contactsService.create(
            req.user.sub,
            dto,
            requestOrigin(req),
        );
    }

    @Patch(':id')
    @Role([RoleEnum.ALL])
    rename(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdateContactDto,
        @Req() req: RequestAuth,
    ) {
        return this.contactsService.rename(
            req.user.sub,
            id,
            dto,
            requestOrigin(req),
        );
    }

    @Delete(':id')
    @Role([RoleEnum.ALL])
    remove(@Param('id', ParseIntPipe) id: number, @Req() req: RequestAuth) {
        return this.contactsService.remove(req.user.sub, id);
    }

    @Post('match')
    @Role([RoleEnum.ALL])
    async match(@Body() dto: ContactsMatchDto, @Req() req: RequestAuth) {
        return await this.userService.matchContacts(req.user.sub, dto.phones);
    }
}
