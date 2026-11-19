import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatMember } from 'src/modules/chats/entities/chat_members.entity';
import { UserBlock } from 'src/modules/chats/entities/user_block.entity';
import { GroupVisibilityGuard } from './guards/group-visibility.guard';
import { UserVisibilityGuard } from './guards/user-visibility.guard';
import { VisibilityService } from './visibility.service';

/**
 * Global so every module (auth, chats, messages, reactions, attachments) can
 * inject the one VisibilityService and use the guards without importing this
 * module again.
 */
@Global()
@Module({
    imports: [TypeOrmModule.forFeature([UserBlock, ChatMember])],
    providers: [VisibilityService, UserVisibilityGuard, GroupVisibilityGuard],
    exports: [VisibilityService, UserVisibilityGuard, GroupVisibilityGuard],
})
export class VisibilityModule {}
