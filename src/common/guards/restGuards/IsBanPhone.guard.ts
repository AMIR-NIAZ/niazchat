import {
    BadRequestException,
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RequestAuth } from '../../types/RequestAuth.type';
import { User } from 'src/modules/auth/entities/user.entity';
import { UserStatusEnum } from 'src/common/enums/UserStatus.enum';

@Injectable()
export class IsBanPhone implements CanActivate {
    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const Http = context.switchToHttp();
        const request = Http.getRequest<RequestAuth>();
        const phone = request.body.phone as string;
        if (!phone) throw new BadRequestException('phone not valid');

        const user = await this.userRepository.findOne({
            where: {
                phone,
            },
        });
        if (user && user.status === UserStatusEnum.BAN)
            throw new UnauthorizedException('phone is ban!!');

        return true;
    }
}
