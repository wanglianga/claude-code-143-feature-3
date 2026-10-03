import {
  Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard, Roles, RoleGuard } from '../auth/auth.guard';
import { CompensationService } from './compensation.service';

@Controller('api')
@UseGuards(AuthGuard, RoleGuard)
export class CompensationController {
  constructor(private comps: CompensationService) {}

  // ---------- 企业 ----------
  @Roles('ENTERPRISE', 'SUPERVISOR', 'SUPPORT')
  @Get('jobs/:id/compensations')
  listForJob(@Param('id') id: string) {
    return this.comps.listForJob(Number(id));
  }

  @Roles('ENTERPRISE')
  @Get('enterprise/compensations')
  listForEnterprise(@Req() req: any) {
    return this.comps.listForEnterprise(req.user.enterpriseId);
  }

  @Roles('ENTERPRISE')
  @Post('jobs/:id/compensations/confirm')
  confirm(@Param('id') id: string, @Req() req: any) {
    return this.comps.confirmAndPay(Number(id), req.user.enterpriseId);
  }

  @Roles('ENTERPRISE')
  @Post('jobs/:id/compensations/reject')
  reject(@Param('id') id: string, @Body() dto: { reason?: string }, @Req() req: any) {
    return this.comps.reject(Number(id), req.user.enterpriseId, dto.reason || '');
  }

  // ---------- 工人 ----------
  @Roles('WORKER')
  @Get('my/compensations')
  mine(@Req() req: any) {
    return this.comps.listForWorker(req.user.sub);
  }

  // ---------- 客服仲裁 ----------
  @Roles('SUPPORT')
  @Get('support/compensations')
  arbitrationQueue() {
    return this.comps.listArbitration();
  }

  @Roles('SUPPORT')
  @Post('support/jobs/:id/compensations/arbitrate')
  arbitrate(
    @Param('id') id: string,
    @Body() dto: { decision: 'PAY' | 'WAIVE'; note: string; items?: { id: number; amount: number }[] },
    @Req() req: any,
  ) {
    if (!['PAY', 'WAIVE'].includes(dto.decision)) throw new ForbiddenException('裁决类型必须为 PAY 或 WAIVE');
    return this.comps.arbitrate(req.user.sub, Number(id), dto);
  }
}
