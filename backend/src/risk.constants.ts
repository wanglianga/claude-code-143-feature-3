// 行业风险与企业风控常量

export type IndustryKey =
  | 'INVENTORY' // 商超盘点
  | 'EXHIBITION' // 会展搭建
  | 'WAREHOUSE' // 仓库分拣
  | 'CATERING' // 餐饮帮工
  | 'CLEANING' // 保洁突击
  | 'SECURITY'; // 活动安保

export interface IndustryProfile {
  key: IndustryKey;
  label: string;
  // 行业基础风险等级 1-5
  baseRiskLevel: number;
  // 基准保证金（元/岗）
  baseDeposit: number;
  // 是否强制要求健康证
  healthCertRequired: boolean;
  // 保险费率（占工资的比例），高风险行业保费更高
  insuranceRate: number;
}

export const INDUSTRIES: Record<IndustryKey, IndustryProfile> = {
  INVENTORY: { key: 'INVENTORY', label: '商超盘点', baseRiskLevel: 1, baseDeposit: 100, healthCertRequired: false, insuranceRate: 0.01 },
  EXHIBITION: { key: 'EXHIBITION', label: '会展搭建', baseRiskLevel: 4, baseDeposit: 300, healthCertRequired: false, insuranceRate: 0.03 },
  WAREHOUSE: { key: 'WAREHOUSE', label: '仓库分拣', baseRiskLevel: 3, baseDeposit: 200, healthCertRequired: false, insuranceRate: 0.02 },
  CATERING: { key: 'CATERING', label: '餐饮帮工', baseRiskLevel: 2, baseDeposit: 150, healthCertRequired: true, insuranceRate: 0.015 },
  CLEANING: { key: 'CLEANING', label: '保洁突击', baseRiskLevel: 2, baseDeposit: 150, healthCertRequired: false, insuranceRate: 0.015 },
  SECURITY: { key: 'SECURITY', label: '活动安保', baseRiskLevel: 5, baseDeposit: 400, healthCertRequired: false, insuranceRate: 0.04 },
};

// 企业风控阈值：长期高取消率 / 高争议率
export const RISK_THRESHOLDS = {
  // 近 N 单窗口
  windowSize: 10,
  highCancelRate: 0.15, // 取消率 > 15%
  highDisputeRate: 0.2, // 争议率（申诉且企业败诉/有责）> 20%
  highInjuryRate: 0.1, // 工伤率 > 10%
};

// 高风险企业的加严措施
export function depositMultiplier(enterpriseRiskLevel: number): number {
  // 风险等级 1-5：保证金倍率 1.0 ~ 3.0
  return 1 + (enterpriseRiskLevel - 1) * 0.5;
}

export function strictConfirmationRequired(enterpriseRiskLevel: number): boolean {
  return enterpriseRiskLevel >= 4;
}

// 企业综合风险等级：综合取消率、争议率、工伤率
export function computeEnterpriseRiskLevel(metrics: {
  cancelRate: number;
  disputeRate: number;
  injuryRate: number;
}): number {
  let score = 0;
  if (metrics.cancelRate >= RISK_THRESHOLDS.highCancelRate) score += 2;
  if (metrics.disputeRate >= RISK_THRESHOLDS.highDisputeRate) score += 2;
  if (metrics.injuryRate >= RISK_THRESHOLDS.highInjuryRate) score += 1;
  return Math.min(5, Math.max(1, 1 + score));
}

// ===================== 企业临时取消岗位赔付规则 =====================
// 平台依据：通知时间（距开工分钟）、工人位置（距岗位距离）、是否已签到、历史取消规则
export const CANCEL_COMP_RULES = {
  // 到场补贴：已完成到岗签到的工人，按取消通知距开工的时长分档（占日结工资比例）
  attendanceTiers: [
    { maxMinutesToStart: 60, rate: 0.3, label: '开工前 1 小时内取消' },
    { maxMinutesToStart: 120, rate: 0.2, label: '开工前 1–2 小时取消' },
    { maxMinutesToStart: Infinity, rate: 0.1, label: '开工前 2 小时以上取消' },
  ],
  // 交通补贴：已出发在路上的工人，按取消时距岗位距离分档（元）
  transportTiers: [
    { maxKm: 3, amount: 10, label: '3km 内' },
    { maxKm: 10, amount: 20, label: '3–10km' },
    { maxKm: Infinity, amount: 30, label: '10km 以上' },
  ],
  // 临近开工通知（<60 分钟）交通补贴上浮 50%
  lateNotice: { minutesToStart: 60, transportMultiplier: 1.5 },
  // 企业历史取消率达到阈值（15%），建议赔付上浮 20%（惩罚性）
  highCancelRate: { threshold: 0.15, multiplier: 1.2 },
  // 单人补贴上限：不超过日结工资的 50%
  maxRateOfDailyWage: 0.5,
  // 出发上报的有效窗口：取消前 4 小时内的位置上报才视为“在路上”
  enRouteWindowHours: 4,
};

// ===================== 岗位大厅排序模型 =====================
// 排序分 = 100 − 取消率惩罚 − 拒付惩罚 − 风险等级惩罚；分数越高排越前
export const RANKING = {
  // 企业累计取消率惩罚系数（取消率 100% 时扣满 60 分）
  cancelRateWeight: 60,
  // 每次取消赔付拒付扣分
  refusalPenalty: 10,
  // 企业风险等级每级扣分
  riskLevelPenalty: 4,
  // 工人端“近期稳定性”统计窗口（天）
  recentWindowDays: 30,
  // 近期取消率超过该值提示“稳定性较低”
  cautionCancelRate: 0.15,
};
