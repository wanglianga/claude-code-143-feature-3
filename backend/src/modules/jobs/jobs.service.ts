import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import {
  User, Enterprise, Job, Assignment, Review, AttendanceEvent, Settlement, InsurancePolicy,
} from '../../entities';
import { IndustryKey, INDUSTRIES, depositMultiplierWithSurcharge, strictConfirmationRequired } from '../../risk.constants';
import { EnterpriseService } from '../enterprise/enterprise.service';
import { TasksService } from '../tasks/tasks.service';
import { CancellationsService } from '../cancellations/cancellations.service';

export class CreateJobDto {
  title: string;
  industry: IndustryKey;
  description: string;
  location: string;
  lat?: number;
  lng?: number;
  startTime: string;
  endTime: string;
  headcount: number;
  skillRequirement: string;
  requireHealthCert?: boolean;
  dressCode?: string;
  dailyWage: number;
  overtimeRate?: number;
  mealAllowance?: number;
  lateDeductPerMin?: number;
  lateGraceMinutes?: number;
  insuranceCoverageWan?: number;
  settlementMethod?: string;
  platformFeeRate?: number;
}

@Injectable()
export class JobsService {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Enterprise) private enterprises: Repository<Enterprise>,
    @InjectRepository(Job) private jobs: Repository<Job>,
    @InjectRepository(Assignment) private assignments: Repository<Assignment>,
    @InjectRepository(Review) private reviews: Repository<Review>,
    @InjectRepository(AttendanceEvent) private attendance: Repository<AttendanceEvent>,
    @InjectRepository(Settlement) private settlements: Repository<Settlement>,
    @InjectRepository(InsurancePolicy) private policies: Repository<InsurancePolicy>,
    private entService: EnterpriseService,
    private tasksService: TasksService,
    private cancellations: CancellationsService,
  ) {}

  /** 企业发单：按行业风险与企业风险等级计算保证金，发单时冻结 */
  async createJob(enterpriseId: number, dto: CreateJobDto): Promise<Job> {
    const industry = INDUSTRIES[dto.industry];
    if (!industry) throw new BadRequestException('未知行业类型');
    const ent = await this.entService.get(enterpriseId);

    const start = new Date(dto.startTime);
    const end = new Date(dto.endTime);
    if (!(start < end)) throw new BadRequestException('结束时间必须晚于开始时间');
    if (!dto.headcount || dto.headcount < 1) throw new BadRequestException('招聘人数至少为 1');
    if (!(Number(dto.dailyWage) > 0)) throw new BadRequestException('日结工资必须大于 0');

    // 保证金倍率 = 企业风险等级倍率 + 取消赔付仲裁败诉附加倍率
    const multiplier = depositMultiplierWithSurcharge(ent.riskLevel, Number(ent.depositSurchargeRate || 0));
    const depositRequired = Math.round(industry.baseDeposit * multiplier * dto.headcount);
    const strict = strictConfirmationRequired(ent.riskLevel);

    // 事务性冻结保证金
    await this.entService.freezeForJob(enterpriseId, depositRequired);

    const premium = Math.round(Number(dto.dailyWage) * industry.insuranceRate * 100) / 100;

    const job = this.jobs.create({
      enterpriseId,
      title: dto.title,
      industry: dto.industry,
      description: dto.description,
      location: dto.location,
      lat: dto.lat ?? 31.2304,
      lng: dto.lng ?? 121.4737,
      startTime: start,
      endTime: end,
      headcount: dto.headcount,
      skillRequirement: dto.skillRequirement || '无特殊要求',
      requireHealthCert: dto.requireHealthCert ?? industry.healthCertRequired,
      dressCode: dto.dressCode || null,
      dailyWage: dto.dailyWage,
      overtimeRate: dto.overtimeRate ?? 25,
      mealAllowance: dto.mealAllowance ?? 0,
      lateDeductPerMin: dto.lateDeductPerMin ?? 1,
      lateGraceMinutes: dto.lateGraceMinutes ?? 5,
      insuranceCoverageWan: dto.insuranceCoverageWan ?? 30,
      insurancePremium: premium,
      settlementMethod: dto.settlementMethod || '日结-完工24小时内',
      platformFeeRate: dto.platformFeeRate ?? 0.08,
      status: 'OPEN',
      depositRequired,
      depositPaid: true,
      strictConfirmation: strict,
      prepayment: 0,
    });
    const saved = await this.jobs.save(job);

    ent.totalJobs += 1;
    await this.enterprises.save(ent);
    await this.entService.recomputeRisk(enterpriseId);
    return saved;
  }

  async listOpen(filter: { industry?: string; q?: string }) {
    const qb = this.jobs.createQueryBuilder('job')
      .where('job.status IN (:...s)', { s: ['OPEN', 'FULL', 'IN_PROGRESS'] })
      .orderBy('job.startTime', 'ASC');
    if (filter.industry) qb.andWhere('job.industry = :ind', { ind: filter.industry });
    if (filter.q) qb.andWhere('(job.title LIKE :q OR job.location LIKE :q)', { q: `%${filter.q}%` });
    const jobs = await qb.getMany();
    const ents = await this.enterprises.find();
    const entMap = new Map(ents.map((e) => [e.id, e]));
    // 排序模型：按企业近期稳定性预取稳定性画像（每个企业只算一次）
    const stabMap = new Map<number, any>();
    await Promise.all(ents.map(async (e) => {
      stabMap.set(e.id, await this.cancellations.stabilityOfEnterprise(e.id));
    }));
    const decorated = jobs.map((j) => this.decorateJob(j, entMap.get(j.enterpriseId), stabMap.get(j.enterpriseId)));
    // 稳定性分数降序（稳定企业靠前），同分按开工时间升序
    decorated.sort((a, b) =>
      (b.stability?.rankScore ?? 0) - (a.stability?.rankScore ?? 0) ||
      new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    return decorated;
  }

  async listByEnterprise(enterpriseId: number) {
    const jobs = await this.jobs.find({ where: { enterpriseId }, order: { id: 'DESC' } });
    const counts = await this.assignments.createQueryBuilder('a')
      .select('a.jobId', 'jobId')
      .addSelect('SUM(CASE WHEN a.status IN (:...s) THEN 1 ELSE 0 END)', 'checkedIn')
      .setParameter('s', ['CHECKED_IN', 'WORKING', 'COMPLETED'])
      .groupBy('a.jobId')
      .getRawMany<{ jobId: number; checkedIn: string }>();
    const map = new Map(counts.map((c) => [Number(c.jobId), Number(c.checkedIn)]));
    return jobs.map((j) => ({ ...j, appliedCount: undefined, checkedInCount: map.get(j.id) || 0 }));
  }

  async detail(jobId: number, viewerId?: number) {
    const job = await this.jobs.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException('岗位不存在');
    const ent = await this.enterprises.findOne({ where: { id: job.enterpriseId } });
    const stability = await this.cancellations.stabilityOfEnterprise(job.enterpriseId);
    const base = this.decorateJob(job, ent, stability);
    const accepted = await this.assignments.find({ where: { jobId, status: 'ACCEPTED' } });
    const workers = await Promise.all(accepted.map((a) => this.workerCard(a.workerId)));
    let myApplication: Assignment | null = null;
    if (viewerId) myApplication = await this.assignments.findOne({ where: { jobId, workerId: viewerId } }) || null;
    return { ...base, acceptedWorkers: workers, myApplication };
  }

  // ---- 工人报名：实名 / 资质（健康证）/ 历史评价 / 风险告知 四道门禁 ----
  async apply(workerId: number, jobId: number, riskAcknowledged: boolean) {
    const worker = await this.users.findOne({ where: { id: workerId } });
    if (!worker || worker.role !== 'WORKER') throw new ForbiddenException('仅工人账号可报名');
    const job = await this.jobs.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException('岗位不存在');
    if (!['OPEN'].includes(job.status)) throw new BadRequestException('该岗位已停止招募');

    const acceptedCount = await this.assignments.count({ where: { jobId, status: 'ACCEPTED' } });
    if (acceptedCount >= job.headcount) throw new BadRequestException('该岗位名额已满');

    const existing = await this.assignments.findOne({ where: { jobId, workerId } });
    if (existing && existing.status !== 'REJECTED') throw new BadRequestException('您已报名该岗位，请勿重复报名');

    const gates: { key: string; label: string; passed: boolean }[] = [];
    gates.push({ key: 'REALNAME', label: '实名认证', passed: !!worker.idVerifiedAt });
    const healthOk = !job.requireHealthCert ||
      (!!worker.healthCertUntil && new Date(worker.healthCertUntil) >= new Date(job.startTime));
    gates.push({ key: 'HEALTH_CERT', label: `健康证${job.requireHealthCert ? '（岗位强制要求）' : ''}`, passed: healthOk });
    const stats = await this.workerRating(workerId);
    gates.push({ key: 'RATING', label: `历史评价 ≥ 3.0（当前 ${stats.avgRating.toFixed(1)}，爽约 ${stats.noShowCount} 次）`, passed: stats.avgRating >= 3 && stats.noShowCount < 3 });
    gates.push({ key: 'RISK_NOTICE', label: '风险告知已阅读并确认', passed: !!riskAcknowledged });

    const failed = gates.filter((g) => !g.passed);
    if (failed.length) {
      throw new BadRequestException(`报名门禁未通过：${failed.map((f) => f.label).join('、')}`);
    }

    if (existing && existing.status === 'REJECTED') {
      existing.status = 'APPLIED';
      existing.riskAcknowledged = true;
      existing.appliedAt = new Date();
      existing.ratingSnapshot = stats.avgRating;
      existing.completedJobsCount = stats.completedCount;
      return this.assignments.save(existing);
    }

    return this.assignments.save(this.assignments.create({
      jobId,
      workerId,
      status: 'APPLIED',
      riskAcknowledged: true,
      appliedAt: new Date(),
      ratingSnapshot: stats.avgRating,
      completedJobsCount: stats.completedCount,
    }));
  }

  async myApplications(workerId: number) {
    const list = await this.assignments.find({ where: { workerId }, order: { id: 'DESC' } });
    const jobs = await this.jobs.find({ where: { id: In(list.map((a) => a.jobId)) } });
    const ents = await this.enterprises.find();
    const jMap = new Map(jobs.map((j) => [j.id, j]));
    const eMap = new Map(ents.map((e) => [e.id, e]));
    const result = [];
    for (const a of list) {
      const job = jMap.get(a.jobId);
      if (!job) continue;
      const settlement = await this.settlements.findOne({ where: { assignmentId: a.id } });
      result.push({
        ...a,
        job: this.decorateJob(job, eMap.get(job.enterpriseId)),
        settlement,
      });
    }
    return result;
  }

  /** 企业录取 / 拒绝报名 */
  async reviewApplication(assignmentId: number, enterpriseId: number, accept: boolean) {
    const a = await this.assignments.findOne({ where: { id: assignmentId } });
    if (!a) throw new NotFoundException('报名记录不存在');
    const job = await this.jobs.findOne({ where: { id: a.jobId } });
    if (!job || job.enterpriseId !== enterpriseId) throw new ForbiddenException();
    if (a.status !== 'APPLIED') throw new BadRequestException('该报名已处理');
    if (accept) {
      const acceptedCount = await this.assignments.count({ where: { jobId: job.id, status: 'ACCEPTED' } });
      if (acceptedCount >= job.headcount) throw new BadRequestException('名额已满');
      a.status = 'ACCEPTED';
      a.acceptedAt = new Date();
      const saved = await this.assignments.save(a);
      // 录取即生成保单（待生效）：保险与实际到岗时间、岗位风险、企业确认联动
      await this.tasksService.createPendingPolicy(saved, job);
      const nowAccepted = acceptedCount + 1;
      if (nowAccepted >= job.headcount && job.status === 'OPEN') {
        job.status = 'FULL';
        await this.jobs.save(job);
      }
      return saved;
    }
    a.status = 'REJECTED';
    return this.assignments.save(a);
  }

  async listApplicants(jobId: number, enterpriseId: number) {
    const job = await this.jobs.findOne({ where: { id: jobId } });
    if (!job || job.enterpriseId !== enterpriseId) throw new ForbiddenException();
    const list = await this.assignments.find({ where: { jobId }, order: { id: 'ASC' } });
    return Promise.all(list.map(async (a) => ({ ...a, worker: await this.workerCard(a.workerId) })));
  }

  /** 企业取消岗位：保证金罚没（临近开工罚金更高），释放余额，通知录取工人；
   *  同时按 通知时间/工人位置/签到/历史取消规则 为在途或到场工人生成补偿建议 */
  async cancelJob(jobId: number, enterpriseId: number, reason: string) {
    const job = await this.jobs.findOne({ where: { id: jobId } });
    if (!job || job.enterpriseId !== enterpriseId) throw new ForbiddenException();
    if (['COMPLETED', 'CANCELLED'].includes(job.status)) throw new BadRequestException('岗位已结束或已取消');

    const accepted = await this.assignments.find({ where: { jobId, status: 'ACCEPTED' } });
    const inProgress = await this.assignments.count({
      where: { jobId, status: In(['CHECKED_IN', 'WORKING']) },
    });

    const cancelledAt = new Date();
    // 罚金规则：开工前 2 小时内取消罚没 50% 保证金；已到岗罚没 100%
    const hoursToStart = (new Date(job.startTime).getTime() - cancelledAt.getTime()) / 3600000;
    const ratio = inProgress > 0 ? 1 : hoursToStart < 2 ? 0.5 : 0.2;
    const forfeit = Math.round(Number(job.depositRequired) * ratio);
    const release = Number(job.depositRequired) - forfeit;

    await this.entService.forfeit(enterpriseId, forfeit);
    if (release > 0) await this.entService.release(enterpriseId, release);

    job.status = 'CANCELLED';
    job.cancelledBy = enterpriseId;
    job.cancelledAt = cancelledAt;
    job.cancelReason = reason || '企业取消';
    await this.jobs.save(job);

    for (const a of [...accepted, ...await this.assignments.find({
      where: { jobId, status: In(['CHECKED_IN', 'WORKING']) },
    })]) {
      a.status = 'CANCELLED';
      await this.assignments.save(a);
      // 岗位取消 → 未生效保单作废；已生效保单保障截止
      const policy = await this.policies.findOne({ where: { assignmentId: a.id } });
      if (policy) {
        if (policy.status === 'PENDING') policy.status = 'VOID';
        if (policy.status === 'ACTIVE') { policy.status = 'EXPIRED'; policy.effectiveTo = new Date(); }
        await this.policies.save(policy);
      }
    }

    // 临期取消：为「在路上 / 已到场」工人按规则生成到场补贴/交通补贴建议
    const compensations = await this.cancellations.generateForCancellation({
      job, cancelledAt, reason: reason || '企业取消',
    });
    const suggestedTotal = compensations.reduce((s, c) => s + Number(c.totalAmount), 0);

    const ent = await this.entService.get(enterpriseId);
    ent.cancelledJobs += 1;
    await this.enterprises.save(ent);
    await this.entService.recomputeRisk(enterpriseId);

    return {
      job, forfeit, released: release,
      affectedWorkers: accepted.length + inProgress,
      compensationCount: compensations.length,
      suggestedTotal,
      compensations,
    };
  }

  async addPrepayment(jobId: number, enterpriseId: number, amount: number) {
    if (!(amount > 0)) throw new BadRequestException('预付款必须大于 0');
    const job = await this.jobs.findOne({ where: { id: jobId } });
    if (!job || job.enterpriseId !== enterpriseId) throw new ForbiddenException();
    job.prepayment = Number(job.prepayment) + amount;
    return this.jobs.save(job);
  }

  async workerRating(workerId: number) {
    const reviews = await this.reviews.find({ where: { targetId: workerId, targetRole: 'WORKER' } });
    const completed = await this.assignments.count({
      where: { workerId, status: In(['COMPLETED']) },
    });
    const noShow = await this.assignments.count({ where: { workerId, status: 'NO_SHOW' } });
    const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 5;
    return { avgRating: Math.round(avg * 10) / 10, reviewCount: reviews.length, completedCount: completed, noShowCount: noShow };
  }

  private async workerCard(workerId: number) {
    const u = await this.users.findOne({ where: { id: workerId } });
    if (!u) return null;
    const stats = await this.workerRating(workerId);
    return {
      id: u.id,
      name: u.name,
      phone: u.phone,
      idVerified: !!u.idVerifiedAt,
      healthCertUntil: u.healthCertUntil,
      hasFaceSample: !!u.faceSampleUrl,
      ...stats,
    };
  }

  private decorateJob(job: Job, ent?: Enterprise | null, stability?: any) {
    const industry = INDUSTRIES[job.industry];
    return {
      ...job,
      industryLabel: industry?.label,
      industryRiskLevel: industry?.baseRiskLevel,
      enterpriseName: ent?.name || '未知企业',
      enterpriseRiskLevel: ent?.riskLevel ?? 1,
      stability: stability || null,
    };
  }
}
