import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Put,
    Req,
    UploadedFile,
    UseInterceptors,
} from '@nestjs/common';
import { Role } from 'src/common/decorators/role.decorator';
import { RoleEnum } from 'src/common/enums/role.enum';
import { UpdateUserDto } from '../dtos/updateUser.dto';
import { UserService } from '../services/user.service';
import { RequestAuth } from 'src/common/types/RequestAuth.type';
import { AvatarUploadInterceptor } from '../interceptors/avatar-upload.interceptor';

@Controller('user')
export class UserController {
    constructor(private readonly userService: UserService) {}

    @Put('updateme')
    @Role([RoleEnum.ALL])
    async upadteMe(@Body() dto: UpdateUserDto, @Req() req: RequestAuth) {
        return await this.userService.updateUser(dto, req.user);
    }

    @Put('uploade-avatar')
    @Role([RoleEnum.ALL])
    @UseInterceptors(AvatarUploadInterceptor)
    async updateAvatar(
        @UploadedFile() file: Express.Multer.File | undefined,
        @Req() req: RequestAuth,
    ) {
        if (!file) {
            throw new BadRequestException(
                'multipart field "avatar" with an image file is required',
            );
        }
        return await this.userService.uploadAvatar(file, req.user);
    }

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
}
