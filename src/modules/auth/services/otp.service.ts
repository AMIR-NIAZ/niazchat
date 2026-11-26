import { InjectQueue } from '@nestjs/bullmq';
import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { CacheService } from 'src/common/services/cache.service';
import { PhoneDto } from '../dtos/phone.dto';
import { Compare, Hash } from 'src/common/utils/hash.utils';
import { normalizePhone } from 'src/common/utils/phone.util';
import { VerifyDto } from '../dtos/verify.dto';

/** How long a pending code stays valid, in seconds. */
export const OTP_TTL_SECONDS = 60;

@Injectable()
export class OtpService {
    private readonly logger = new Logger(OtpService.name);

    constructor(
        private readonly caheService: CacheService,
        @InjectQueue('otp') private otpQueu: Queue,
    ) {}

    /**
     * Single source of truth for the OTP cache key. The phone is normalised
     * first so every spelling of the same number (`+989121112255`,
     * `0098912112255`, `09121112255`) maps to exactly one key.
     */
    private key(phone: string): string {
        return `otp:code:${normalizePhone(phone)}`;
    }

    async sendOtp(dto: PhoneDto) {
        const code = this.generateOtp();
        const key = this.key(dto.phone);

        this.logger.debug(`send otp key="${key}"`);

        await this.caheService.set(key, await Hash(code), OTP_TTL_SECONDS);
        await this.otpQueu.add('send', {
            dto,
            code,
        });

        return code;
    }

    /** True while a code is pending (used for the 60 s resend throttle). */
    async hasActiveCode(phone: string): Promise<boolean> {
        const stored = await this.caheService.get(this.key(phone));
        return stored !== undefined && stored !== null;
    }

    async verifyOtp(dto: VerifyDto) {
        const { phone, code } = dto;
        const key = this.key(phone);

        this.logger.debug(`verify otp key="${key}"`);

        const codeSent = await this.caheService.get(key);
        if (!codeSent) throw new NotFoundException('phone number not exit');
        if (!(await Compare(code, codeSent)))
            throw new BadRequestException('code not true');

        await this.caheService.del(key);
    }

    private generateOtp(): string {
        let otp = '';
        for (let i = 0; i < 5; i++) {
            otp += Math.floor(Math.random() * 10);
        }

        return process.env.PRODUCTION == 'true' ? otp : '00000';
    }
}
