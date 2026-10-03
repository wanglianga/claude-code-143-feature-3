import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CancelCompensation, Job, Assignment, User, Enterprise, AttendanceEvent,
} from '../../entities';
import { CompensationService } from './compensation.service';
import { CompensationController } from './compensation.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CancelCompensation, Job, Assignment, User, Enterprise, AttendanceEvent,
    ]),
  ],
  controllers: [CompensationController],
  providers: [CompensationService],
  exports: [CompensationService],
})
export class CompensationModule {}
