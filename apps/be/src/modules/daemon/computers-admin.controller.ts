import { Controller, Delete, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiWrappedResponse, CurrentAuth, ResponseMessage, Roles } from '../../common/decorators';
import { AuthContext } from '../../common/types';
import { ComputerAdminService } from './computer-admin.service';
import { PairingCodeDto } from './dto/daemon.dto';
import { PairingService } from './pairing.service';

/** Owner/admin actions on the workspace's computers (the read side lives in ComputersModule). */
@ApiTags('computers')
@ApiBearerAuth()
@Controller('computers')
export class ComputersAdminController {
  constructor(
    private readonly pairing: PairingService,
    private readonly admin: ComputerAdminService,
  ) {}

  @Post('pairing-codes')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('computers.PAIRING_CODE_CREATED')
  @ApiOperation({ summary: 'A single-use code (10 minutes) for `agent connect`' })
  @ApiWrappedResponse(PairingCodeDto)
  createPairingCode(@CurrentAuth() auth: AuthContext) {
    return this.pairing.createCode(auth);
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('computers.REVOKED')
  @ApiOperation({
    summary: 'Revoke a computer: its API key stops working and its open work is cancelled',
  })
  @ApiWrappedResponse(null)
  revoke(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.admin.revoke(auth, id);
  }
}
