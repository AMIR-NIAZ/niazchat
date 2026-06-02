import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SeederService } from './services/seeder.service';
import { RoleChat } from '../chats/entities/role_chat.entity';
import { Permission } from '../auth/entities/permission.entity';
import { Role } from '../auth/entities/role.entity';
import { PermissionChat } from '../chats/entities/permission_chat.entity';
import { TypeMessage } from '../messages/entities/typeMessage.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            Role,
            RoleChat,
            PermissionChat,
            Permission,
            TypeMessage,
        ]),
    ],
    providers: [SeederService],
    exports: [SeederService],
})
export class SeedersModule {}
