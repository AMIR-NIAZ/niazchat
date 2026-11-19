import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { CountryCode } from 'libphonenumber-js';
import { RateLimitService } from 'src/common/services/rate-limit.service';
import { UserStatusEnum } from 'src/common/enums/UserStatus.enum';
import { UserId } from 'src/common/types/brands.type';
import { User } from '../entities/user.entity';
import { UserProfile } from '../entities/user_profile.entity';
import { Contact } from '../entities/contact.entity';
import { CreateContactDto, UpdateContactDto } from '../dtos/contact.dto';
import { VisibilityService } from 'src/modules/visibility/visibility.service';
import { sanitizeUserForViewer } from 'src/modules/visibility/visibility.util';

/** Default region used when a phone is supplied without a country code. */
const DEFAULT_CONTACT_REGION: CountryCode = 'IR';
const CREATE_RATE_LIMIT = 30;
const CREATE_RATE_WINDOW_SECONDS = 60;

export interface ContactItem {
    id: number;
    userId: number;
    alias: string | null;
    name: string;
    username: string | null;
    avatars: string[];
    phone?: string;
}

/** `Intl.Collator('fa')` orders Persian names correctly; `#` is not special. */
const collator = new Intl.Collator('fa', {
    sensitivity: 'base',
    numeric: true,
});

function displayName(user: User): string {
    const name = user.profile?.name?.trim();
    return name !== undefined && name !== '' ? name : 'بدون نام';
}

function normalizeAlias(raw: string | null | undefined): string | null {
    if (typeof raw !== 'string') {
        return null;
    }
    const trimmed = raw.trim();
    if (trimmed === '') {
        return null;
    }
    return trimmed.slice(0, 60);
}

/** Canonical E.164, or null when the input is not a phone number. */
function normalizeContactPhone(raw: string): string | null {
    const parsed = parsePhoneNumberFromString(
        raw.trim(),
        DEFAULT_CONTACT_REGION,
    );
    if (parsed === undefined || !parsed.isValid()) {
        return null;
    }
    return parsed.number;
}

/**
 * Server-side absolutization: stored avatars are server-relative
 * (`uploads/avatars/x.png`) and the static mount serves them at `/uploads`.
 * The request origin is used, so the response stays correct behind whatever
 * host the client reached.
 */
function absoluteAvatar(path: string, origin: string): string {
    if (/^https?:\/\//i.test(path)) {
        return path;
    }
    const relative = path.replace(/^\/+/, '');
    if (origin === '') {
        return relative;
    }
    return `${origin}/${relative}`;
}

/**
 * Saved contacts (`/contacts`): the people a user added manually.
 *
 * - Every row is scoped to the caller; another owner's id answers `404`.
 * - A user's phone is disclosed only when the caller supplied that exact
 *   number (saved by phone). Saving by id/username never exposes a phone.
 * - Resolution accepts exactly one of `userId`, `username` or `phone`.
 */
@Injectable()
export class ContactsService {
    constructor(
        @InjectRepository(Contact)
        private readonly contactRepository: Repository<Contact>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(UserProfile)
        private readonly profileRepository: Repository<UserProfile>,
        private readonly rateLimit: RateLimitService,
        private readonly visibility: VisibilityService,
    ) {}

    async list(
        ownerId: number,
        origin: string,
    ): Promise<{ items: ContactItem[] }> {
        const contacts = await this.contactRepository.find({
            where: { ownerId: ownerId as UserId },
            relations: { contactUser: { profile: true } },
        });

        // ONE visibility query for the page: a contact whose account blocked
        // the caller keeps their name but loses avatars/username/phone.
        const hidden = await this.visibility.blockersOfViewer(
            ownerId,
            contacts.map((contact) => Number(contact.contactUserId)),
        );
        const items = contacts.map(
            (contact): ContactItem =>
                sanitizeUserForViewer(
                    this.toItem(contact, origin),
                    hidden.has(Number(contact.contactUserId)),
                ),
        );
        items.sort((left, right) =>
            collator.compare(
                left.alias ?? left.name,
                right.alias ?? right.name,
            ),
        );
        return { items };
    }

    async create(
        ownerId: number,
        dto: CreateContactDto,
        origin: string,
    ): Promise<ContactItem> {
        await this.rateLimit.consume(
            this.createRateKey(ownerId),
            CREATE_RATE_LIMIT,
            CREATE_RATE_WINDOW_SECONDS,
            'Too many contact changes, try again later',
        );

        const selectors = [
            dto.userId !== undefined && dto.userId !== null
                ? String(dto.userId)
                : '',
            dto.username?.trim() ?? '',
            dto.phone?.trim() ?? '',
        ].filter((value) => value !== '');
        if (selectors.length !== 1) {
            throw new BadRequestException(
                'Provide exactly one of userId, username or phone',
            );
        }

        let suppliedPhone: string | null = null;
        let user: User | null = null;

        if (dto.userId !== undefined && dto.userId !== null) {
            user = await this.userRepository.findOne({
                where: {
                    id: dto.userId as UserId,
                    status: UserStatusEnum.ACTIVE,
                },
                relations: { profile: true },
            });
        } else if (dto.username !== undefined && dto.username.trim() !== '') {
            const username = dto.username
                .trim()
                .replace(/^@/, '')
                .toLowerCase();
            const profile = await this.profileRepository
                .createQueryBuilder('profile')
                .innerJoinAndSelect('profile.user', 'user')
                .where('LOWER(profile.username) = :username', { username })
                .andWhere('user.status = :status', {
                    status: UserStatusEnum.ACTIVE,
                })
                .getOne();
            user = profile?.user ?? null;
        } else {
            suppliedPhone = normalizeContactPhone(dto.phone ?? '');
            if (suppliedPhone === null) {
                throw new BadRequestException('phone must be a valid number');
            }
            user = await this.userRepository.findOne({
                where: {
                    phone: suppliedPhone,
                    status: UserStatusEnum.ACTIVE,
                },
                relations: { profile: true },
            });
        }

        if (user === null) {
            throw new NotFoundException("This person isn't on the app yet");
        }
        if (Number(user.id) === Number(ownerId)) {
            throw new BadRequestException('You cannot add yourself');
        }
        // A user who blocked the caller is indistinguishable from a user that
        // does not exist: the same generic 404, no saved contact row.
        if (await this.visibility.isBlockedBy(ownerId, Number(user.id))) {
            throw new NotFoundException("This person isn't on the app yet");
        }

        const existing = await this.contactRepository.findOne({
            where: {
                ownerId: ownerId as UserId,
                contactUserId: user.id,
            },
            relations: { contactUser: { profile: true } },
        });
        if (existing !== null) {
            // `item` lets the app show "Already in your contacts" and open the
            // chat without a second round-trip (the error filter passes it on).
            throw new ConflictException({
                message: 'Already in your contacts',
                item: this.toItem(existing, origin),
            });
        }

        const contact = this.contactRepository.create({
            ownerId: ownerId as UserId,
            contactUserId: user.id,
            alias: normalizeAlias(dto.alias),
            phone: suppliedPhone,
        });
        const saved = await this.contactRepository.save(contact);
        return this.toItem({ ...saved, contactUser: user }, origin);
    }

    async rename(
        ownerId: number,
        contactId: number,
        dto: UpdateContactDto,
        origin: string,
    ): Promise<ContactItem> {
        const contact = await this.contactRepository.findOne({
            where: {
                id: contactId as unknown as number,
                ownerId: ownerId as UserId,
            },
            relations: { contactUser: { profile: true } },
        });
        if (contact === null) {
            throw new NotFoundException('Contact not found');
        }
        contact.alias = normalizeAlias(dto.alias);
        const saved = await this.contactRepository.save(contact);
        return this.toItem(saved, origin);
    }

    async remove(
        ownerId: number,
        contactId: number,
    ): Promise<{ message: string }> {
        const result = await this.contactRepository.delete({
            id: contactId as unknown as number,
            ownerId: ownerId as UserId,
        });
        if (result.affected === undefined || result.affected === 0) {
            throw new NotFoundException('Contact not found');
        }
        return { message: 'Contact removed' };
    }

    private toItem(contact: Contact, origin: string): ContactItem {
        const user = contact.contactUser;
        const avatar = user?.profile?.avatars?.[0];
        const item: ContactItem = {
            id: Number(contact.id),
            userId: Number(contact.contactUserId),
            alias: contact.alias ?? null,
            name: user === undefined ? 'بدون نام' : displayName(user),
            username: user?.profile?.username ?? null,
            avatars:
                avatar === undefined ? [] : [absoluteAvatar(avatar, origin)],
        };
        // Only echo a phone the owner supplied and that still belongs to the
        // account: never leak a phone to someone who saved by id/username.
        if (
            contact.phone !== null &&
            user !== undefined &&
            user.phone === contact.phone
        ) {
            item.phone = contact.phone;
        }
        return item;
    }

    private createRateKey(userId: number): string {
        const bucket = Math.floor(Date.now() / 60_000);
        return `contacts:create:${userId}:${bucket}`;
    }
}
