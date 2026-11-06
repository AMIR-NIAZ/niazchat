import type { UserDto, BannedChatMemberDto } from './dto/user.dto';
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
  MessageTypeName,
  ChatListUpdateDto,
} from './dto/message.dto';
import type { AttachmentUploadResponseDto } from './dto/attachment.dto';
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
  BannedChatMemberDto,
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
  MessageTypeName,
  ChatListUpdateDto,
  AttachmentUploadResponseDto,
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
