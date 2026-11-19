import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Put,
    Query,
    Req,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { Role } from 'src/common/decorators/role.decorator';
import { RoleEnum } from 'src/common/enums/role.enum';
import { ChatId } from 'src/common/types/brands.type';
import { RequestAuth } from 'src/common/types/RequestAuth.type';
import {
    GroupBannedPage,
    GroupInfo,
    GroupMemberPage,
    GroupMembersService,
    MemberActionResponse,
    MemberPermissionsResponse,
    MemberPermissionsUpdateResponse,
} from '../services/group-members.service';
import { UpdateMemberPermissionsDto } from '../dtos/updateMemberPermissions.dto';
import { UpdateGroupMemberPermissionsDto } from '../dtos/updateGroupMemberPermissions.dto';
import {
    GroupMemberPermissionsResponse,
    GroupMemberPermissionsService,
    GroupMemberPermissionsUpdateResponse,
} from '../services/group-member-permissions.service';
import {
    MemberPermissionOverridesResponse,
    MemberPermissionOverridesService,
    MemberPermissionOverridesUpdateResponse,
} from '../services/member-permission-overrides.service';
import { UpdateMemberPermissionOverridesDto } from '../dtos/updateMemberPermissionOverrides.dto';
import { UpdateGroupInfoDto } from '../dtos/updateGroupInfo.dto';
import {
    GroupAvatarResponse,
    GroupInfoService,
    GroupInfoUpdateResponse,
} from '../services/group-info.service';
import { GroupAvatarUploadInterceptor } from '../interceptors/group-avatar-upload.interceptor';
import { GroupAvatarLimitGuard } from '../guards/group-avatar-limit.guard';
import { GroupVisibilityGuard } from 'src/modules/visibility/guards/group-visibility.guard';
import { AddGroupMembersDto } from '../dtos/addGroupMembers.dto';
import {
    AddMemberCandidate,
    AddMembersResponse,
    GroupAddMembersService,
} from '../services/group-add-members.service';

/**
 * Group info panel. Any authenticated user hits the routes; the service
 * authorizes the caller as a non-banned member of THAT group (or answers 4xx).
 * Route shapes are declared explicitly (no bare `:chatId` collision with the
 * legacy `/chats/manage/*` surface, which stays untouched).
 */
@Controller('chats')
export class GroupController {
    constructor(
        private readonly groups: GroupMembersService,
        private readonly groupInfo: GroupInfoService,
        private readonly memberPermissions: GroupMemberPermissionsService,
        private readonly memberOverrides: MemberPermissionOverridesService,
        private readonly groupAddMembers: GroupAddMembersService,
    ) {}

    @Get(':chatId/group')
    @Role([RoleEnum.ALL])
    @UseGuards(GroupVisibilityGuard)
    getGroupInfo(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
    ): Promise<GroupInfo> {
        return this.groups.getGroupInfo(chatId, request.user.sub);
    }

    /** Title and/or description; at least one field, sanitized DTO. */
    @Patch(':chatId/group')
    @Role([RoleEnum.ALL])
    updateGroupInfo(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Body() dto: UpdateGroupInfoDto,
    ): Promise<GroupInfoUpdateResponse> {
        return this.groupInfo.updateGroupInfo(chatId, request.user.sub, dto);
    }

    /**
     * Adds one photo (multipart field `avatar`); the newest becomes current.
     * The limit guard rejects BEFORE multer stores the file.
     */
    @Post(':chatId/group/avatars')
    @Role([RoleEnum.ALL])
    @UseGuards(GroupAvatarLimitGuard)
    @UseInterceptors(GroupAvatarUploadInterceptor)
    addGroupAvatar(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @UploadedFile() file: Express.Multer.File | undefined,
    ): Promise<GroupAvatarResponse> {
        return this.groupInfo.addGroupAvatar(chatId, request.user.sub, file);
    }

    /**
     * Legacy alias of the add endpoint (old clients): the uploaded photo is
     * ADDED as current; existing photos are no longer replaced or deleted.
     */
    @Post(':chatId/group/avatar')
    @Role([RoleEnum.ALL])
    @UseGuards(GroupAvatarLimitGuard)
    @UseInterceptors(GroupAvatarUploadInterceptor)
    uploadGroupAvatar(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @UploadedFile() file: Express.Multer.File | undefined,
    ): Promise<GroupAvatarResponse> {
        return this.groupInfo.addGroupAvatar(chatId, request.user.sub, file);
    }

    /** Removes ONE photo by its stored file name (404 when not in this group). */
    @Delete(':chatId/group/avatars/:fileName')
    @Role([RoleEnum.ALL])
    removeGroupAvatarByName(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Param('fileName') fileName: string,
    ): Promise<GroupAvatarResponse> {
        return this.groupInfo.removeGroupAvatarByFileName(
            chatId,
            request.user.sub,
            fileName,
        );
    }

    /** Moves one photo to index 0 (current); `changed: false` if already. */
    @Put(':chatId/group/avatars/:fileName/main')
    @Role([RoleEnum.ALL])
    setMainGroupAvatar(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Param('fileName') fileName: string,
    ): Promise<GroupAvatarResponse> {
        return this.groupInfo.setMainGroupAvatar(
            chatId,
            request.user.sub,
            fileName,
        );
    }

    /**
     * Legacy delete: removes ONLY the current photo (the next one becomes
     * current). A photo-less group answers `changed: false`.
     */
    @Delete(':chatId/group/avatar')
    @Role([RoleEnum.ALL])
    removeGroupAvatar(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
    ): Promise<GroupAvatarResponse> {
        return this.groupInfo.removeGroupAvatar(chatId, request.user.sub);
    }

    /**
     * Exact-user-id lookup for the Add-members sheet. Only callers allowed to
     * add members may search, and the projection never exposes private data.
     * A blocked pair answers the same generic 404 as an unknown user.
     */
    @Get(':chatId/add-members/lookup')
    @Role([RoleEnum.ALL])
    @UseGuards(GroupVisibilityGuard)
    lookupAddableUser(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Query('userId') userId?: string,
    ): Promise<AddMemberCandidate> {
        return this.groupAddMembers.lookupUser(
            chatId,
            request.user.sub,
            userId,
        );
    }

    /**
     * Adds up to 50 users in one batch. Owner/admin with `manage_members`, or a
     * regular member whose effective `add_members` is on (group default +
     * individual override). Per-user rejections come back in `failed` while the
     * rest commits (partial success).
     */
    @Post(':chatId/members')
    @Role([RoleEnum.ALL])
    addMembers(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Body() dto: AddGroupMembersDto,
    ): Promise<AddMembersResponse> {
        return this.groupAddMembers.addMembers(
            chatId,
            request.user.sub,
            dto.userIds,
        );
    }

    @Get(':chatId/members')
    @Role([RoleEnum.ALL])
    @UseGuards(GroupVisibilityGuard)
    getMembers(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Query('search') search?: string,
        @Query('cursor') cursor?: string,
        @Query('limit') limit?: string,
    ): Promise<GroupMemberPage> {
        return this.groups.getMembers(chatId, request.user.sub, {
            search,
            cursor,
            limit,
        });
    }

    /**
     * Banned users of the group, paginated like the members list. Owner, or an
     * admin holding `ban_user`/`all` (403 otherwise).
     */
    @Get(':chatId/banned')
    @Role([RoleEnum.ALL])
    @UseGuards(GroupVisibilityGuard)
    getBannedMembers(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Query('cursor') cursor?: string,
        @Query('limit') limit?: string,
    ): Promise<GroupBannedPage> {
        return this.groups.getBannedMembers(chatId, request.user.sub, {
            cursor,
            limit,
        });
    }

    /**
     * The group's MEMBER permission policy. Readable by every non-banned
     * member; `canEdit` tells the app whether to offer the management screen.
     */
    @Get(':chatId/member-permissions')
    @Role([RoleEnum.ALL])
    @UseGuards(GroupVisibilityGuard)
    getMemberPermissionsConfig(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
    ): Promise<GroupMemberPermissionsResponse> {
        return this.memberPermissions.getConfig(chatId, request.user.sub);
    }

    /**
     * Partial update of the member policy. Owner or an admin with
     * `manage_permissions` only; unknown keys are rejected by the global
     * ValidationPipe (`forbidNonWhitelisted`) and re-validated in the service.
     */
    @Patch(':chatId/member-permissions')
    @Role([RoleEnum.ALL])
    updateMemberPermissionsConfig(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Body() dto: UpdateGroupMemberPermissionsDto,
    ): Promise<GroupMemberPermissionsUpdateResponse> {
        return this.memberPermissions.updateConfig(
            chatId,
            request.user.sub,
            dto,
        );
    }

    /**
     * One member's INDIVIDUAL tri-state overrides plus their effective
     * permissions (group default resolved with allow/deny). Any non-banned
     * member may read; `canEdit` gates the editor.
     */
    @Get(':chatId/members/:memberId/permission-overrides')
    @Role([RoleEnum.ALL])
    @UseGuards(GroupVisibilityGuard)
    getMemberPermissionOverrides(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Param('memberId', ParseIntPipe) memberId: number,
    ): Promise<MemberPermissionOverridesResponse> {
        return this.memberOverrides.getForMember(
            chatId,
            memberId,
            request.user.sub,
        );
    }

    /**
     * Partial tri-state update for one regular member. Owner, or admin with
     * `manage_permissions`; regular members can never edit (not even self).
     */
    @Patch(':chatId/members/:memberId/permission-overrides')
    @Role([RoleEnum.ALL])
    updateMemberPermissionOverrides(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Param('memberId', ParseIntPipe) memberId: number,
        @Body() dto: UpdateMemberPermissionOverridesDto,
    ): Promise<MemberPermissionOverridesUpdateResponse> {
        return this.memberOverrides.updateForMember(
            chatId,
            memberId,
            request.user.sub,
            dto,
        );
    }

    /** Resets every override of one member back to `inherit`. */
    @Delete(':chatId/members/:memberId/permission-overrides')
    @Role([RoleEnum.ALL])
    resetMemberPermissionOverrides(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Param('memberId', ParseIntPipe) memberId: number,
    ): Promise<MemberPermissionOverridesUpdateResponse> {
        return this.memberOverrides.resetForMember(
            chatId,
            memberId,
            request.user.sub,
        );
    }

    @Get(':chatId/members/:memberId/permissions')
    @Role([RoleEnum.ALL])
    @UseGuards(GroupVisibilityGuard)
    getMemberPermissions(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Param('memberId', ParseIntPipe) memberId: number,
    ): Promise<MemberPermissionsResponse> {
        return this.groups.getMemberPermissions(
            chatId,
            memberId,
            request.user.sub,
        );
    }

    @Put(':chatId/members/:memberId/permissions')
    @Role([RoleEnum.ALL])
    updateMemberPermissions(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Param('memberId', ParseIntPipe) memberId: number,
        @Body() dto: UpdateMemberPermissionsDto,
    ): Promise<MemberPermissionsUpdateResponse> {
        return this.groups.updateMemberPermissions(
            chatId,
            memberId,
            request.user.sub,
            dto.permissions,
        );
    }

    /** Promote with an initial permission set (`{ permissions: string[] }`). */
    @Post(':chatId/members/:memberId/promote')
    @Role([RoleEnum.ALL])
    promoteMember(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Param('memberId', ParseIntPipe) memberId: number,
        @Body() dto: UpdateMemberPermissionsDto,
    ): Promise<MemberActionResponse> {
        return this.groups.promoteMember(
            chatId,
            memberId,
            request.user.sub,
            dto?.permissions,
        );
    }

    @Post(':chatId/members/:memberId/demote')
    @Role([RoleEnum.ALL])
    demoteMember(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Param('memberId', ParseIntPipe) memberId: number,
    ): Promise<MemberActionResponse> {
        return this.groups.demoteMember(chatId, memberId, request.user.sub);
    }

    @Delete(':chatId/members/:memberId')
    @Role([RoleEnum.ALL])
    removeMember(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Param('memberId', ParseIntPipe) memberId: number,
    ): Promise<MemberActionResponse> {
        return this.groups.removeMember(chatId, memberId, request.user.sub);
    }

    /**
     * Ban: owner (members and admins) or an admin with `ban_user`/`all`
     * (members only). The row keeps existing with the `ban` role, so the user
     * cannot read/send, rejoin by link or be re-added until unbanned.
     */
    @Post(':chatId/members/:memberId/ban')
    @Role([RoleEnum.ALL])
    banMember(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Param('memberId', ParseIntPipe) memberId: number,
    ): Promise<MemberActionResponse> {
        return this.groups.banMember(chatId, memberId, request.user.sub);
    }
}
