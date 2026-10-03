import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  User, Enterprise, Job, Assignment, AttendanceEvent, InsurancePolicy,
  JobEvent, Settlement, Appeal, Review, WorkerLocationPing, CancellationCompensation,
} from '../../entities';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { TasksModule } from '../tasks/tasks.module';
import { CancellationsModule } from '../cancellations/cancellations.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User, Enterprise, Job, Assignment, AttendanceEvent, InsurancePolicy,
      JobEvent, Settlement, Appeal, Review, WorkerLocationPing, CancellationCompensation,
    ]),
    TasksModule,
    CancellationsModule,
  ],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
