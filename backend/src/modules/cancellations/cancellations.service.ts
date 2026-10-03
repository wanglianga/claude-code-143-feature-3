import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import {
  User, Enterprise, Job, Assignment, AttendanceEvent,
  WorkerLocationPing, CancellationCompensation, CompensationKind,
} from '../../entities';
import { haversineMeters, round2 } from '../../geo';
import {
  CANCEL_NOTICE_TIERS, LOCATION_BUCKET_LABEL,
  ON_SITE_RADIUS_METERS, NEARBY_RADIUS_METERS, EN_ROUTE_MAX_METERS,
  cancelHistoryMultiplier, depositMultiplier,
  ARBITRATION_DEPOSIT_SURCHARGE, ARBITRATION_DEPOSIT_SURCHARGE_CAP,
  RANK_PENALTY, STABILITY_THRESHOLDS,
  WorkerLocationBucket,
} from '../../risk.constants';
import { EnterpriseService } from '../enterprise/enterprise.service';

export interface CancelContext {
  job: Job;
  cancelledAt: Date;
  reason: string;
}

@Injectable()
export class CancellationsService {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Enterprise) private enterprises: Repository<Enterprise>,
    @InjectRepository(Job) private jobs: Repository<Job>,
    @InjectRepository(Assignment) private assignments: Repository<Assignment>,
    @InjectRepository(AttendanceEvent) private attendance: Repository<AttendanceEvent>,
    @InjectRepository(WorkerLocationPing) private pings: Repository<WorkerLocationPing>,
    @InjectRepository(CancellationCompensation) private comps: Repository<CancellationCompensation>,
    private entService: EnterpriseService,
  ) {}

  // ===================== 工人赴岗途中位置上报 =====================
  async reportLocation(workerId: number, assignmentId: number, lat: number, lng: number) {
    const a = await this.assignments.findOne({ where: { id: assignmentId, workerId } });
    if (!a) throw new ForbiddenException('派单不存在或不属于当前工人');
    if (!['ACCEPTED', 'CHECKED_IN'].includes(a.status)) {
      throw new BadRequestException('当前任务状态不能上报赴岗位置（需已被企业录取且未结束）');
    }
    const job = await this.jobs.findOne({ where: { id: a.jobId } });
    if (!job) throw new NotFoundException('岗位不存在');
    const distance = haversineMeters(Number(lat), Number(lng), Number(job.lat), Number(job.lng));
    const bucket = this.bucketOf(distance);
    return this.pings.save(this.pings.create({
      assignmentId: a.id, jobId: job.id, workerId,
      lat, lng, distanceMeters: distance, bucket,
    }));
  }

  async listPings(assignmentId: number) {
    return this.pings.find({ where: { assignmentId }, order: { id: 'ASC' } });
  }

  private bucketOf(distance: number): WorkerLocationBucket {
    if (distance <= ON_SITE_RADIUS_METERS) return 'ON_SITE';
    if (distance <= NEARBY_RADIUS_METERS) return 'NEARBY';
    if (distance <= EN_ROUTE_MAX_METERS) return 'EN_ROUTE';
    return 'AT_HOME';
  }

  // ===================== 取消时生成全员补偿建议（幂等） =====================
  async generateForCancellation(ctx: CancelContext): Promise<CancellationCompensation[]> {
    const { job, cancelledAt } = ctx;
    // 派单在取消流程中可能已被置为 CANCELLED，故同时纳入 CANCELLED（录取后被取消者）；
    // 排除未录取(APPLIED/REJECTED)与爽约(NO_SHOW)。
    const hired = await this.assignments.find({
      where: { jobId: job.id, status: In(['ACCEPTED', 'CHECKED_IN', 'WORKING', 'CANCELLED']) },
    });
    const ent = await this.entService.get(job.enterpriseId);
    const priorLateCancels = Number(ent.lateCancelCompensatedJobs) || 0;
    const created: CancellationCompensation[] = [];

    for (const a of hired) {
      const exists = await this.comps.findOne({ where: { assignmentId: a.id } });
      if (exists) { created.push(exists); continue; }

      const minutesToStart = Math.round((new Date(job.startTime).getTime() - cancelledAt.getTime()) / 60000);
      const tier = this.tierOf(minutesToStart);

      // 事实 1：是否已四重签到
      const checkIn = await this.attendance.findOne({
        where: { assignmentId: a.id, kind: 'CHECK_IN', allPassed: true },
        order: { eventTime: 'ASC' },
      });
      const checkedIn = !!checkIn;

      // 事实 2：取消时点最近一次位置心跳
      const latestPing = await this.pings.findOne({
        where: { assignmentId: a.id }, order: { id: 'DESC' },
      });
      let bucket: WorkerLocationBucket;
      let distance: number | null = null;
      if (checkedIn) {
        bucket = 'ON_SITE';
        distance = checkIn?.distanceMeters ?? 0;
      } else if (latestPing) {
        bucket = latestPing.bucket as WorkerLocationBucket;
        distance = latestPing.distanceMeters;
      } else {
        bucket = 'UNKNOWN';
      }

      const mult = cancelHistoryMultiplier(priorLateCancels);
      const calc = this.computeAmount({ tierKey: tier.key, bucket, dailyWage: Number(job.dailyWage), multiplier: mult });

      // 无需赔付（24h 前取消 / 无赴岗证据）→ 不生成赔付单
      if (calc.total <= 0) continue;

      const breakdown = [
        `【通知时间】取消于 ${cancelledAt.toLocaleString('zh-CN')}，距开工 ${this.fmtMinutes(minutesToStart)} → ${tier.label}`,
        `【工人位置】${LOCATION_BUCKET_LABEL[bucket]}${distance !== null ? `（距签到点 ${distance}m）` : '（无赴岗位置上报）'}`,
        `【签到状态】${checkedIn ? '已完成四重到岗签到（在场事实确凿）' : '尚未完成到岗签到'}`,
        `【历史取消】该企业此前临期取消并赔付 ${priorLateCancels} 次 → 补偿倍率 ×${mult}`,
        `【测算依据】${calc.reason}`,
        `【建议金额】到场补贴 ¥${calc.attendance} + 交通补贴 ¥${calc.transport} = ¥${calc.total}`,
      ].join('\n');

      created.push(await this.comps.save(this.comps.create({
        jobId: job.id,
        assignmentId: a.id,
        workerId: a.workerId,
        enterpriseId: job.enterpriseId,
        cancelledAt,
        minutesToStart,
        noticeTier: tier.key,
        noticeTierLabel: tier.label,
        locationBucket: bucket,
        distanceMeters: distance,
        checkedIn,
        priorLateCancels,
        historyMultiplier: mult,
        kind: calc.kind,
        attendanceAllowance: calc.attendance,
        transportAllowance: calc.transport,
        totalAmount: calc.total,
        ruleBreakdown: breakdown,
        status: 'SUGGESTED',
      })));
    }
    return created;
  }

  private tierOf(minutesToStart: number) {
    const hours = minutesToStart / 60;
    const found = CANCEL_NOTICE_TIERS.find((t) =>
      (t.minHours === null || hours > t.minHours) && (t.maxHours === null || hours <= t.maxHours));
    return found || CANCEL_NOTICE_TIERS[CANCEL_NOTICE_TIERS.length - 1];
  }

  private fmtMinutes(m: number) {
    if (m < 0) return `已开工 ${Math.abs(m)} 分钟`;
    if (m < 60) return `${m} 分钟`;
    return `${(m / 60).toFixed(1)} 小时`;
  }

  private computeAmount(opt: { tierKey: string; bucket: WorkerLocationBucket; dailyWage: number; multiplier: number }) {
    const tier = CANCEL_NOTICE_TIERS.find((t) => t.key === opt.tierKey)!;
    let attendance = 0;
    let transport = 0;
    const reasons: string[] = [];
    const mult = opt.multiplier;

    if (opt.bucket === 'ON_SITE') {
      // 已到场（或已签到）：按通知档领取到场补贴，交通费实报
      attendance = round2(opt.dailyWage * tier.attendanceWageRatio * mult);
      transport = tier.transportAllowance;
      reasons.push(`已到现场：日结 ¥${opt.dailyWage} × ${(tier.attendanceWageRatio * 100).toFixed(0)}% × 历史倍率 ${mult}`);
      if (transport) reasons.push(`已实际赴岗，交通补贴 ¥${tier.transportAllowance}`);
    } else if (opt.bucket === 'NEARBY') {
      // 已到 1km 周边：到场补贴半数，交通补贴全额
      attendance = round2(opt.dailyWage * tier.attendanceWageRatio * 0.5 * mult);
      transport = tier.transportAllowance;
      reasons.push(`已到场周边：到场补贴按 50% 计（日结 × ${(tier.attendanceWageRatio * 100).toFixed(0)}% × 50% × ${mult}）`);
      if (transport) reasons.push(`交通补贴 ¥${tier.transportAllowance}`);
    } else if (opt.bucket === 'EN_ROUTE') {
      transport = tier.transportAllowance;
      reasons.push('已在途中：不享到场补贴，按通知档发放交通补贴');
    }
    // AT_HOME / UNKNOWN：无赴岗事实，不建议赔付

    const kind: CompensationKind = attendance > 0 && transport > 0 ? 'ATTENDANCE_TRANSPORT'
      : attendance > 0 ? 'ATTENDANCE'
        : transport > 0 ? 'TRANSPORT' : 'NONE';
    return {
      attendance: round2(attendance),
      transport: round2(transport),
      total: round2(attendance + transport),
      kind,
      reason: reasons.join('；') || '无赴岗事实，不生成赔付',
    };
  }

  // ===================== 查询 =====================
  private async decorate(c: CancellationCompensation) {
    const worker = await this.users.findOne({ where: { id: c.workerId } });
    const job = await this.jobs.findOne({ where: { id: c.jobId } });
    const pings = await this.pings.find({ where: { assignmentId: c.assignmentId }, order: { id: 'DESC' }, take: 10 });
    return {
      ...c,
      workerName: worker?.name || `#${c.workerId}`,
      workerPhone: worker?.phone,
      jobTitle: job?.title,
      jobLocation: job?.location,
      dailyWage: job?.dailyWage,
      pings,
      locationBucketLabel: LOCATION_BUCKET_LABEL[c.locationBucket as WorkerLocationBucket] || c.locationBucket,
    };
  }

  async listByEnterprise(enterpriseId: number, status?: string) {
    const list = await this.comps.find({
      where: status ? { enterpriseId, status: status as any } : { enterpriseId },
      order: { id: 'DESC' },
    });
    return Promise.all(list.map((c) => this.decorate(c)));
  }

  async listByWorker(workerId: number) {
    const list = await this.comps.find({ where: { workerId }, order: { id: 'DESC' } });
    return Promise.all(list.map((c) => this.decorate(c)));
  }

  async listAll(status?: string) {
    const list = await this.comps.find({
      where: status ? { status: status as any } : {},
      order: { id: 'DESC' },
    });
    return Promise.all(list.map((c) => this.decorate(c)));
  }

  async detail(id: number) {
    const c = await this.comps.findOne({ where: { id } });
    if (!c) throw new NotFoundException('赔付单不存在');
    return this.decorate(c);
  }

  async getOwned(id: number, enterpriseId: number) {
    const c = await this.comps.findOne({ where: { id } });
    if (!c) throw new NotFoundException('赔付单不存在');
    if (c.enterpriseId !== enterpriseId) throw new ForbiddenException();
    return c;
  }

  // ===================== 企业确认支付 → 工人立即收到补贴 =====================
  async confirm(enterpriseAccountUserId: number, enterpriseId: number, id: number, note: string) {
    const c = await this.comps.findOne({ where: { id } });
    if (!c) throw new NotFoundException('赔付单不存在');
    if (c.enterpriseId !== enterpriseId) throw new ForbiddenException();
    if (!['SUGGESTED'].includes(c.status)) throw new BadRequestException('该赔付单已处理');
    const amount = Number(c.totalAmount);
    const ent = await this.entService.get(c.enterpriseId);
    if (Number(ent.depositFrozen) + Number(ent.depositBalance) < amount) {
      throw new BadRequestException(
        `保证金账户余额不足以支付赔付 ¥${amount}（冻结 ¥${ent.depositFrozen} + 可用 ¥${ent.depositBalance}），请先充值`,
      );
    }

    c.status = 'CONFIRMED';
    c.enterpriseDecidedAt = new Date();
    c.enterpriseDecidedBy = enterpriseAccountUserId;
    c.enterpriseNote = note?.trim() || '企业确认平台补偿建议';
    await this.comps.save(c);

    const payout = await this.entService.payoutCompensation(c.enterpriseId, amount);
    void payout;

    // 工人到账 + 平台通知（演示：以时间戳留痕）
    c.status = 'PAID';
    c.paidAt = new Date();
    c.workerNotifiedAt = new Date();
    await this.comps.save(c);

    // 同岗位只计一次临期取消画像/排序罚分
    await this.applyLateCancelConsequencesOnce(c);
    return this.detail(c.id);
  }

  private async applyLateCancelConsequencesOnce(c: CancellationCompensation) {
    if (!['LT_1H', 'H1_2'].includes(c.noticeTier)) return;
    const siblings = await this.comps.find({ where: { jobId: c.jobId } });
    const alreadyCounted = siblings.some((x) => x.id !== c.id && x.rankPenaltyApplied);
    if (alreadyCounted) return;
    const ent = await this.entService.get(c.enterpriseId);
    ent.lateCancelCompensatedJobs = Number(ent.lateCancelCompensatedJobs) + 1;
    ent.rankPenalty = Number(ent.rankPenalty) + RANK_PENALTY.lateCancelConfirmed;
    c.rankPenaltyApplied = true;
    await this.comps.save(c);
    await this.enterprises.save(ent);
    await this.entService.recomputeRisk(c.enterpriseId);
  }

  // ===================== 企业拒绝支付 → 进入仲裁 =====================
  async refuse(enterpriseAccountUserId: number, enterpriseId: number, id: number, note: string) {
    const c = await this.comps.findOne({ where: { id } });
    if (!c) throw new NotFoundException('赔付单不存在');
    if (c.enterpriseId !== enterpriseId) throw new ForbiddenException();
    if (!['SUGGESTED'].includes(c.status)) throw new BadRequestException('该赔付单已处理');
    if (!note?.trim()) throw new BadRequestException('请填写拒付理由（将提交平台仲裁）');
    c.status = 'REFUSED';
    c.enterpriseDecidedAt = new Date();
    c.enterpriseDecidedBy = enterpriseAccountUserId;
    c.enterpriseNote = note.trim();
    await this.comps.save(c);
    c.status = 'ARBITRATION';
    await this.comps.save(c);
    return this.detail(c.id);
  }

  // ===================== 客服仲裁证据包 =====================
  async evidence(id: number) {
    const c = await this.comps.findOne({ where: { id } });
    if (!c) throw new NotFoundException('赔付单不存在');
    const [job, assignment, att, pings] = await Promise.all([
      this.jobs.findOne({ where: { id: c.jobId } }),
      this.assignments.findOne({ where: { id: c.assignmentId } }),
      this.attendance.find({ where: { assignmentId: c.assignmentId }, order: { eventTime: 'ASC' } }),
      this.pings.find({ where: { assignmentId: c.assignmentId }, order: { id: 'ASC' } }),
    ]);
    const ent = await this.enterprises.findOne({ where: { id: c.enterpriseId } });
    return {
      compensation: c,
      locationBucketLabel: LOCATION_BUCKET_LABEL[c.locationBucket as WorkerLocationBucket],
      job,
      assignment,
      attendance: att,
      pings,
      enterprise: ent && {
        id: ent.id, name: ent.name, riskLevel: ent.riskLevel,
        lateCancelCompensatedJobs: ent.lateCancelCompensatedJobs,
        arbitrationLostCount: ent.arbitrationLostCount,
        depositSurchargeRate: Number(ent.depositSurchargeRate),
        rankPenalty: ent.rankPenalty,
      },
    };
  }

  /**
   * 仲裁裁决：
   * - uphold=true  企业无责 → 撤销赔付建议
   * - uphold=false 企业有责 → 按裁决金额从保证金扣付给工人，并联动：
   *     后续发单保证金附加 +0.5 倍（封顶 +1.5）、排序罚分 +8、仲裁败诉计数 +1
   * 后果按岗位只施加一次（同岗位多名工人合并视为一次拒付事件）。
   */
  async arbitrate(supportUserId: number, id: number, opt: { uphold: boolean; award: string; awardedAmount?: number }) {
    const c = await this.comps.findOne({ where: { id } });
    if (!c) throw new NotFoundException('赔付单不存在');
    if (c.status !== 'ARBITRATION') throw new BadRequestException('仅仲裁中的赔付单可裁决');
    if (!opt.award?.trim()) throw new BadRequestException('请填写仲裁裁决依据');

    c.arbitratedBy = supportUserId;
    c.arbitratedAt = new Date();
    c.arbitrationAward = opt.award.trim();

    if (opt.uphold) {
      c.status = 'ARBITRATION_UPHELD';
      await this.comps.save(c);
      return this.detail(c.id);
    }

    const amount = round2(Number(opt.awardedAmount ?? c.totalAmount) || 0);
    if (!(amount > 0)) throw new BadRequestException('裁决赔付金额必须大于 0');
    const ent = await this.entService.get(c.enterpriseId);
    if (Number(ent.depositFrozen) + Number(ent.depositBalance) < amount) {
      throw new BadRequestException('企业保证金账户余额不足以执行裁决，请先督促企业充值');
    }

    c.status = 'ARBITRATION_AWARD_PAY';
    c.awardedAmount = amount;
    await this.comps.save(c);
    await this.entService.payoutCompensation(c.enterpriseId, amount);
    c.paidAt = new Date();
    c.workerNotifiedAt = new Date();
    await this.comps.save(c);

    // 同岗位只施加一次保证金附加 / 排序罚分
    const siblings = await this.comps.find({ where: { jobId: c.jobId } });
    const already = siblings.some((x) => x.id !== c.id && x.surchargeApplied);
    if (!already) {
      const e2 = await this.entService.get(c.enterpriseId);
      e2.arbitrationLostCount = Number(e2.arbitrationLostCount) + 1;
      e2.depositSurchargeRate = Math.min(
        ARBITRATION_DEPOSIT_SURCHARGE_CAP,
        round2(Number(e2.depositSurchargeRate) + ARBITRATION_DEPOSIT_SURCHARGE),
      );
      e2.rankPenalty = Number(e2.rankPenalty) + RANK_PENALTY.refusedThenLost;
      c.surchargeApplied = true;
      c.rankPenaltyApplied = true;
      await this.comps.save(c);
      await this.enterprises.save(e2);
      await this.entService.recomputeRisk(c.enterpriseId);
    } else {
      c.surchargeApplied = true;
      c.rankPenaltyApplied = true;
      await this.comps.save(c);
    }
    return this.detail(c.id);
  }

  // ===================== 工人报名时可见的企业近期稳定性 =====================
  async stabilityOfEnterprise(enterpriseId: number) {
    const finished = await this.jobs.find({
      where: { enterpriseId, status: In(['COMPLETED', 'CANCELLED']) },
      order: { id: 'DESC' },
      take: STABILITY_THRESHOLDS.windowSize,
    });
    const window = STABILITY_THRESHOLDS.windowSize;
    const cancelled = finished.filter((j) => j.status === 'CANCELLED').length;
    const cancelRate = finished.length ? cancelled / finished.length : 0;

    const jobIds = finished.map((j) => j.id);
    let refusedLost = 0;
    if (jobIds.length) {
      const recentComps = await this.comps.find({ where: { jobId: In(jobIds) } });
      refusedLost = new Set(
        recentComps.filter((c) => c.surchargeApplied).map((c) => c.jobId),
      ).size;
    }

    const ent = await this.enterprises.findOne({ where: { id: enterpriseId } });
    const depositMult = ent
      ? round2(depositMultiplier(ent.riskLevel) + Number(ent.depositSurchargeRate || 0))
      : 1;

    let level: 'STABLE' | 'WATCH' | 'UNSTABLE' = 'STABLE';
    // 拒付败诉属严重事实，不受样本量限制直接判不稳定；纯取消率需 ≥3 单样本避免小样本失真
    if (refusedLost >= STABILITY_THRESHOLDS.watchRefused) level = 'UNSTABLE';
    else if (finished.length >= 3 && cancelRate >= 0.3) level = 'UNSTABLE';
    else if (finished.length >= 3 && cancelRate >= STABILITY_THRESHOLDS.watchCancelRate) level = 'WATCH';

    const tips: string[] = [];
    if (finished.length >= 3 && cancelRate >= STABILITY_THRESHOLDS.watchCancelRate) {
      tips.push(`近 ${finished.length} 单取消率 ${(cancelRate * 100).toFixed(0)}%（平台警戒线 15%）`);
    }
    if (refusedLost > 0) tips.push(`近期 ${refusedLost} 次临时取消拒付经仲裁败诉，发单排序已被降权`);
    if (ent && Number(ent.depositSurchargeRate) > 0) {
      tips.push(`该企业保证金已被平台附加 +${Number(ent.depositSurchargeRate).toFixed(1)} 倍`);
    }
    if (level === 'STABLE') tips.push('近期发单稳定，无临期取消赔付记录');

    // 排序模型分数（越高越靠前）：风险等级 + 取消率 + 平台罚分
    const rankScore = Math.round(
      -((ent?.riskLevel ?? 1) - 1) * 3 - cancelRate * 20 - (Number(ent?.rankPenalty) || 0),
    );

    return {
      windowSize: window,
      sampleSize: finished.length,
      cancelled,
      cancelRate: Math.round(cancelRate * 10000) / 10000,
      refusedLost,
      level,
      tips,
      rankScore,
      depositMultiplier: depositMult,
    };
  }
}
