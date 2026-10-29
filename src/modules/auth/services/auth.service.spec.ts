import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthService } from './auth.service';
import { User } from '../entities/user.entity';
import { Role } from '../entities/role.entity';
import { Permission } from '../entities/permission.entity';
import { UserPermission } from '../entities/user_permissions.entity';
import { UserService } from './user.service';
import { JwtAppService } from './jwt.service';
import { CacheService } from 'src/common/services/cache.service';
import { OtpService } from './otp.service';

describe('AuthService', () => {
    let service: AuthService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AuthService,
                { provide: getRepositoryToken(User), useValue: {} },
                { provide: getRepositoryToken(Role), useValue: {} },
                { provide: getRepositoryToken(Permission), useValue: {} },
                { provide: getRepositoryToken(UserPermission), useValue: {} },
                { provide: UserService, useValue: {} },
                { provide: JwtAppService, useValue: {} },
                { provide: CacheService, useValue: {} },
                { provide: OtpService, useValue: {} },
                { provide: DataSource, useValue: {} },
            ],
        }).compile();

        service = module.get<AuthService>(AuthService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
