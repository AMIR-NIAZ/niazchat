import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    Header,
    Param,
    ParseIntPipe,
    Post,
    Put,
    Req,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { Role } from 'src/common/decorators/role.decorator';
import { RoleEnum } from 'src/common/enums/role.enum';
import { UpdateUserDto } from '../dtos/updateUser.dto';
import { UserService } from '../services/user.service';
import { RequestAuth } from 'src/common/types/RequestAuth.type';
import { AvatarUploadInterceptor } from '../interceptors/avatar-upload.interceptor';
import { AvatarLimitGuard } from '../guards/avatar-limit.guard';

@Controller('user')
export class UserController {
    constructor(private readonly userService: UserService) {}

    @Put('updateme')
    @Role([RoleEnum.ALL])
    async upadteMe(@Body() dto: UpdateUserDto, @Req() req: RequestAuth) {
        return await this.userService.updateUser(dto, req.user);
    }

    /**
     * Canonical upload route. Multipart field `avatar`; appends the stored file
     * as the caller's current photo (index 0) and returns the updated user.
     */
    @Post('avatars')
    @Role([RoleEnum.ALL])
    @UseGuards(AvatarLimitGuard)
    @UseInterceptors(AvatarUploadInterceptor)
    async createAvatar(
        @UploadedFile() file: Express.Multer.File | undefined,
        @Req() req: RequestAuth,
    ) {
        return await this.storeAvatar(file, req);
    }

    /**
     * Legacy upload route (typo is canonical for old clients). Same behavior as
     * `POST /user/avatars`: it PREPENDS instead of replacing, so older builds
     * keep working and the newest photo stays current.
     */
    @Put('uploade-avatar')
    @Role([RoleEnum.ALL])
    @UseGuards(AvatarLimitGuard)
    @UseInterceptors(AvatarUploadInterceptor)
    async updateAvatar(
        @UploadedFile() file: Express.Multer.File | undefined,
        @Req() req: RequestAuth,
    ) {
        return await this.storeAvatar(file, req);
    }

    private async storeAvatar(
        file: Express.Multer.File | undefined,
        req: RequestAuth,
    ) {
        if (!file) {
            throw new BadRequestException(
                'multipart field "avatar" with an image file is required',
            );
        }
        return await this.userService.uploadAvatar(file, req.user);
    }

    /** Removes one photo of the caller, identified by its stored file name. */
    @Delete('avatars/:fileName')
    @Role([RoleEnum.ALL])
    async removeAvatar(
        @Param('fileName') fileName: string,
        @Req() req: RequestAuth,
    ) {
        return await this.userService.removeAvatar(fileName, req.user);
    }

    /** Promotes one of the caller's photos to current (index 0). */
    @Put('avatars/:fileName/main')
    @Role([RoleEnum.ALL])
    async setMainAvatar(
        @Param('fileName') fileName: string,
        @Req() req: RequestAuth,
    ) {
        return await this.userService.setMainAvatar(fileName, req.user);
    }

    /**
     * Legacy delete: body `{ avatar: "<exact stored path>" }`, removes that path
     * and its file. Kept unchanged for old clients.
     */
    @Delete('delete-avatar')
    @Role([RoleEnum.ALL])
    async deleteAvatar(
        @Body('avatar') avatar: string,
        @Req() req: RequestAuth,
    ) {
        return await this.userService.deleteAvatar(avatar, req.user);
    }

    @Get('pv/:userName')
    @Role([RoleEnum.ALL])
    async getUserById(@Param('userName') userName: string) {
        return await this.userService.getUserByUsername(userName);
    }

    /**
     * Public profile of any user (id-based), for the user-info screen.
     *
     * Declared AFTER the static `pv/:userName` route so a literal segment can
     * never be read as an id. `ParseIntPipe` answers 400 for non-numeric ids;
     * the service rejects 0/negative ids the same way.
     *
     * Express computes the (weak) ETag from the JSON body and answers 304 for
     * `If-None-Match`, so `private, max-age=30` is the only header needed.
     */
    @Get(':userId/profile')
    @Role([RoleEnum.ALL])
    @Header('Cache-Control', 'private, max-age=30')
    @Header('Vary', 'Authorization')
    async getUserProfile(@Param('userId', ParseIntPipe) userId: number) {
        return await this.userService.getPublicProfile(userId);
    }
}
