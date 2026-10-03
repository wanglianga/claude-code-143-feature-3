import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  User, Enterprise, Job, Assignment, AttendanceEvent, InsurancePolicy,
  JobEvent, Settlement, Appeal, Review,
} from '../../entities';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { TasksModule } from '../tasks/tasks.module';
import { CompensationModule } from '../compensation/compensation.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User, Enterprise, Job, Assignment, AttendanceEvent, InsurancePolicy,
      JobEvent, Settlement, Appeal, Review,
    ]),
    TasksModule,
    CompensationModule,
  ],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
