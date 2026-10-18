import { Global, Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { PresenceController } from './presence.controller';
import { EventsService } from './events.service';

@Global()
@Module({
  controllers: [EventsController, PresenceController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
