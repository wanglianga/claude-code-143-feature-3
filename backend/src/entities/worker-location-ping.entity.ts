import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

/**
 * 工人赴岗途中位置心跳（演示由工人端主动上报）。
 * 用于企业临期取消时判定「在路上 / 已到场附近 / 已到达现场」，
 * 与四重签到记录一起作为到场补贴/交通补贴建议的客观依据。
 */
@Entity('worker_location_pings')
@Index(['assignmentId'])
@Index(['workerId'])
export class WorkerLocationPing {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  assignmentId: number;

  @Column()
  jobId: number;

  @Column()
  workerId: number;

  @Column({ type: 'decimal', precision: 10, scale: 6 })
  lat: number;

  @Column({ type: 'decimal', precision: 10, scale: 6 })
  lng: number;

  // 距岗位签到点的直线距离（服务端 Haversine 计算，防端上伪造）
  @Column({ type: 'int' })
  distanceMeters: number;

  // 位置档位：EN_ROUTE / NEARBY / ON_SITE（服务端按距离落点）
  @Column({ type: 'varchar', length: 16, default: 'EN_ROUTE' })
  bucket: string;

  @CreateDateColumn()
  createdAt: Date;
}
