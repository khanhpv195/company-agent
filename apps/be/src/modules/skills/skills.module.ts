import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentsModule } from '../agents/agents.module';
import { TasksModule } from '../tasks/tasks.module';
import { SkillVersion } from './entities/skill-version.entity';
import { Skill } from './entities/skill.entity';
import { AgentSkillsController, SkillsController } from './skills.controller';
import { SkillsService } from './skills.service';

@Module({
  imports: [TypeOrmModule.forFeature([Skill, SkillVersion]), AgentsModule, TasksModule],
  controllers: [SkillsController, AgentSkillsController],
  providers: [SkillsService],
  exports: [SkillsService, TypeOrmModule],
})
export class SkillsModule {}
