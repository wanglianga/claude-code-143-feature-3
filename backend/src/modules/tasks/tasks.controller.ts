import {
  Body, Controller, Get, Param, Post, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard, Roles, RoleGuard } from '../auth/auth.guard';
import { TasksService, CheckInDto } from './tasks.service';

@Controller('api')
@UseGuards(AuthGuard, RoleGuard)
export class TasksController {
  constructor(private tasks: TasksService) {}

  // 任务室：同一任务内聚合派单/考勤/保险/工时/事件/聊天/结算
  @Get('assignments/:id/room')
  room(@Param('id') id: string) {
    return this.tasks.room(Number(id));
  }

  // ---------- 考勤：四重校验 ----------
  @Roles('WORKER')
  @Post('attendance/check-in')
  checkIn(@Req() req: any, @Body() dto: CheckInDto) {
    return this.tasks.checkIn(req.user.sub, dto);
  }

  @Roles('WORKER')
  @Post('attendance/check-out')
  checkOut(@Req() req: any, @Body() dto: CheckInDto) {
    return this.tasks.checkOut(req.user.sub, dto);
  }

  // 现场主管确认（高风险企业岗位系统自动要求第二名负责人复核）
  @Roles('SUPERVISOR', 'ENTERPRISE')
  @Post('attendance/:id/supervisor-confirm')
  confirm(@Param('id') id: string, @Req() req: any) {
    return this.tasks.supervisorConfirm(req.user, Number(id));
  }

  @Roles('SUPERVISOR', 'ENTERPRISE')
  @Post('assignments/:id/no-show')
  noShow(@Param('id') id: string, @Req() req: any) {
    return this.tasks.markNoShow(req.user, Number(id));
  }

  // 工人出发上报位置（“我在路上”）：企业临时取消时作为交通补贴的距离依据
  @Roles('WORKER')
  @Post('assignments/:id/en-route')
  enRoute(@Param('id') id: string, @Body() dto: { lat: number; lng: number }, @Req() req: any) {
    return this.tasks.enRoute(req.user.sub, Number(id), Number(dto.lat), Number(dto.lng));
  }

  // 现场工作台：主管待确认签到、待处理事件
  @Roles('SUPERVISOR', 'ENTERPRISE')
  @Get('field/board')
  fieldBoard(@Req() req: any) {
    return this.tasks.fieldBoard(req.user.enterpriseId);
  }

  // ---------- 作业过程事件 ----------
  @Roles('WORKER')
  @Post('events')
  report(@Req() req: any, @Body() dto: any) {
    return this.tasks.reportEvent(req.user.sub, dto);
  }

  @Roles('SUPERVISOR', 'ENTERPRISE')
  @Post('events/:id/review')
  reviewEvent(@Param('id') id: string, @Body() dto: { approve: boolean; note?: string }, @Req() req: any) {
    return this.tasks.reviewEvent(req.user, Number(id), !!dto.approve, dto.note);
  }

  // ---------- 任务内聊天 ----------
  @Post('assignments/:id/messages')
  postMessage(@Param('id') id: string, @Body() dto: { content: string }, @Req() req: any) {
    return this.tasks.postMessage(req.user, Number(id), dto.content);
  }
}
