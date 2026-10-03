import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  User, Enterprise, Job, Assignment, AttendanceEvent, InsurancePolicy,
  JobEvent, InjuryClaim, ChatMessage, Settlement, CancellationCompensation,
} from '../../entities';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { SettlementModule } from '../settlements/settlement.module';
import { CancellationsModule } from '../cancellations/cancellations.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User, Enterprise, Job, Assignment, AttendanceEvent, InsurancePolicy,
      JobEvent, InjuryClaim, ChatMessage, Settlement, CancellationCompensation,
    ]),
    SettlementModule,
    CancellationsModule,
  ],
  providers: [TasksService],
  controllers: [TasksController],
  exports: [TasksService],
})
export class TasksModule {}
