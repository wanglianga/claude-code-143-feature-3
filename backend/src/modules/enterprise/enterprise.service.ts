import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Enterprise, User } from '../../entities';
import { RiskService } from '../risk/risk.service';

@Injectable()
export class EnterpriseService {
  constructor(
    @InjectRepository(Enterprise) private enterprises: Repository<Enterprise>,
    @InjectRepository(User) private users: Repository<User>,
    private risk: RiskService,
  ) {}

  async get(enterpriseId: number): Promise<Enterprise> {
    const e = await this.enterprises.findOne({ where: { id: enterpriseId } });
    if (!e) throw new BadRequestException('企业不存在');
    return e;
  }

  async getByAccountUserId(accountUserId: number): Promise<Enterprise | null> {
    return this.enterprises.findOne({ where: { accountUserId } });
  }

  async recharge(enterpriseId: number, amount: number) {
    if (!(amount > 0)) throw new BadRequestException('充值金额必须大于 0');
    const e = await this.get(enterpriseId);
    e.depositBalance = Number(e.depositBalance) + amount;
    await this.enterprises.save(e);
    return e;
  }

  /** 发单时冻结保证金 */
  async freezeForJob(enterpriseId: number, amount: number) {
    const e = await this.get(enterpriseId);
    if (Number(e.depositBalance) < amount) {
      throw new BadRequestException(
        `保证金余额不足：本单需冻结 ¥${amount}（企业风险等级 ${e.riskLevel} 已上浮），当前余额 ¥${Number(e.depositBalance).toFixed(2)}，请先充值保证金`,
      );
    }
    e.depositBalance = Number(e.depositBalance) - amount;
    e.depositFrozen = Number(e.depositFrozen) + amount;
    await this.enterprises.save(e);
    return e;
  }

  async release(enterpriseId: number, amount: number) {
    const e = await this.get(enterpriseId);
    const real = Math.min(amount, Number(e.depositFrozen));
    e.depositFrozen = Number(e.depositFrozen) - real;
    e.depositBalance = Number(e.depositBalance) + real;
    await this.enterprises.save(e);
    return e;
  }

  /** 取消岗位的保证金罚金（从冻结中扣划，不退回余额） */
  async forfeit(enterpriseId: number, amount: number) {
    const e = await this.get(enterpriseId);
    const real = Math.min(amount, Number(e.depositFrozen));
    e.depositFrozen = Number(e.depositFrozen) - real;
    await this.enterprises.save(e);
    return e;
  }

  /**
   * 取消赔付发放：优先从冻结保证金池扣划，不足部分从可用余额扣（均为演示账本）。
   * 返回实际从冻结/余额扣划的金额。
   */
  async payoutCompensation(enterpriseId: number, amount: number) {
    const e = await this.get(enterpriseId);
    let remain = Math.max(0, amount);
    const fromFrozen = Math.min(remain, Number(e.depositFrozen));
    e.depositFrozen = Number(e.depositFrozen) - fromFrozen;
    remain -= fromFrozen;
    const fromBalance = Math.min(remain, Number(e.depositBalance));
    e.depositBalance = Number(e.depositBalance) - fromBalance;
    remain -= fromBalance;
    await this.enterprises.save(e);
    return { fromFrozen, fromBalance, unpaid: Math.round(remain * 100) / 100 };
  }

  /** 重算风险画像（取消率/有责争议率/工伤率） */
  async recomputeRisk(enterpriseId: number) {
    const e = await this.get(enterpriseId);
    const m = this.risk.buildMetrics({
      totalJobs: e.totalJobs,
      cancelledJobs: e.cancelledJobs,
      disputedAssignments: e.disputedAssignments,
      lostDisputes: e.lostDisputes,
      injuryJobs: e.injuryJobs,
    });
    e.riskLevel = m.riskLevel;
    e.cancelRate = m.cancelRate;
    e.disputeRate = m.disputeRate;
    e.injuryRate = m.injuryRate;
    await this.enterprises.save(e);
    return e;
  }

  async listWithAccounts() {
    const list = await this.enterprises.find({ order: { riskLevel: 'DESC', id: 'ASC' } });
    return list;
  }

  async supervisors(enterpriseId: number): Promise<User[]> {
    return this.users.find({ where: { role: 'SUPERVISOR', enterpriseId } });
  }
}
