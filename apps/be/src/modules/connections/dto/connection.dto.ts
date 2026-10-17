import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import type {
  Connection,
  ConnectionAccount,
  ConnectionProvider,
  ConnectInput,
  ReplyMode,
} from '@repo/shared';

export const REPLY_MODES: ReplyMode[] = ['draft', 'auto'];
export const MAX_ROOM_NAME_LENGTH = 80;
export const MAX_ACCOUNT_LENGTH = 200;

const isString = { message: i18nValidationMessage('validation.IS_STRING') };

// ---------- responses ----------
export class ConnectionAccountDto implements ConnectionAccount {
  @ApiProperty()
  name: string;

  @ApiProperty()
  detail: string;
}

export class ConnectionDto implements Connection {
  @ApiProperty({ enum: ['zalo', 'facebook', 'gmail'] })
  id: ConnectionProvider;

  @ApiProperty()
  name: string;

  @ApiProperty()
  shortName: string;

  @ApiProperty()
  color: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ type: [String] })
  capabilities: string[];

  @ApiProperty({ type: [String] })
  permissions: string[];

  @ApiProperty()
  accountLabel: string;

  @ApiProperty({ type: [ConnectionAccountDto] })
  accounts: ConnectionAccountDto[];

  @ApiProperty({ enum: ['off', 'on'] })
  status: 'off' | 'on';

  @ApiProperty({ type: String, nullable: true })
  account: string | null;

  @ApiProperty()
  roomName: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  roomId: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  agentId: string | null;

  @ApiProperty({ enum: REPLY_MODES })
  mode: ReplyMode;
}

export class AuthorizeResultDto {
  @ApiProperty()
  ok: true;
}

// ---------- requests ----------
export class ConnectDto implements ConnectInput {
  @ApiProperty({ maxLength: MAX_ACCOUNT_LENGTH, description: 'The page, OA or mailbox' })
  @IsString(isString)
  @MaxLength(MAX_ACCOUNT_LENGTH, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  account: string;

  @ApiProperty({
    maxLength: MAX_ROOM_NAME_LENGTH,
    description: 'Room for the conversations; a leading # is dropped, empty = `<provider>-inbox`',
  })
  @IsString(isString)
  @MaxLength(MAX_ROOM_NAME_LENGTH, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  roomName: string;

  @ApiProperty({ format: 'uuid', description: 'The agent of the workspace that answers' })
  @IsString(isString)
  agentId: string;

  @ApiProperty({ enum: REPLY_MODES })
  @IsIn(REPLY_MODES, { message: i18nValidationMessage('validation.IS_ENUM') })
  mode: ReplyMode;
}
