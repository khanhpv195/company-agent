import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiWrappedResponse, CurrentAuth, ResponseMessage } from '../../common/decorators';
import { AuthContext } from '../../common/types';
import { ComputersService } from './computers.service';
import { ComputerDto } from './dto/computer.dto';

@ApiTags('computers')
@ApiBearerAuth()
@Controller('computers')
export class ComputersController {
  constructor(private readonly computers: ComputersService) {}

  @Get()
  @ResponseMessage('computers.LISTED')
  @ApiOperation({ summary: 'Computers of the caller workspace' })
  @ApiWrappedResponse(ComputerDto, HttpStatus.OK, { isArray: true })
  list(@CurrentAuth() auth: AuthContext) {
    return this.computers.list(auth.workspaceId);
  }
}
