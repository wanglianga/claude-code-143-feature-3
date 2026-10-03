import { Injectable } from '@nestjs/common';

@Injectable()
export class RiskService {
  /**
   * 重算企业风险画像：
   * - 取消率 = 企业取消岗位 / 总发单数
   * - 有责争议率 = 申诉且企业有责 / 总发单数
   * - 工伤率 = 发生工伤的任务 / 总发单数
   * - 取消赔付拒付：有拒付记录直接上调一级（影响后续发单保证金倍率与排序）
   * 样本不足（<3 单）不进行高风险定级（新企业保护）。
   */
  buildMetrics(raw: {
    totalJobs: number;
    cancelledJobs: number;
    disputedAssignments: number;
    lostDisputes: number;
    injuryJobs: number;
    compRefusals?: number;
  }) {
    const total = raw.totalJobs || 0;
    const enoughSample = total >= 3;
    const cancelRate = enoughSample ? raw.cancelledJobs / total : 0;
    const disputeRate = enoughSample ? raw.lostDisputes / total : 0;
    const injuryRate = enoughSample ? raw.injuryJobs / total : 0;

    let level = 1;
    if (cancelRate >= 0.15) level += 2;
    if (disputeRate >= 0.2) level += 2;
    if (injuryRate >= 0.1) level += 1;
    if ((raw.compRefusals || 0) >= 1) level += 1; // 取消赔付拒付记录
    level = Math.min(5, Math.max(1, level));

    return {
      cancelRate: Math.round(cancelRate * 10000) / 10000,
      disputeRate: Math.round(disputeRate * 10000) / 10000,
      injuryRate: Math.round(injuryRate * 10000) / 10000,
      riskLevel: level,
      highRisk: level >= 4,
    };
  }
}
