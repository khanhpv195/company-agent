import { ApiProperty } from '@nestjs/swagger';
import type { Computer as ComputerContract, ComputerStatus } from '@repo/shared';

export class ComputerDto implements ComputerContract {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'khanhpv-MacBook-Pro' })
  name: string;

  @ApiProperty({ example: 'macOS 26.1 · arm64' })
  os: string;

  @ApiProperty({ enum: ['online', 'offline', 'sleeping'] })
  status: ComputerStatus;

  @ApiProperty({ format: 'date-time' })
  lastHeartbeatAt: string;

  @ApiProperty()
  keepAwake: boolean;

  @ApiProperty({ example: '2.1.0' })
  cliVersion: string;

  @ApiProperty({ description: 'Demo machine driven by the in-app simulator' })
  simulated: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  revokedAt: string | null;
}
