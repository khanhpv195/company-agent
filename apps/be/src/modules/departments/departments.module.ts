import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentsModule } from '../agents/agents.module';
import { DepartmentAssignmentsController, DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';
import { Department } from './entities/department.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Department]), AgentsModule],
  controllers: [DepartmentsController, DepartmentAssignmentsController],
  providers: [DepartmentsService],
  exports: [DepartmentsService, TypeOrmModule],
})
export class DepartmentsModule {}
