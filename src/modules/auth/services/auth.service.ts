import {
    BadRequestException,
    ForbiddenException,
    HttpException,
    HttpStatus,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { Not, Repository } from 'typeorm';
import { JwtPayload } from 'src/common/types/jwt-payload.type';
import { JwtAppService } from './jwt.service';
import { PhoneDto } from '../dtos/phone.dto';
import { CacheService } from 'src/common/services/cache.service';
import { OtpService } from './otp.service';
import { VerifyDto } from '../dtos/verify.dto';
import { UserStatusEnum } from 'src/common/enums/UserStatus.enum';
import { Compare, Hash } from 'src/common/utils/hash.utils';
import { Role } from '../entities/role.entity';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { RoleEnum } from 'src/common/enums/role.enum';
import { UserService } from './user.service';

@Injectable()
export class AuthService {
    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(Role)
        private readonly roleRepository: Repository<Role>,
        private readonly userService: UserService,
        private readonly jwtService: JwtAppService,
        private readonly cacheService: CacheService,
        private readonly otpService: OtpService,
    ) {}

    async register(dto: PhoneDto) {
        const { phone } = dto;

        const isOtpSend: unknown = await this.cacheService.get(
            `phone:${phone}`,
        );
        if (isOtpSend)
            throw new HttpException('code sent', HttpStatus.TOO_MANY_REQUESTS);

        await this.otpService.sendOtp(dto);

        return { message: 'code send successfully' };
    }

    async verifyUserByOtp(dto: VerifyDto) {
        const { phone } = dto;

        await this.otpService.verifyOtp(dto);

        const { accessToken, refreshToken } = await this.submitUser(phone);

        return {
            message: 'user logined successfull',
            data: { accessToken, refreshToken },
        };
    }

    private async submitUser(phone: string) {
        let user = await this.userRepository.findOne({ where: { phone } });

        if (!user) {
            const role = await this.roleRepository.findOne({
                where: {
                    name: RoleEnum.USER,
                },
            });
            if (!role) throw new NotFoundException('role not found');

            user = await this.userRepository.save({
                phone,
                role: { id: role.id },
            });
        }

        return this.generateTokens(user);
    }

    private async generateTokens(user: User) {
        console.log('user', user);
        const { accessToken, refreshToken } =
            await this.jwtService.generateToken({
                sub: user.id,
                role: user.role.name,
            });
        user.refreshToken = await Hash(refreshToken);
        await this.userRepository.save(user);

        return { accessToken, refreshToken };
    }

    async refreshToken(token: string) {
        const payload = await this.jwtService.verfiyRefreshToken(token);

        const user = await this.userRepository.findOne({
            where: { id: payload.sub },
        });
        const isTokenValid = await Compare(token, user?.refreshToken);
        if (!(user && isTokenValid)) throw new ForbiddenException();

        const accessToken: string = await this.jwtService.generateAccessToken({
            sub: payload.sub,
            role: payload.role,
        });

        return { accessToken };
    }

    async getme(payload: JwtPayload): Promise<User | null> {
        const user = this.userRepository.findOne({
            where: { id: payload.sub },
            relations: ['role'],
        });
        return user;
    }

    async banUser(id: number) {
        const role = await this.roleRepository.findOne({
            where: {
                name: RoleEnum.OWNER,
            },
        });
        if (!role) throw new NotFoundException('role not found');

        const user = await this.userRepository.findOne({
            where: {
                id,
                role: Not({ id: role.id }),
            },
        });
        if (!user) throw new NotFoundException('user not found');

        const statusBaned = await this.userRepository.update(user.id, {
            status: UserStatusEnum.BAN,
            refreshToken: undefined,
        });

        this.userService.deleteAllAvatar(id);

        return { message: `user baned is ${statusBaned.affected}` };
    }
}
