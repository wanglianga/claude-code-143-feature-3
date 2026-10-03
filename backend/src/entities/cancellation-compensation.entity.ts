import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

export type CompensationStatus =
  | 'SUGGESTED' // 平台已生成补偿建议，待企业确认
  | 'CONFIRMED' // 企业确认支付（待发放/已生成到账记录）
  | 'PAID' // 工人补贴已到账（到场补贴/交通补贴）
  | 'REFUSED' // 企业拒绝支付 → 进入仲裁
  | 'ARBITRATION' // 平台仲裁处理中
  | 'ARBITRATION_AWARD_PAY' // 仲裁裁决企业应支付
  | 'ARBITRATION_UPHELD'; // 仲裁裁决企业无需支付

export type CompensationKind = 'ATTENDANCE' | 'TRANSPORT' | 'ATTENDANCE_TRANSPORT' | 'NONE';

/**
 * 企业临时取消岗位的工人赔付单（按受影响工人/派单一单）。
 * 取消时由平台依据 通知时间 + 工人位置 + 是否已签到 + 历史取消规则 生成建议。
 */
@Entity('cancellation_compensations')
@Index(['jobId'])
@Index(['workerId'])
@Index(['assignmentId'], { unique: true })
export class CancellationCompensation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  jobId: number;

  @Column()
  assignmentId: number;

  @Column()
  workerId: number;

  @Column()
  enterpriseId: number;

  // ---- 取消通知时点 ----
  @Column({ type: 'datetime' })
  cancelledAt: Date;

  // 通知时距开工的分钟数（负数表示开工后取消）
  @Column({ type: 'int' })
  minutesToStart: number;

  @Column({ type: 'varchar', length: 16 })
  noticeTier: string;

  @Column({ length: 64 })
  noticeTierLabel: string;

  // ---- 工人位置 / 签到事实快照 ----
  @Column({ type: 'varchar', length: 16 })
  locationBucket: string;

  @Column({ type: 'int', nullable: true })
  distanceMeters: number | null;

  // 是否已四重签到（已到岗签到 → 按到场补贴顶格）
  @Column({ type: 'boolean', default: false })
  checkedIn: boolean;

  // ---- 历史取消规则快照 ----
  @Column({ type: 'int', default: 0 })
  priorLateCancels: number;

  @Column({ type: 'decimal', precision: 4, scale: 2, default: 1 })
  historyMultiplier: number;

  // ---- 建议金额 ----
  @Column({ type: 'varchar', length: 24, default: 'NONE' })
  kind: CompensationKind;

  // 到场补贴（元）
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  attendanceAllowance: number;

  // 交通补贴（元）
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  transportAllowance: number;

  // 建议/应付合计
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  totalAmount: number;

  // 规则测算说明（给企业与工人看的依据明细）
  @Column({ type: 'text' })
  ruleBreakdown: string;

  @Column({ type: 'varchar', length: 24, default: 'SUGGESTED' })
  status: CompensationStatus;

  // ---- 企业确认/拒绝 ----
  @Column({ type: 'datetime', nullable: true })
  enterpriseDecidedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  enterpriseDecidedBy: number | null;

  @Column({ type: 'text', nullable: true })
  enterpriseNote: string | null;

  // ---- 到账 ----
  @Column({ type: 'datetime', nullable: true })
  workerNotifiedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  paidAt: Date | null;

  // ---- 仲裁 ----
  @Column({ type: 'int', nullable: true })
  arbitratedBy: number | null;

  @Column({ type: 'datetime', nullable: true })
  arbitratedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  arbitrationAward: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  awardedAmount: number | null;

  // 仲裁败诉后是否已联动保证金附加倍率 / 排序罚分
  @Column({ type: 'boolean', default: false })
  surchargeApplied: boolean;

  @Column({ type: 'boolean', default: false })
  rankPenaltyApplied: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
