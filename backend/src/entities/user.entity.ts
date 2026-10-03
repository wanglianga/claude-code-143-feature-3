import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToOne, OneToMany,
} from 'typeorm';

export type UserRole = 'WORKER' | 'ENTERPRISE' | 'SUPERVISOR' | 'SUPPORT';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 64 })
  username: string;

  @Column({ length: 128 })
  passwordHash: string;

  @Column({ length: 32 })
  name: string;

  @Column({ length: 16 })
  phone: string;

  @Column({ type: 'varchar', length: 16, default: 'WORKER' })
  role: UserRole;

  // 工人实名信息
  @Column({ length: 32, nullable: true })
  idCardNo: string | null;

  @Column({ type: 'datetime', nullable: true })
  idVerifiedAt: Date | null;

  // 健康证
  @Column({ type: 'date', nullable: true })
  healthCertUntil: string | null;

  // 主管所属企业（role=SUPERVISOR 时使用）
  @Column({ type: 'int', nullable: true })
  enterpriseId: number | null;

  // 头像（演示用：纯色/模拟人脸图 URL，前端可直接生成）
  @Column({ length: 255, nullable: true })
  faceSampleUrl: string | null;

  // 工人钱包余额（取消赔付等到账金额，元）
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  walletBalance: number;

  @CreateDateColumn()
  createdAt: Date;
}
