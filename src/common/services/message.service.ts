import { Injectable } from '@nestjs/common';
import { PhoneDto } from 'src/modules/auth/dtos/phone.dto';

@Injectable()
export class MessageService {
    async sendOtpCode(dto: PhoneDto) {
        await new Promise((res) => setTimeout(res, 5000));
        console.log(`Vircharl send code for ${dto.phone}`);
    }
}
