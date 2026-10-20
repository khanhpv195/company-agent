import { ApiProperty } from '@nestjs/swagger';
import type {
  Member as MemberContract,
  MemberRole,
  Session,
  SessionUser,
  Workspace as WorkspaceContract,
  WorkspacePlan,
} from '@repo/shared';

export class MemberDto implements MemberContract {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Khanh' })
  name: string;

  @ApiProperty({ example: 'khanh@example.com' })
  email: string;

  @ApiProperty({ enum: ['owner', 'admin', 'member'] })
  role: MemberRole;

  @ApiProperty({ type: String, nullable: true, example: '#b0516f' })
  color: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  departmentId: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Trưởng phòng Kinh doanh' })
  title: string | null;
}

export class SessionUserDto extends MemberDto implements SessionUser {
  @ApiProperty()
  emailVerified: boolean;
}

export class WorkspaceDto implements WorkspaceContract {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Khanh workspace' })
  name: string;

  @ApiProperty({ example: 'khanh-workspace' })
  slug: string;

  @ApiProperty({ enum: ['free', 'pro', 'team'] })
  plan: WorkspacePlan;
}

export class SessionDto implements Session {
  @ApiProperty({ type: SessionUserDto })
  user: SessionUserDto;

  @ApiProperty({ type: WorkspaceDto })
  workspace: WorkspaceDto;

  @ApiProperty()
  onboarded: boolean;
}
