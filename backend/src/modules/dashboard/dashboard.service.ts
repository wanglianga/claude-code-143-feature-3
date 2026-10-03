import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Enterprise, Job, InsurancePolicy, InjuryClaim, User,
} from '../../entities';
import { INDUSTRIES, IndustryKey } from '../../risk.constants';
import { EnterpriseService } from '../enterprise/enterprise.service';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Enterprise) private enterprises: Repository<Enterprise>,
    @InjectRepository(Job) private jobs: Repository<Job>,
    @InjectRepository(InsurancePolicy) private policies: Repository<InsurancePolicy>,
    @InjectRepository(InjuryClaim) private claims: Repository<InjuryClaim>,
    @InjectRepository(User) private users: Repository<User>,
    private entService: EnterpriseService,
  ) {}

  async enterpriseHome(enterpriseId: number) {
    const ent = await this.entService.get(enterpriseId);
    const jobs = await this.jobs.find({ where: { enterpriseId } });
    const supervisors = await this.users.find({ where: { role: 'SUPERVISOR', enterpriseId } });
    const openJobs = jobs.filter((j) => ['OPEN', 'FULL', 'IN_PROGRESS'].includes(j.status)).length;
    const cancelled = jobs.filter((j) => j.status === 'CANCELLED').length;
    return {
      enterprise: ent,
      supervisors: supervisors.map((s) => ({ id: s.id, name: s.name, phone: s.phone, username: s.username })),
      stats: {
        totalJobs: jobs.length,
        openJobs,
        cancelled,
        frozenDeposit: Number(ent.depositFrozen),
        availableDeposit: Number(ent.depositBalance),
      },
    };
  }

  /** 按行业沉淀岗位风险：发单量、取消、工伤、理赔拒绝率（事故时未保险占比） */
  async industryRisk() {
    const jobs = await this.jobs.find();
    const policies = await this.policies.find();
    const claims = await this.claims.find();
    return (Object.keys(INDUSTRIES) as IndustryKey[]).map((key) => {
      const prof = INDUSTRIES[key];
      const js = jobs.filter((j) => j.industry === key);
      const ids = new Set(js.map((j) => j.id));
      const ps = policies.filter((p) => ids.has(p.jobId));
      const cs = claims.filter((c) => ids.has(c.jobId));
      const cancelled = js.filter((j) => j.status === 'CANCELLED').length;
      return {
        industry: key,
        label: prof.label,
        baseRiskLevel: prof.baseRiskLevel,
        baseDeposit: prof.baseDeposit,
        insuranceRate: prof.insuranceRate,
        jobs: js.length,
        cancelled,
        cancelRate: js.length ? Math.round((cancelled / js.length) * 1000) / 1000 : 0,
        injuries: cs.length,
        uncoveredInjuries: cs.filter((c) => !c.coveredAtOccurrence).length,
        policies: ps.length,
        activePolicies: ps.filter((p) => p.status === 'ACTIVE' || p.status === 'EXPIRED').length,
      };
    });
  }

  /** 客服风险总览：高风险企业名单 + 理赔单 */
  async supportOverview() {
    const enterprises = await this.enterprises.find({ order: { riskLevel: 'DESC' } });
    const ranked = enterprises.map((e) => ({
      id: e.id,
      name: e.name,
      riskLevel: e.riskLevel,
      totalJobs: e.totalJobs,
      cancelledJobs: e.cancelledJobs,
      cancelRate: Number(e.cancelRate),
      disputedAssignments: e.disputedAssignments,
      lostDisputes: e.lostDisputes,
      disputeRate: Number(e.disputeRate),
      injuryJobs: e.injuryJobs,
      injuryRate: Number(e.injuryRate),
      lateCancelCompensatedJobs: e.lateCancelCompensatedJobs,
      arbitrationLostCount: e.arbitrationLostCount,
      depositSurchargeRate: Number(e.depositSurchargeRate),
      rankPenalty: e.rankPenalty,
      depositBalance: Number(e.depositBalance),
      depositFrozen: Number(e.depositFrozen),
    }));
    const recentClaims = await this.claims.find({ order: { id: 'DESC' }, take: 50 });
    return {
      highRiskEnterprises: ranked.filter((e) => e.riskLevel >= 4),
      allEnterprises: ranked,
      recentClaims,
      industries: await this.industryRisk(),
    };
  }
}
