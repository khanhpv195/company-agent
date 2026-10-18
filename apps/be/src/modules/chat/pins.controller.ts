import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiWrappedResponse, CurrentAuth, ResponseMessage } from '../../common/decorators';
import { AuthContext } from '../../common/types';
import { CreatePinDto, PinItemDto, ReorderPinsDto } from './dto/interactions.dto';
import { PinsService } from './pins.service';

@ApiTags('pins')
@ApiBearerAuth()
@Controller('pins')
export class PinsController {
  constructor(private readonly pins: PinsService) {}

  @Get()
  @ResponseMessage('chat.PINS_LISTED')
  @ApiOperation({
    summary: 'The caller pins, in order (targets they can no longer open are skipped)',
  })
  @ApiWrappedResponse(PinItemDto, HttpStatus.OK, { isArray: true })
  list(@CurrentAuth() auth: AuthContext) {
    return this.pins.list(auth);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.PIN_ADDED')
  @ApiOperation({
    summary: 'Pin a room, a thread (its root message id) or a message (idempotent, 50 max)',
  })
  @ApiWrappedResponse(PinItemDto)
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreatePinDto) {
    return this.pins.create(auth, dto.targetType, dto.targetId);
  }

  // Declared before ':id' so "order" is never read as a pin id.
  @Put('order')
  @ResponseMessage('chat.PINS_REORDERED')
  @ApiOperation({ summary: 'Reorder the caller pins; answers the new list' })
  @ApiWrappedResponse(PinItemDto, HttpStatus.OK, { isArray: true })
  reorder(@CurrentAuth() auth: AuthContext, @Body() dto: ReorderPinsDto) {
    return this.pins.reorder(auth, dto.ids);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('chat.PIN_REMOVED')
  @ApiOperation({ summary: 'Remove one of the caller pins (an unknown id is a no-op)' })
  @ApiWrappedResponse(null)
  remove(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.pins.remove(auth, id);
  }
}
