import {
    BadRequestException,
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { RequestAuth } from '../../types/RequestAuth.type';
import { User } from 'src/modules/auth/entities/user.entity';
import { UserStatusEnum } from 'src/common/enums/UserStatus.enum';
import { normalizePhone } from 'src/common/utils/phone.util';

@Injectable()
export class IsBanPhone implements CanActivate {
    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const Http = context.switchToHttp();
        const request = Http.getRequest<RequestAuth>();
        const rawPhone = request.body.phone as string;
        if (!rawPhone) throw new BadRequestException('phone not valid');
        // Guards run before the validation pipe, so normalise here as well;
        // users are stored under the canonical form.
        const phone = normalizePhone(rawPhone);

        // Rows created before normalisation may still hold a local spelling.
        const user = await this.userRepository.findOne({
            where: {
                phone: In([...new Set([phone, rawPhone])]),
            },
        });
        if (user && user.status === UserStatusEnum.BAN)
            throw new UnauthorizedException('phone is ban!!');

        return true;
    }
}
