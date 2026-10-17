import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComputersController } from './computers.controller';
import { ComputersService } from './computers.service';
import { Computer } from './entities/computer.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Computer])],
  controllers: [ComputersController],
  providers: [ComputersService],
  exports: [ComputersService, TypeOrmModule],
})
export class ComputersModule {}
