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

  /** 企业主动支付（如确认取消赔付）：从可用余额扣款，不足则报错提示充值 */
  async payFromBalance(enterpriseId: number, amount: number, purpose: string) {
    const e = await this.get(enterpriseId);
    if (Number(e.depositBalance) < amount) {
      throw new BadRequestException(
        `保证金可用余额不足：${purpose}需支付 ¥${amount}，当前可用 ¥${Number(e.depositBalance).toFixed(2)}，请先充值保证金`,
      );
    }
    e.depositBalance = Number(e.depositBalance) - amount;
    await this.enterprises.save(e);
    return e;
  }

  /** 平台强制划扣（仲裁判付）：先扣可用余额，不足部分从冻结保证金扣 */
  async forceDeduct(enterpriseId: number, amount: number) {
    const e = await this.get(enterpriseId);
    const fromBalance = Math.min(Number(e.depositBalance), amount);
    e.depositBalance = Number(e.depositBalance) - fromBalance;
    const rest = amount - fromBalance;
    const fromFrozen = Math.min(Number(e.depositFrozen), rest);
    e.depositFrozen = Number(e.depositFrozen) - fromFrozen;
    await this.enterprises.save(e);
    return { fromBalance: Math.round(fromBalance * 100) / 100, fromFrozen: Math.round(fromFrozen * 100) / 100 };
  }

  /** 重算风险画像（取消率/有责争议率/工伤率/取消赔付拒付） */
  async recomputeRisk(enterpriseId: number) {
    const e = await this.get(enterpriseId);
    const m = this.risk.buildMetrics({
      totalJobs: e.totalJobs,
      cancelledJobs: e.cancelledJobs,
      disputedAssignments: e.disputedAssignments,
      lostDisputes: e.lostDisputes,
      injuryJobs: e.injuryJobs,
      compRefusals: e.compRefusals,
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
