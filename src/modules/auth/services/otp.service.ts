import { InjectQueue } from '@nestjs/bullmq';
import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { CacheService } from 'src/common/services/cache.service';
import { PhoneDto } from '../dtos/phone.dto';
import { Compare, Hash } from 'src/common/utils/hash.utils';
import { VerifyDto } from '../dtos/verify.dto';

@Injectable()
export class OtpService {
    constructor(
        private readonly caheService: CacheService,
        @InjectQueue('otp') private otpQueu: Queue,
    ) {}

    async sendOtp(dto: PhoneDto) {
        const code = this.generateOtp();

        await this.caheService.set(`phone:${dto.phone}`, await Hash(code), 60);
        await this.otpQueu.add('send', {
            dto,
            code,
        });

        return code;
    }

    async verifyOtp(dto: VerifyDto) {
        const { phone, code } = dto;

        const codeSent = await this.caheService.get(`phone:${phone}`);
        if (!codeSent) throw new NotFoundException('phone number not exit');
        if (!(await Compare(code, codeSent)))
            throw new BadRequestException('code not true');

        await this.caheService.del(`phone:${phone}`);
    }

    private generateOtp(): string {
        let otp = '';
        for (let i = 0; i < 5; i++) {
            otp += Math.floor(Math.random() * 10);
        }

        return process.env.PRODUCTION == 'true' ? otp : '00000';
    }
}
