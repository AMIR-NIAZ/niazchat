import {
    Injectable,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { Repository } from 'typeorm';
import { JwtPayload } from 'src/common/types/jwt-payload.type';
import { UpdateUserDto } from '../dtos/updateUser.dto';
import * as fs from 'fs';
import { UserId } from 'src/common/types/brands.type';

@Injectable()
export class UserService {
    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
    ) {}

    async onlineUser(user: JwtPayload) {
        await this.userRepository.update({ id: user.sub }, { isOnline: true });
    }

    async offlineUser(user: JwtPayload) {
        await this.userRepository.update(
            { id: user.sub },
            { isOnline: false, lastSeen: new Date() },
        );
    }

    async getUserByUsername(username: string) {
        const user = await this.userRepository.findOne({
            where: { username },
        });
        if (!user) throw new NotFoundException('user not found');

        return { data: user };
    }

    async updateUser(dto: UpdateUserDto, user: JwtPayload) {
        const statusUpdate = await this.userRepository.update(user.sub, dto);
        return { message: `user updated is ${statusUpdate.affected}` };
    }

    async uploadAvatar(avatar: string, user: JwtPayload) {
        const userData = await this.userRepository.findOneBy({ id: user.sub });
        if (!userData) throw new NotFoundException();

        userData.avatars = [...userData.avatars, avatar];
        await this.userRepository.save(userData);

        return { message: 'avatar updated successfully' };
    }

    async deleteAvatar(avatarPath: string, user: JwtPayload) {
        const userData = await this.userRepository.findOneBy({ id: user.sub });
        if (!userData) throw new NotFoundException();

        if (!userData.avatars.includes(avatarPath))
            throw new NotFoundException();

        userData.avatars = userData.avatars.filter(
            (avatar) => avatar !== avatarPath,
        );
        await this.userRepository.save(userData);

        if (fs.existsSync(avatarPath)) {
            await fs.promises.unlink(avatarPath);
        }

        return { message: 'avatar updated successfully' };
    }

    async deleteAllAvatar(userId: UserId): Promise<void> {
        const userData = await this.userRepository.findOneBy({ id: userId });
        if (!userData) throw new NotFoundException('User not found');

        try {
            for (const img of userData.avatars) {
                const fileExists = await fs.promises
                    .stat(img)
                    .then(() => true)
                    .catch(() => false);
                if (fileExists) {
                    await fs.promises.unlink(img);
                }
            }
        } catch (err) {
            throw new InternalServerErrorException((err as Error).message);
        }

        userData.avatars = [];
        await this.userRepository.save(userData);
    }
}
