import {
    ForbiddenException,
    HttpException,
    HttpStatus,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { UserProfile } from '../entities/user_profile.entity';
import { DataSource, Not, Repository } from 'typeorm';
import { JwtPayload } from 'src/common/types/jwt-payload.type';
import { JwtAppService } from './jwt.service';
import { PhoneDto } from '../dtos/phone.dto';
import { CacheService } from 'src/common/services/cache.service';
import { OtpService } from './otp.service';
import { VerifyDto } from '../dtos/verify.dto';
import { UserStatusEnum } from 'src/common/enums/UserStatus.enum';
import { Compare, Hash } from 'src/common/utils/hash.utils';
import { Role } from '../entities/role.entity';
import { RoleEnum } from 'src/common/enums/role.enum';
import { UserService } from './user.service';
import { UserPermission } from '../entities/user_permissions.entity';
import { Permission } from '../entities/permission.entity';
import { UserId } from 'src/common/types/brands.type';
import { toUserResponse } from '../utils/user-response.util';

@Injectable()
export class AuthService {
    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(Role)
        private readonly roleRepository: Repository<Role>,
        @InjectRepository(UserProfile)
        private readonly userProfileRepository: Repository<UserProfile>,
        private readonly userService: UserService,
        private readonly jwtService: JwtAppService,
        private readonly cacheService: CacheService,
        private readonly otpService: OtpService,
        private readonly dataSource: DataSource,
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
        const user = await this.dataSource.transaction(async (manager) => {
            let user = await manager.findOne(User, {
                where: { phone },
                relations: { role: true, profile: true },
            });

            if (user) {
                if (!user.role) {
                    const role = await manager.findOne(Role, {
                        where: { name: RoleEnum.USER },
                    });
                    if (!role) throw new NotFoundException('role not found');
                    user.role = role;
                    user = await manager.save(user);
                }

                if (!user.profile) {
                    user.profile = await manager.save(
                        manager.create(UserProfile, { user }),
                    );
                }

                return user;
            }

            const role = await manager.findOne(Role, {
                where: {
                    name: RoleEnum.USER,
                },
            });
            if (!role) throw new NotFoundException('role not found');

            user = await manager.save(manager.create(User, { phone, role }));
            user.profile = await manager.save(
                manager.create(UserProfile, { user }),
            );

            return user;
        });

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

    async getme(payload: JwtPayload) {
        const user = await this.userRepository.findOne({
            where: { id: payload.sub },
            relations: { role: true, profile: true },
            select: {
                id: true,
                phone: true,
                isOnline: true,
                lastSeen: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                role: {
                    id: true,
                    name: true,
                },
                profile: {
                    id: true,
                    name: true,
                    username: true,
                    biografy: true,
                    avatars: true,
                    createdAt: true,
                    updatedAt: true,
                },
            },
        });
        if (!user) return null;

        return toUserResponse(user);
    }

    async banUser(id: UserId) {
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

        await this.userProfileRepository.delete({
            userId: id
        });

        await this.userService.deleteAllAvatar(id);

        return { message: `user baned is ${statusBaned.affected}` };
    }
}
