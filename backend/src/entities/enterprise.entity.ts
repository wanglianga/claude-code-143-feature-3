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

  // 取消赔付中企业拒绝支付的次数（影响风险等级与排序）
  @Column({ type: 'int', default: 0 })
  compRefusals: number;

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
