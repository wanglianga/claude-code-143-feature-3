import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import {
  CancelCompensation, Job, Assignment, User, Enterprise, AttendanceEvent,
} from '../../entities';
import { CANCEL_COMP_RULES, RANKING } from '../../risk.constants';
import { round2 } from '../../geo';
import { EnterpriseService } from '../enterprise/enterprise.service';

export interface StabilityInfo {
  recentWindowDays: number;
  recentJobs: number;
  recentCancelled: number;
  recentCancelRate: number;
  cancelRate: number; // 累计取消率（进入排序模型）
  compRefusals: number; // 取消赔付拒付次数
  level: 'STABLE' | 'CAUTION' | 'RISKY';
  hint: string;
}

@Injectable()
export class CompensationService {
  constructor(
    @InjectRepository(CancelCompensation) private comps: Repository<CancelCompensation>,
    @InjectRepository(Job) private jobs: Repository<Job>,
    @InjectRepository(Assignment) private assignments: Repository<Assignment>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Enterprise) private enterprises: Repository<Enterprise>,
    @InjectRepository(AttendanceEvent) private attendance: Repository<AttendanceEvent>,
    private entService: EnterpriseService,
  ) {}

  // ===================== 取消时生成补偿建议 =====================
  /**
   * 依据：通知时间（距开工分钟）、工人位置（出发上报距离）、是否已签到、历史取消规则。
   * 必须在受影响派单状态被改写为 CANCELLED 之前调用（需要原始到岗状态）。
   */
  async generateForJob(job: Job, affected: Assignment[]): Promise<CancelCompensation[]> {
    const ent = await this.entService.get(job.enterpriseId);
    const now = job.cancelledAt ? new Date(job.cancelledAt) : new Date();
    const minutesToStart = Math.round((new Date(job.startTime).getTime() - now.getTime()) / 60000);
    const dailyWage = Number(job.dailyWage);
    const cap = round2(dailyWage * CANCEL_COMP_RULES.maxRateOfDailyWage);
    const highCancel = Number(ent.cancelRate) >= CANCEL_COMP_RULES.highCancelRate.threshold;
    const created: CancelCompensation[] = [];

    for (const a of affected) {
      const exists = await this.comps.findOne({ where: { assignmentId: a.id } });
      if (exists) { created.push(exists); continue; } // 幂等：同一派单只生成一次

      // 工人行程状态：已签到 > 在路上（4 小时内有出发上报）> 未出发
      let workerState: 'CHECKED_IN' | 'ON_THE_WAY' | 'NOT_DEPARTED' = 'NOT_DEPARTED';
      let distanceMeters: number | null = null;
      if (['CHECKED_IN', 'WORKING'].includes(a.status)) {
        workerState = 'CHECKED_IN';
      } else {
        const since = new Date(now.getTime() - CANCEL_COMP_RULES.enRouteWindowHours * 3600000);
        const report = await this.attendance
          .createQueryBuilder('e')
          .where('e.assignmentId = :aid AND e.kind = :kind AND e.eventTime >= :since', { aid: a.id, kind: 'EN_ROUTE', since })
          .orderBy('e.eventTime', 'DESC')
          .getOne();
        if (report) {
          workerState = 'ON_THE_WAY';
          distanceMeters = report.distanceMeters;
        }
      }

      // 规则计算
      let kind: 'ATTENDANCE' | 'TRANSPORT' | 'NONE' = 'NONE';
      let amount = 0;
      const factors: string[] = [
        `通知时间：距开工 ${minutesToStart} 分钟${minutesToStart < 0 ? '（已开工后取消）' : ''}`,
      ];
      if (workerState === 'CHECKED_IN') {
        kind = 'ATTENDANCE';
        const tier = CANCEL_COMP_RULES.attendanceTiers.find((t) => minutesToStart <= t.maxMinutesToStart)!;
        amount = round2(dailyWage * tier.rate);
        factors.push(`工人状态：已签到到场 → 到场补贴（${tier.label}，日结工资 ${dailyWage} 元 × ${tier.rate * 100}%）`);
      } else if (workerState === 'ON_THE_WAY') {
        kind = 'TRANSPORT';
        const km = (distanceMeters ?? 0) / 1000;
        const tier = CANCEL_COMP_RULES.transportTiers.find((t) => km <= t.maxKm)!;
        amount = tier.amount;
        factors.push(`工人状态：已出发在路上，距岗位 ${(Math.round(km * 10) / 10)}km（${tier.label} 档 ${tier.amount} 元）→ 交通补贴`);
        if (minutesToStart <= CANCEL_COMP_RULES.lateNotice.minutesToStart) {
          amount = round2(amount * CANCEL_COMP_RULES.lateNotice.transportMultiplier);
          factors.push(`临近开工通知（≤${CANCEL_COMP_RULES.lateNotice.minutesToStart} 分钟），交通补贴上浮 ${Math.round((CANCEL_COMP_RULES.lateNotice.transportMultiplier - 1) * 100)}%`);
        }
      } else {
        factors.push('工人状态：未出发（取消前 4 小时内无位置上报）→ 无需补偿');
      }
      if (amount > 0 && highCancel) {
        amount = round2(amount * CANCEL_COMP_RULES.highCancelRate.multiplier);
        factors.push(`企业历史取消率 ${(Number(ent.cancelRate) * 100).toFixed(0)}% ≥ ${CANCEL_COMP_RULES.highCancelRate.threshold * 100}%，建议赔付上浮 ${Math.round((CANCEL_COMP_RULES.highCancelRate.multiplier - 1) * 100)}%（历史取消规则）`);
      }
      if (amount > cap) {
        amount = cap;
        factors.push(`触达单人补贴上限（日结工资 × ${CANCEL_COMP_RULES.maxRateOfDailyWage * 100}% = ${cap} 元）`);
      }

      const comp = this.comps.create({
        jobId: job.id,
        assignmentId: a.id,
        workerId: a.workerId,
        enterpriseId: job.enterpriseId,
        kind,
        workerState,
        distanceMeters,
        minutesToStart,
        suggestedAmount: amount,
        finalAmount: null,
        ruleSnapshot: factors.join('；'),
        status: kind === 'NONE' ? 'NONE_REQUIRED' : 'SUGGESTED',
      });
      created.push(await this.comps.save(comp));
    }
    return created;
  }

  // ===================== 查询 =====================
  private async withWorkerNames(list: CancelCompensation[]) {
    if (!list.length) return [];
    const workers = await this.users.find({ where: { id: In([...new Set(list.map((c) => c.workerId))] as number[]) } });
    const map = new Map(workers.map((w) => [w.id, w.name]));
    return list.map((c) => ({ ...c, workerName: map.get(c.workerId) || `#${c.workerId}` }));
  }

  async listForJob(jobId: number) {
    const list = await this.comps.find({ where: { jobId }, order: { id: 'ASC' } });
    return this.withWorkerNames(list);
  }

  /** 企业端：按岗位聚合全部取消赔付单 */
  async listForEnterprise(enterpriseId: number) {
    const list = await this.comps.find({ where: { enterpriseId }, order: { id: 'DESC' } });
    const jobIds = [...new Set(list.map((c) => c.jobId))];
    const jobs = jobIds.length ? await this.jobs.find({ where: { id: In(jobIds) } }) : [];
    const jMap = new Map(jobs.map((j) => [j.id, j]));
    const named = await this.withWorkerNames(list);
    const byJob = new Map<number, any>();
    for (const c of named) {
      if (!byJob.has(c.jobId)) {
        const j = jMap.get(c.jobId);
        byJob.set(c.jobId, {
          jobId: c.jobId,
          jobTitle: j?.title || `岗位 #${c.jobId}`,
          jobStatus: j?.status,
          startTime: j?.startTime,
          cancelledAt: j?.cancelledAt,
          cancelReason: j?.cancelReason,
          dailyWage: j ? Number(j.dailyWage) : 0,
          items: [],
          totalSuggested: 0,
          totalFinal: 0,
          status: 'NONE_REQUIRED',
        });
      }
      const g = byJob.get(c.jobId);
      g.items.push(c);
      g.totalSuggested = round2(g.totalSuggested + Number(c.suggestedAmount));
      g.totalFinal = round2(g.totalFinal + Number(c.finalAmount ?? 0));
    }
    for (const g of byJob.values()) {
      const sts = g.items.map((i: any) => i.status as string);
      if (sts.includes('SUGGESTED')) g.status = 'SUGGESTED';
      else if (sts.includes('ARBITRATION')) g.status = 'ARBITRATION';
      else if (sts.some((s: string) => s === 'PAID')) g.status = 'PAID';
      else if (sts.some((s: string) => s === 'ARBITRATED_PAID')) g.status = 'ARBITRATED_PAID';
      else if (sts.some((s: string) => s === 'ARBITRATED_WAIVED')) g.status = 'ARBITRATED_WAIVED';
    }
    return [...byJob.values()];
  }

  async listForWorker(workerId: number) {
    const list = await this.comps.find({ where: { workerId }, order: { id: 'DESC' } });
    const jobIds = [...new Set(list.map((c) => c.jobId))];
    const jobs = jobIds.length ? await this.jobs.find({ where: { id: In(jobIds) } }) : [];
    const jMap = new Map(jobs.map((j) => [j.id, j]));
    return list.map((c) => ({
      ...c,
      jobTitle: jMap.get(c.jobId)?.title || `岗位 #${c.jobId}`,
      jobStartTime: jMap.get(c.jobId)?.startTime,
      cancelReason: jMap.get(c.jobId)?.cancelReason,
    }));
  }

  /** 客服仲裁队列：有赔付单处于 ARBITRATION 的岗位 */
  async listArbitration() {
    const pending = await this.comps.find({ where: { status: 'ARBITRATION' }, order: { id: 'ASC' } });
    const jobIds = [...new Set(pending.map((c) => c.jobId))];
    if (!jobIds.length) return [];
    const jobs = await this.jobs.find({ where: { id: In(jobIds) } });
    const ents = await this.enterprises.find({ where: { id: In(jobs.map((j) => j.enterpriseId)) } });
    const eMap = new Map(ents.map((e) => [e.id, e]));
    const result = [];
    for (const j of jobs) {
      const items = await this.listForJob(j.id);
      const ent = eMap.get(j.enterpriseId);
      result.push({
        job: j,
        enterprise: ent && {
          id: ent.id, name: ent.name, riskLevel: ent.riskLevel,
          cancelRate: Number(ent.cancelRate), compRefusals: ent.compRefusals,
          depositBalance: Number(ent.depositBalance), depositFrozen: Number(ent.depositFrozen),
        },
        items,
        totalSuggested: round2(items.reduce((s, c) => s + Number(c.suggestedAmount), 0)),
      });
    }
    return result;
  }

  // ===================== 企业确认并支付 =====================
  async confirmAndPay(jobId: number, enterpriseId: number) {
    const job = await this.jobs.findOne({ where: { id: jobId } });
    if (!job || job.enterpriseId !== enterpriseId) throw new ForbiddenException('岗位不存在或不属于本企业');
    const pending = await this.comps.find({ where: { jobId, status: 'SUGGESTED' } });
    if (!pending.length) throw new BadRequestException('该岗位没有待确认的补偿建议');

    const total = round2(pending.reduce((s, c) => s + Number(c.suggestedAmount), 0));
    // 从企业保证金可用余额扣款（不足则提示先充值）
    await this.entService.payFromBalance(enterpriseId, total, `取消赔付（岗位 #${jobId}）`);

    const now = new Date();
    for (const c of pending) {
      c.status = 'PAID';
      c.finalAmount = Number(c.suggestedAmount);
      c.respondedAt = now;
      c.paidAt = now;
      await this.comps.save(c);
      await this.creditWorker(c.workerId, Number(c.finalAmount));
    }
    return { paid: pending.length, total, message: `已确认并支付 ${pending.length} 笔取消赔付，合计 ¥${total}` };
  }

  // ===================== 企业拒绝支付 → 进入仲裁 =====================
  async reject(jobId: number, enterpriseId: number, reason: string) {
    const job = await this.jobs.findOne({ where: { id: jobId } });
    if (!job || job.enterpriseId !== enterpriseId) throw new ForbiddenException('岗位不存在或不属于本企业');
    if (!reason?.trim()) throw new BadRequestException('拒绝支付必须填写理由，案件将进入平台仲裁');
    const pending = await this.comps.find({ where: { jobId, status: 'SUGGESTED' } });
    if (!pending.length) throw new BadRequestException('该岗位没有待确认的补偿建议');

    const now = new Date();
    for (const c of pending) {
      c.status = 'ARBITRATION';
      c.rejectReason = reason.trim();
      c.respondedAt = now;
      await this.comps.save(c);
    }
    // 拒付行为本身即影响企业后续发单保证金（风险等级↑→倍率↑）与排序分
    const ent = await this.entService.get(enterpriseId);
    ent.compRefusals += 1;
    await this.enterprises.save(ent);
    await this.entService.recomputeRisk(enterpriseId);
    return {
      arbitrated: pending.length,
      message: `已拒绝支付 ${pending.length} 笔补偿，订单进入平台仲裁；拒付记录已计入企业风险画像与排序模型`,
    };
  }

  // ===================== 客服仲裁裁决 =====================
  async arbitrate(
    supportUserId: number,
    jobId: number,
    dto: { decision: 'PAY' | 'WAIVE'; note: string; items?: { id: number; amount: number }[] },
  ) {
    if (!dto.note?.trim()) throw new BadRequestException('请填写仲裁裁决依据');
    const pending = await this.comps.find({ where: { jobId, status: 'ARBITRATION' } });
    if (!pending.length) throw new BadRequestException('该岗位没有仲裁中的赔付单');
    const job = await this.jobs.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException('岗位不存在');

    const now = new Date();
    if (dto.decision === 'WAIVE') {
      for (const c of pending) {
        c.status = 'ARBITRATED_WAIVED';
        c.finalAmount = 0;
        c.decidedBy = supportUserId;
        c.decidedAt = now;
        c.decisionNote = dto.note.trim();
        await this.comps.save(c);
      }
      return { waived: pending.length, message: `仲裁豁免：企业无需支付 ${pending.length} 笔补偿` };
    }

    // 判付：可按单调整金额（默认按建议金额）
    const overrides = new Map((dto.items || []).map((i) => [Number(i.id), Number(i.amount)]));
    let total = 0;
    for (const c of pending) {
      const amount = overrides.has(c.id) ? Math.max(0, overrides.get(c.id)!) : Number(c.suggestedAmount);
      c.finalAmount = round2(amount);
      total = round2(total + c.finalAmount);
    }
    // 平台强制划扣：先从可用余额扣，不足部分从冻结保证金扣
    const deducted = await this.entService.forceDeduct(job.enterpriseId, total);

    for (const c of pending) {
      c.status = 'ARBITRATED_PAID';
      c.decidedBy = supportUserId;
      c.decidedAt = now;
      c.decisionNote = dto.note.trim();
      c.paidAt = now;
      await this.comps.save(c);
      await this.creditWorker(c.workerId, Number(c.finalAmount));
    }
    // 仲裁判付 = 企业有责，计入有责争议（影响风险等级与排序）
    const ent = await this.entService.get(job.enterpriseId);
    ent.lostDisputes += 1;
    await this.enterprises.save(ent);
    await this.entService.recomputeRisk(job.enterpriseId);

    return {
      paid: pending.length,
      total,
      deducted,
      message: `仲裁判付 ${pending.length} 笔合计 ¥${total}（可用余额扣 ¥${deducted.fromBalance}，冻结保证金划扣 ¥${deducted.fromFrozen}），已计入企业有责争议`,
    };
  }

  private async creditWorker(workerId: number, amount: number) {
    if (!(amount > 0)) return;
    const w = await this.users.findOne({ where: { id: workerId } });
    if (!w) return;
    w.walletBalance = round2(Number(w.walletBalance) + amount);
    await this.users.save(w);
  }

  // ===================== 企业近期稳定性（工人端提示）与排序模型 =====================
  async stabilityFor(enterpriseIds: number[]): Promise<Map<number, StabilityInfo>> {
    const result = new Map<number, StabilityInfo>();
    if (!enterpriseIds.length) return result;
    const ents = await this.enterprises.find({ where: { id: In(enterpriseIds) } });
    const since = new Date(Date.now() - RANKING.recentWindowDays * 86400000);
    const recentJobs = await this.jobs.createQueryBuilder('j')
      .where('j.enterpriseId IN (:...ids)', { ids: enterpriseIds })
      .andWhere('j.createdAt >= :since', { since })
      .getMany();

    for (const ent of ents) {
      const mine = recentJobs.filter((j) => j.enterpriseId === ent.id);
      const cancelled = mine.filter((j) => j.status === 'CANCELLED').length;
      const rate = mine.length ? cancelled / mine.length : 0;
      const level: StabilityInfo['level'] =
        cancelled === 0 ? 'STABLE' : rate >= RANKING.cautionCancelRate ? 'RISKY' : 'CAUTION';
      const hint = cancelled === 0
        ? `近 ${RANKING.recentWindowDays} 天 ${mine.length} 单无取消记录，用工稳定`
        : `近 ${RANKING.recentWindowDays} 天取消 ${cancelled}/${mine.length} 单（${(rate * 100).toFixed(0)}%），${level === 'RISKY' ? '取消频繁，报名请谨慎' : '偶有取消，请留意岗位动态'}`;
      result.set(ent.id, {
        recentWindowDays: RANKING.recentWindowDays,
        recentJobs: mine.length,
        recentCancelled: cancelled,
        recentCancelRate: Math.round(rate * 1000) / 1000,
        cancelRate: Number(ent.cancelRate),
        compRefusals: ent.compRefusals,
        level,
        hint: ent.compRefusals > 0 ? `${hint}；有 ${ent.compRefusals} 次取消赔付拒付记录` : hint,
      });
    }
    return result;
  }

  /** 排序模型：取消率 + 拒付记录 + 风险等级 → 岗位大厅排序分（越高越靠前） */
  rankScore(ent: Enterprise): number {
    const score = 100
      - Number(ent.cancelRate) * RANKING.cancelRateWeight
      - Math.min(30, ent.compRefusals * RANKING.refusalPenalty)
      - (ent.riskLevel - 1) * RANKING.riskLevelPenalty;
    return Math.round(score * 10) / 10;
  }
}
