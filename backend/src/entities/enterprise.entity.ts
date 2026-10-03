import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany,
} from 'typeorm';

@Entity('enterprises')
export class Enterprise {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 64 })
  name: string;

  @Column({ length: 16 })
  contactPhone: string;

  // 归属平台账号（role=ENTERPRISE）
  @Column()
  accountUserId: number;

  // 企业风险画像（滚动窗口统计，由平台在关键节点重算）
  @Column({ type: 'int', default: 1 })
  riskLevel: number;

  @Column({ type: 'int', default: 0 })
  totalJobs: number;

  // 企业取消的岗位数
  @Column({ type: 'int', default: 0 })
  cancelledJobs: number;

  // 已结算且产生过申诉的任务数
  @Column({ type: 'int', default: 0 })
  disputedAssignments: number;

  // 申诉中企业被判有责的任务数
  @Column({ type: 'int', default: 0 })
  lostDisputes: number;

  // 任务中发生工伤的数量
  @Column({ type: 'int', default: 0 })
  injuryJobs: number;

  // ---- 临时取消赔付相关画像 ----
  // 临期取消（开工前 2 小时内）并实际支付赔付的岗位数
  @Column({ type: 'int', default: 0 })
  lateCancelCompensatedJobs: number;

  // 企业拒付工人赔付、经仲裁败诉的次数
  @Column({ type: 'int', default: 0 })
  arbitrationLostCount: number;

  // 拒付败诉带来的后续发单保证金附加倍率（0 ~ 1.5）
  @Column({ type: 'decimal', precision: 4, scale: 2, default: 0 })
  depositSurchargeRate: number;

  // 排序模型罚分（确认临期取消/拒付败诉累计；岗位大厅排序降权）
  @Column({ type: 'int', default: 0 })
  rankPenalty: number;

  @Column({ type: 'decimal', precision: 5, scale: 4, default: 0 })
  cancelRate: number;

  @Column({ type: 'decimal', precision: 5, scale: 4, default: 0 })
  disputeRate: number;

  @Column({ type: 'decimal', precision: 5, scale: 4, default: 0 })
  injuryRate: number;

  // 保证金账户余额（预充值）
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  depositBalance: number;

  // 发单时冻结的保证金（岗位结束/取消时结算）
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  depositFrozen: number;

  @CreateDateColumn()
  createdAt: Date;
}
