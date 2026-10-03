import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  User, Enterprise, Job, Assignment, AttendanceEvent,
  WorkerLocationPing, CancellationCompensation,
} from '../../entities';
import { CancellationsService } from './cancellations.service';
import { CancellationsController } from './cancellations.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User, Enterprise, Job, Assignment, AttendanceEvent,
      WorkerLocationPing, CancellationCompensation,
    ]),
  ],
  providers: [CancellationsService],
  controllers: [CancellationsController],
  exports: [CancellationsService],
})
export class CancellationsModule {}
