import {
  Body, Controller, Get, Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard, Roles, RoleGuard } from '../auth/auth.guard';
import { CancellationsService } from './cancellations.service';

@Controller('api')
@UseGuards(AuthGuard, RoleGuard)
export class CancellationsController {
  constructor(private svc: CancellationsService) {}

  // ---------- 工人：赴岗途中位置上报 / 我的取消补贴 ----------
  @Roles('WORKER')
  @Post('assignments/:id/location')
  reportLocation(@Param('id') id: string, @Body() dto: { lat: number; lng: number }, @Req() req: any) {
    return this.svc.reportLocation(req.user.sub, Number(id), Number(dto.lat), Number(dto.lng));
  }

  @Roles('WORKER')
  @Get('my/compensations')
  mine(@Req() req: any) {
    return this.svc.listByWorker(req.user.sub);
  }

  // 任务室聚合位置轨迹（参与方均可见）
  @Get('assignments/:id/locations')
  locations(@Param('id') id: string) {
    return this.svc.listPings(Number(id));
  }

  // ---------- 企业：取消赔付建议处理 ----------
  @Roles('ENTERPRISE')
  @Get('enterprise/compensations')
  listMine(@Query('status') status: string | undefined, @Req() req: any) {
    return this.svc.listByEnterprise(req.user.enterpriseId, status);
  }

  @Roles('ENTERPRISE')
  @Post('compensations/:id/confirm')
  confirm(@Param('id') id: string, @Body() dto: { note?: string }, @Req() req: any) {
    return this.svc.confirm(req.user.sub, req.user.enterpriseId, Number(id), dto.note || '');
  }

  @Roles('ENTERPRISE')
  @Post('compensations/:id/refuse')
  refuse(@Param('id') id: string, @Body() dto: { note: string }, @Req() req: any) {
    return this.svc.refuse(req.user.sub, req.user.enterpriseId, Number(id), dto.note);
  }

  // ---------- 客服：取消赔付仲裁 ----------
  @Roles('SUPPORT')
  @Get('support/compensations')
  listAll(@Query('status') status?: string) {
    return this.svc.listAll(status);
  }

  @Roles('SUPPORT')
  @Get('support/compensations/:id/evidence')
  evidence(@Param('id') id: string) {
    return this.svc.evidence(Number(id));
  }

  @Roles('SUPPORT')
  @Post('support/compensations/:id/arbitrate')
  arbitrate(
    @Param('id') id: string,
    @Body() dto: { uphold: boolean; award: string; awardedAmount?: number },
    @Req() req: any,
  ) {
    return this.svc.arbitrate(req.user.sub, Number(id), {
      uphold: !!dto.uphold, award: dto.award, awardedAmount: dto.awardedAmount,
    });
  }
}
