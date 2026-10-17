import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiWrappedResponse, CurrentAuth, ResponseMessage, Roles } from '../../common/decorators';
import { CursorResult } from '../../common/dto';
import { AuthContext } from '../../common/types';
import { decodeAuditCursor } from './audit-cursor';
import { AuditService } from './audit.service';
import { AuditEventDto, AuditQueryDto } from './dto/audit.dto';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-events')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles('owner', 'admin')
  @ResponseMessage('audit.LISTED')
  @ApiOperation({
    summary: 'Audit log, newest first; page backwards with `before` = the last `meta.nextCursor`',
    description:
      'Keyset-paged: meta is { limit, nextCursor } and nextCursor is an opaque string (null at the end) to pass as `before`. There is no total.',
  })
  @ApiWrappedResponse(AuditEventDto, HttpStatus.OK, { isArray: true })
  async list(@CurrentAuth() auth: AuthContext, @Query() query: AuditQueryDto) {
    const before = query.before ? decodeAuditCursor(query.before) : null;
    const { items, nextCursor } = await this.audit.list(auth.workspaceId, {
      limit: query.limit,
      ...(before ? { before } : {}),
    });
    return new CursorResult(items, { limit: query.limit, nextCursor });
  }
}
