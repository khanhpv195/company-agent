import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiWrappedResponse, CurrentAuth, Roles, ResponseMessage } from '../../common/decorators';
import { AuthContext } from '../../common/types';
import { ConnectionsService } from './connections.service';
import { AuthorizeResultDto, ConnectDto, ConnectionDto } from './dto/connection.dto';

@ApiTags('connections')
@ApiBearerAuth()
@Controller('connections')
export class ConnectionsController {
  constructor(private readonly connections: ConnectionsService) {}

  @Get()
  @ResponseMessage('connections.LISTED')
  @ApiOperation({ summary: 'Zalo, Facebook and Gmail with this workspace state' })
  @ApiWrappedResponse(ConnectionDto, HttpStatus.OK, { isArray: true })
  list(@CurrentAuth() auth: AuthContext) {
    return this.connections.list(auth.workspaceId);
  }

  @Post(':id/authorize')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('connections.AUTHORIZED')
  @ApiOperation({ summary: 'Simulated OAuth consent: answers ok after 1.5 s' })
  @ApiWrappedResponse(AuthorizeResultDto)
  authorize(@Param('id') id: string) {
    return this.connections.authorize(id);
  }

  @Post(':id/connect')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('connections.CONNECTED')
  @ApiOperation({ summary: 'Turn the connection on (creates its inbox room on first connect)' })
  @ApiWrappedResponse(ConnectionDto)
  connect(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: ConnectDto) {
    return this.connections.connect(auth, id, dto);
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('connections.DISCONNECTED')
  @ApiOperation({ summary: 'Turn the connection off and delete its inbox room' })
  @ApiWrappedResponse(ConnectionDto)
  disconnect(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.connections.disconnect(auth, id);
  }
}
