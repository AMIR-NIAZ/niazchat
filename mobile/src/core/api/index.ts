import type {
    UserDto,
    PublicUserProfileDto,
    BannedChatMemberDto,
    AvatarMutationResponseDto,
} from './dto/user.dto';
import type {
    SendOtpPayloadDto,
    VerifyOtpPayloadDto,
    AuthTokensDto,
    RefreshTokenResponseDto,
    UpdateProfilePayloadDto,
    DeleteAvatarPayloadDto,
} from './dto/auth.dto';
import type { ChatDto, ChatType, CreateGroupPayloadDto } from './dto/chat.dto';
import type {
    CreateMessagePayloadDto,
    EditMessagePayloadDto,
    DeleteMessagePayloadDto,
    MessageDto,
    MessagePageDto,
    MessageReplyDto,
    MessageTypeName,
    ChatListUpdateDto,
} from './dto/message.dto';
import type { AttachmentUploadResponseDto } from './dto/attachment.dto';
import type {
    MessageReactionDto,
    ReactionGroupDto,
    ReactionSnapshotDto,
    ReactionTypeDto,
    ReactionUserDto,
    MessageReactionsDto,
} from './dto/reaction.dto';
import type { ApiErrorEnvelope } from './api-error';
import { ApiError } from './api-error';
import {
    registerApiTokenProvider,
    getApiTokenProvider,
    hasApiTokenProvider,
} from './token-provider';
import type { ApiTokenProvider } from './token-provider';
import { httpClient, toApiError } from './http-client';

export type {
    ApiTokenProvider,
    UserDto,
    PublicUserProfileDto,
    BannedChatMemberDto,
    AvatarMutationResponseDto,
    SendOtpPayloadDto,
    VerifyOtpPayloadDto,
    AuthTokensDto,
    RefreshTokenResponseDto,
    UpdateProfilePayloadDto,
    DeleteAvatarPayloadDto,
    ChatDto,
    ChatType,
    CreateGroupPayloadDto,
    CreateMessagePayloadDto,
    EditMessagePayloadDto,
    DeleteMessagePayloadDto,
    MessageDto,
    MessagePageDto,
    MessageReplyDto,
    MessageTypeName,
    ChatListUpdateDto,
    AttachmentUploadResponseDto,
    MessageReactionDto,
    ReactionGroupDto,
    ReactionSnapshotDto,
    ReactionTypeDto,
    ReactionUserDto,
    MessageReactionsDto,
    ApiErrorEnvelope,
};
export {
    ApiError,
    httpClient,
    toApiError,
    registerApiTokenProvider,
    getApiTokenProvider,
    hasApiTokenProvider,
};
