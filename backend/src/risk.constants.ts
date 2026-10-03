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

// ===================== 企业临时取消岗位赔付规则 =====================

/**
 * 通知时间档位（距开工时间）——企业开工前临时取消时适用
 * 越临近开工，对工人行程的扰动越大，补贴比例越高
 */
export interface CancelNoticeTier {
  key: string;
  label: string;
  // 距开工的小时区间（min, max]（单位：小时）；null 端点开区间
  minHours: number | null;
  maxHours: number | null;
  // 到场补贴 = 日结工资 × attendanceWageRatio
  attendanceWageRatio: number;
  // 交通补贴（元）
  transportAllowance: number;
}

export const CANCEL_NOTICE_TIERS: CancelNoticeTier[] = [
  { key: 'LT_1H', label: '开工前 1 小时内（含 0.5 小时）', minHours: null, maxHours: 1, attendanceWageRatio: 0.5, transportAllowance: 30 },
  { key: 'H1_2', label: '开工前 1–2 小时', minHours: 1, maxHours: 2, attendanceWageRatio: 0.3, transportAllowance: 20 },
  { key: 'H2_24', label: '开工前 2–24 小时', minHours: 2, maxHours: 24, attendanceWageRatio: 0.2, transportAllowance: 10 },
  { key: 'GT_24H', label: '开工前 24 小时以上', minHours: 24, maxHours: null, attendanceWageRatio: 0, transportAllowance: 0 },
];

/** 工人位置档位（取消时点的最近一次位置上报 / 签到状态） */
export type WorkerLocationBucket = 'ON_SITE' | 'NEARBY' | 'EN_ROUTE' | 'AT_HOME' | 'UNKNOWN';

export const LOCATION_BUCKET_LABEL: Record<WorkerLocationBucket, string> = {
  ON_SITE: '已到达现场',
  NEARBY: '已到场附近（1km 内）',
  EN_ROUTE: '已在途中',
  AT_HOME: '尚未出发',
  UNKNOWN: '位置未知',
};

// 地理判定半径（米）
export const ON_SITE_RADIUS_METERS = 300; // 与考勤围栏一致：已在现场
export const NEARBY_RADIUS_METERS = 1000; // 到场附近：已到周边
export const EN_ROUTE_MAX_METERS = 30000; // 30km 内且有途中位移证据：视为已上路

/** 历史取消记录的补偿上浮倍率（企业重复临时取消，建议补偿上浮） */
export function cancelHistoryMultiplier(priorLateCancels: number): number {
  if (priorLateCancels >= 3) return 1.5;
  if (priorLateCancels >= 1) return 1.2;
  return 1;
}

/** 企业拒付、仲裁败诉后对后续发单保证金的附加倍率 */
export const ARBITRATION_DEPOSIT_SURCHARGE = 0.5; // 每次拒付败诉 +0.5 倍附加
export const ARBITRATION_DEPOSIT_SURCHARGE_CAP = 1.5; // 附加上限 +1.5 倍

/** 排序模型：取消赔付违规罚分（岗位大厅排序降权） */
export const RANK_PENALTY = {
  lateCancelConfirmed: 2, // 每次确认的临期取消赔付
  refusedThenLost: 8, // 每次拒付后仲裁败诉
  rankFloorScore: -100, // 罚分下限
};

/** 工人报名时可见的近期稳定性提示阈值 */
export const STABILITY_THRESHOLDS = {
  windowSize: 10, // 近 10 单
  watchCancelRate: 0.15, // 取消率 ≥15% 提示
  watchRefused: 1, // 近 10 单存在 1 次拒付败诉即警示
};

/** 综合保证金倍率：风险等级倍率 + 仲裁附加倍率 */
export function depositMultiplierWithSurcharge(enterpriseRiskLevel: number, arbitrationSurchargeRate: number): number {
  return Math.round((depositMultiplier(enterpriseRiskLevel) + Math.max(0, Number(arbitrationSurchargeRate) || 0)) * 100) / 100;
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
