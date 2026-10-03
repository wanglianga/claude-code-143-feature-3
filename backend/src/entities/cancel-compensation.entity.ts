import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

export type CompensationKind =
  | 'ATTENDANCE' // 到场补贴：已完成到岗签到
  | 'TRANSPORT' // 交通补贴：已出发在路上（有位置上报）
  | 'NONE'; // 无需补偿：未出发/无位置上报

export type CompensationStatus =
  | 'SUGGESTED' // 平台已生成补偿建议，待企业确认
  | 'PAID' // 企业确认并支付完成
  | 'ARBITRATION' // 企业拒绝支付，订单进入仲裁
  | 'ARBITRATED_PAID' // 仲裁判付：企业被裁决支付
  | 'ARBITRATED_WAIVED' // 仲裁豁免：企业无需支付
  | 'NONE_REQUIRED'; // 无需补偿（未出发工人，终态）

export type WorkerTripState =
  | 'CHECKED_IN' // 已签到到场
  | 'ON_THE_WAY' // 在路上（有出发位置上报）
  | 'NOT_DEPARTED'; // 未出发（无任何位置上报）

// 企业临时取消岗位后，平台为每位受影响工人生成的补偿建议单
@Entity('cancel_compensations')
@Index(['jobId'])
@Index(['assignmentId'], { unique: true })
export class CancelCompensation {
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

  @Column({ type: 'varchar', length: 16 })
  kind: CompensationKind;

  // 取消时点工人的行程状态快照
  @Column({ type: 'varchar', length: 16 })
  workerState: WorkerTripState;

  // 取消时点工人最近一次位置上报距岗位的距离（米），无上报为 null
  @Column({ type: 'int', nullable: true })
  distanceMeters: number | null;

  // 取消时点距开工的分钟数（负值表示开工后取消）
  @Column({ type: 'int' })
  minutesToStart: number;

  // 平台按规则生成的建议补偿金额（元）
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  suggestedAmount: number;

  // 最终支付金额（企业确认=建议金额；仲裁可调整）
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  finalAmount: number | null;

  // 建议生成依据（通知时间/工人位置/签到状态/历史取消规则 快照说明）
  @Column({ type: 'text' })
  ruleSnapshot: string;

  @Column({ type: 'varchar', length: 24, default: 'SUGGESTED' })
  status: CompensationStatus;

  // 企业拒绝支付的理由（进入仲裁时填写）
  @Column({ type: 'varchar', length: 255, nullable: true })
  rejectReason: string | null;

  // 企业确认/拒绝时间
  @Column({ type: 'datetime', nullable: true })
  respondedAt: Date | null;

  // 仲裁信息
  @Column({ type: 'int', nullable: true })
  decidedBy: number | null;

  @Column({ type: 'datetime', nullable: true })
  decidedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  decisionNote: string | null;

  @Column({ type: 'datetime', nullable: true })
  paidAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
