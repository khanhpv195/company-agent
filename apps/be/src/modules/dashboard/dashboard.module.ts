import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TasksModule } from '../tasks/tasks.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { AttentionItemRow } from './entities/attention-item.entity';
import { FeedItemRow } from './entities/feed-item.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AttentionItemRow, FeedItemRow]), TasksModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
