import { DataSource } from 'typeorm';
import { hash } from 'bcryptjs';
import { config } from './config';
import {
  User, Enterprise, Job, Assignment, AttendanceEvent, InsurancePolicy,
  JobEvent, InjuryClaim, ChatMessage, Settlement, Appeal, Review,
  WorkerLocationPing, CancellationCompensation,
} from './entities';
import { INDUSTRIES, depositMultiplier, strictConfirmationRequired } from './risk.constants';
import { haversineMeters } from './geo';

let ds: DataSource | null = null;

async function dataSource(): Promise<DataSource> {
  if (ds) return ds;
  ds = new DataSource({
    type: 'mysql',
    host: config.db.host,
    port: config.db.port,
    username: config.db.username,
    password: config.db.password,
    database: config.db.database,
    entities: [
      User, Enterprise, Job, Assignment, AttendanceEvent, InsurancePolicy,
      JobEvent, InjuryClaim, ChatMessage, Settlement, Appeal, Review,
      WorkerLocationPing, CancellationCompensation,
    ],
    charset: 'utf8mb4',
    timezone: '+08:00',
    synchronize: true,
  });
  await ds.initialize();
  return ds;
}

export async function runSeed() {
  const source = await dataSource();
  const users = source.getRepository(User);
  const enterprises = source.getRepository(Enterprise);
  const jobs = source.getRepository(Job);

  if (await users.findOne({ where: { username: 'worker1' } })) {
    // 幂等：种子账号已存在则跳过
    return;
  }

  const pwd = await hash('123456', 10);

  // ---------- 工人 ----------
  const worker1 = await users.save(users.create({
    username: 'worker1', passwordHash: pwd, name: '张三', phone: '13800000001', role: 'WORKER',
    idCardNo: '310101199003071234', idVerifiedAt: new Date(),
    healthCertUntil: '2027-12-31', faceSampleUrl: 'seed://face-zhangsan',
  }));
  await users.save(users.create({
    username: 'worker2', passwordHash: pwd, name: '李四', phone: '13800000002', role: 'WORKER',
    // 未实名、无健康证、无人脸样本 —— 用于演示报名门禁与考勤拦截
  }));
  void worker1;

  // ---------- 正常企业 ----------
  const ent1User = await users.save(users.create({
    username: 'enterprise1', passwordHash: pwd, name: '刘经理', phone: '13900000001', role: 'ENTERPRISE',
  }));
  const ent1 = await enterprises.save(enterprises.create({
    name: '安心会展服务有限公司', contactPhone: '13900000001', accountUserId: ent1User.id,
    riskLevel: 1, totalJobs: 0, depositBalance: 20000, depositFrozen: 0,
  }));
  ent1User.enterpriseId = ent1.id;
  await users.save(ent1User);

  await users.save(users.create({
    username: 'supervisor1', passwordHash: pwd, name: '王主管', phone: '13700000001',
    role: 'SUPERVISOR', enterpriseId: ent1.id, faceSampleUrl: 'seed://face-sup1',
  }));
  await users.save(users.create({
    username: 'supervisor1b', passwordHash: pwd, name: '赵场务', phone: '13700000002',
    role: 'SUPERVISOR', enterpriseId: ent1.id,
  }));

  // ---------- 高风险企业（高取消率 + 高有责争议率 → 风险等级 5） ----------
  const riskyUser = await users.save(users.create({
    username: 'enterprise_risky', passwordHash: pwd, name: '钱总', phone: '13900000002', role: 'ENTERPRISE',
  }));
  const risky = await enterprises.save(enterprises.create({
    name: '雷霆突击人力资源公司', contactPhone: '13900000002', accountUserId: riskyUser.id,
    riskLevel: 5, totalJobs: 10, cancelledJobs: 2, disputedAssignments: 4, lostDisputes: 3,
    injuryJobs: 1,
    cancelRate: 0.2, disputeRate: 0.3, injuryRate: 0.1,
    depositBalance: 50000, depositFrozen: 0,
  }));
  riskyUser.enterpriseId = risky.id;
  await users.save(riskyUser);
  await users.save(users.create({
    username: 'supervisor_risky', passwordHash: pwd, name: '孙队', phone: '13700000003',
    role: 'SUPERVISOR', enterpriseId: risky.id,
  }));
  await users.save(users.create({
    username: 'supervisor_riskyb', passwordHash: pwd, name: '李队', phone: '13700000004',
    role: 'SUPERVISOR', enterpriseId: risky.id,
  }));

  // ---------- 客服 / 仲裁员 ----------
  await users.save(users.create({
    username: 'support', passwordHash: pwd, name: '平台客服', phone: '13600000000', role: 'SUPPORT',
  }));

  // ---------- 岗位 ----------
  const now = Date.now();
  const iso = (offsetMin: number) => new Date(now + offsetMin * 60000);
  const mk = (enterprise: Enterprise, opt: Partial<Job> & { title: string; industry: any }): Job => {
    const industry = INDUSTRIES[opt.industry as keyof typeof INDUSTRIES];
    const deposit = Math.round(
      industry.baseDeposit * depositMultiplier(enterprise.riskLevel) * (opt.headcount || 1),
    );
    return jobs.create({
      enterpriseId: enterprise.id,
      description: opt.description || '按现场安排完成工作，服从主管调度。',
      location: opt.location || '上海市浦东新区世博展览馆 H2 馆',
      lat: 31.2304, lng: 121.4737,
      startTime: iso(-10), endTime: iso(300),
      headcount: 1,
      skillRequirement: '无特殊要求',
      requireHealthCert: industry.healthCertRequired,
      dressCode: null,
      dailyWage: 260, overtimeRate: 30, mealAllowance: 20,
      lateDeductPerMin: 2, lateGraceMinutes: 5,
      insuranceCoverageWan: 30,
      insurancePremium: Math.round(260 * industry.insuranceRate * 100) / 100,
      settlementMethod: '日结-完工24小时内',
      platformFeeRate: 0.08,
      status: 'OPEN',
      depositRequired: deposit, depositPaid: true,
      strictConfirmation: strictConfirmationRequired(enterprise.riskLevel),
      prepayment: 0,
      ...opt,
    } as Job);
  };

  const job1 = mk(ent1, {
    title: '世博动漫展·展台搭建帮工', industry: 'EXHIBITION',
    description: '协助桁架搭建、展柜搬运，需穿劳保鞋；有轻微登高作业。',
    skillRequirement: '体力好，有会展搭建经验优先', dressCode: '劳保鞋+手套',
    location: '上海市浦东新区世博展览馆 H2 馆',
    dailyWage: 300, overtimeRate: 35, mealAllowance: 25,
    startTime: iso(-10), endTime: iso(360), headcount: 3,
  });
  const job2 = mk(ent1, {
    title: '盒马鲜生·夜班仓库分拣', industry: 'WAREHOUSE',
    location: '上海市嘉定区丰茂路物流园 3 号库',
    description: '生鲜分拣、码拍、笼车搬运。',
    dailyWage: 240, startTime: iso(60 * 20), endTime: iso(60 * 28), headcount: 5,
  });
  const job3 = mk(ent1, {
    title: '星级酒店宴会厅·餐饮帮工', industry: 'CATERING',
    location: '上海市静安区南京西路 1266 号',
    description: '传菜、摆台、收尾清洗。必须持有效健康证。',
    dailyWage: 220, mealAllowance: 30, requireHealthCert: true,
    dressCode: '黑裤黑鞋，酒店提供工服',
    startTime: iso(60 * 26), endTime: iso(60 * 32), headcount: 4,
  });
  const job4 = mk(risky, {
    title: '大型音乐节·入口安检安保', industry: 'SECURITY',
    location: '上海市徐汇区滨江音乐公园',
    description: '入口安检、秩序维护、突发情况处置（高风险岗位，需双人现场确认）。',
    skillRequirement: '身高175+，有安保经验优先', dressCode: '黑色安保制服',
    dailyWage: 320, overtimeRate: 40, mealAllowance: 20, insuranceCoverageWan: 50,
    startTime: iso(60 * 2), endTime: iso(60 * 10), headcount: 2,
  });
  const job5 = mk(risky, {
    title: '写字楼年终保洁突击', industry: 'CLEANING',
    location: '上海市黄浦区人民广场写字楼',
    dailyWage: 210, startTime: iso(60 * 44), endTime: iso(60 * 52), headcount: 6,
  });
  const job6 = mk(ent1, {
    title: '连锁超市月度盘点', industry: 'INVENTORY',
    location: '上海市杨浦区五角场万达',
    dailyWage: 180, startTime: iso(60 * 50), endTime: iso(60 * 56), headcount: 4,
  });
  const created = await jobs.save([job1, job2, job3, job4, job5, job6]);

  // 冻结对应保证金
  for (const j of created) {
    const ent = j.enterpriseId === ent1.id ? ent1 : risky;
    ent.depositFrozen = Number(ent.depositFrozen) + Number(j.depositRequired);
    ent.depositBalance = Number(ent.depositBalance) - Number(j.depositRequired);
  }
  await enterprises.save([ent1, risky]);

  // 给主演示岗位一笔预付款
  const demo = created[0];
  demo.prepayment = 300;
  await jobs.save(demo);

  // ===================== 扩展：企业临时取消岗位赔付演示数据 =====================
  const assignments = source.getRepository(Assignment);
  const policies = source.getRepository(InsurancePolicy);
  const pings = source.getRepository(WorkerLocationPing);
  const comps = source.getRepository(CancellationCompensation);

  // 额外两名实名工人（用于在途/到场与仲裁案例）
  const worker3 = await users.save(users.create({
    username: 'worker3', passwordHash: pwd, name: '王五', phone: '13800000003', role: 'WORKER',
    idCardNo: '310101199205053333', idVerifiedAt: new Date(),
    healthCertUntil: '2027-12-31', faceSampleUrl: 'seed://face-wangwu',
  }));
  const worker4 = await users.save(users.create({
    username: 'worker4', passwordHash: pwd, name: '赵六', phone: '13800000004', role: 'WORKER',
    idCardNo: '310101199407074444', idVerifiedAt: new Date(),
    healthCertUntil: null, faceSampleUrl: 'seed://face-zhaoliu',
  }));

  const SITE_LAT = 31.2304;
  const SITE_LNG = 121.4737;
  const mkCancelled = (enterprise: Enterprise, opt: Partial<Job> & { title: string; industry: any; startInMin: number; headcount: number; dailyWage: number; location: string }) => {
    const { startInMin, ...jobFields } = opt;
    const industry = INDUSTRIES[opt.industry as keyof typeof INDUSTRIES];
    const deposit = Math.round(
      industry.baseDeposit * depositMultiplier(enterprise.riskLevel) * opt.headcount,
    );
    return jobs.create({
      enterpriseId: enterprise.id,
      description: opt.description || '临时岗位（已被企业取消）',
      lat: SITE_LAT, lng: SITE_LNG,
      startTime: iso(startInMin), endTime: iso(startInMin + 480),
      skillRequirement: '无特殊要求',
      requireHealthCert: industry.healthCertRequired,
      dressCode: null,
      overtimeRate: 30, mealAllowance: 20,
      lateDeductPerMin: 2, lateGraceMinutes: 5,
      insuranceCoverageWan: 30,
      insurancePremium: Math.round(opt.dailyWage * industry.insuranceRate * 100) / 100,
      settlementMethod: '日结-完工24小时内',
      platformFeeRate: 0.08,
      depositRequired: deposit, depositPaid: true,
      strictConfirmation: strictConfirmationRequired(enterprise.riskLevel),
      prepayment: 0,
      ...jobFields,
      status: 'CANCELLED',
      cancelledBy: enterprise.id,
      cancelledAt: startInMin < 0 ? iso(startInMin - 35) : new Date(),
      cancelReason: opt.cancelReason || '甲方临时取消',
    } as Job);
  };

  // —— 案例 1：安心会展开工前 25 分钟紧急取消盘点任务（工人已到场/在途），赔付建议待企业处理 ——
  const urgentJob = mkCancelled(ent1, {
    title: '紧急·超市夜间盘点（开工前 25 分钟被取消）', industry: 'INVENTORY',
    location: '上海市虹口区龙之梦购物中心 B1 超市',
    dailyWage: 180, startInMin: 25, headcount: 2,
    cancelReason: '超市盘点系统故障，甲方通知延期，任务取消',
  });
  await jobs.save(urgentJob);
  // 保证金：冻结 200 → 临期取消罚没 50%（100）、退回 100，净影响仅余额 -100
  ent1.depositBalance = Number(ent1.depositBalance) - 100;

  const urgentA1 = await assignments.save(assignments.create({
    jobId: urgentJob.id, workerId: worker1.id, status: 'CANCELLED', riskAcknowledged: true,
    appliedAt: new Date(), acceptedAt: new Date(), ratingSnapshot: 5, completedJobsCount: 3,
  }));
  const urgentA2 = await assignments.save(assignments.create({
    jobId: urgentJob.id, workerId: worker3.id, status: 'CANCELLED', riskAcknowledged: true,
    appliedAt: new Date(), acceptedAt: new Date(), ratingSnapshot: 5, completedJobsCount: 1,
  }));
  for (const aid of [urgentA1.id, urgentA2.id]) {
    await policies.save(policies.create({
      assignmentId: aid, jobId: urgentJob.id, workerId: aid === urgentA1.id ? worker1.id : worker3.id,
      enterpriseId: ent1.id, insurerProduct: '雇主责任险·通用A款', coverageWan: 30,
      premium: 1.8, status: 'VOID', jobRiskLevel: 1, enterpriseConfirmed: true,
    }));
  }
  // 张三：已到达现场（距签到点约 80m）；王五：已在途中（约 2.6km）
  const onsiteLat = 31.2311, onsiteLng = 121.4741;
  const routeLat = 31.254, routeLng = 121.4737;
  await pings.save(pings.create({
    assignmentId: urgentA1.id, jobId: urgentJob.id, workerId: worker1.id,
    lat: onsiteLat, lng: onsiteLng,
    distanceMeters: haversineMeters(onsiteLat, onsiteLng, SITE_LAT, SITE_LNG), bucket: 'ON_SITE',
  }));
  await pings.save(pings.create({
    assignmentId: urgentA2.id, jobId: urgentJob.id, workerId: worker3.id,
    lat: routeLat, lng: routeLng,
    distanceMeters: haversineMeters(routeLat, routeLng, SITE_LAT, SITE_LNG), bucket: 'EN_ROUTE',
  }));

  const compRows: any[] = [
    {
      assignmentId: urgentA1.id, workerId: worker1.id, kind: 'ATTENDANCE_TRANSPORT',
      attendance: 90, transport: 30, total: 120, bucket: 'ON_SITE',
      distance: haversineMeters(onsiteLat, onsiteLng, SITE_LAT, SITE_LNG), checkedIn: false,
      tier: 'LT_1H', tierLabel: '开工前 1 小时内（含 0.5 小时）', minutes: 25, mult: 1,
      breakdown:
        '【通知时间】开工前 25 分钟取消 → 开工前 1 小时内档\n' +
        '【工人位置】已到达现场（位置心跳显示距签到点约 80m）\n' +
        '【签到状态】尚未完成到岗签到（岗位即被取消）\n' +
        '【历史取消】该企业此前临期取消并赔付 0 次 → 补偿倍率 ×1\n' +
        '【建议金额】到场补贴 ¥90（日结180×50%）+ 交通补贴 ¥30 = ¥120',
    },
    {
      assignmentId: urgentA2.id, workerId: worker3.id, kind: 'TRANSPORT',
      attendance: 0, transport: 30, total: 30, bucket: 'EN_ROUTE',
      distance: haversineMeters(routeLat, routeLng, SITE_LAT, SITE_LNG), checkedIn: false,
      tier: 'LT_1H', tierLabel: '开工前 1 小时内（含 0.5 小时）', minutes: 25, mult: 1,
      breakdown:
        '【通知时间】开工前 25 分钟取消 → 开工前 1 小时内档\n' +
        '【工人位置】已在途中（位置心跳显示距签到点约 2.6km）\n' +
        '【签到状态】尚未到岗\n【历史取消】倍率 ×1\n' +
        '【建议金额】不享到场补贴，发放交通补贴 ¥30',
    },
  ];
  for (const r of compRows) {
    await comps.save(comps.create({
      jobId: urgentJob.id, assignmentId: r.assignmentId, workerId: r.workerId, enterpriseId: ent1.id,
      cancelledAt: new Date(), minutesToStart: r.minutes, noticeTier: r.tier, noticeTierLabel: r.tierLabel,
      locationBucket: r.bucket, distanceMeters: r.distance, checkedIn: r.checkedIn,
      priorLateCancels: 0, historyMultiplier: r.mult,
      kind: r.kind, attendanceAllowance: r.attendance, transportAllowance: r.transport,
      totalAmount: r.total, ruleBreakdown: r.breakdown, status: 'SUGGESTED',
    }));
  }

  // —— 案例 2：雷霆人力开工前 40 分钟取消安保岗，工人已到场，企业拒付 → 仲裁中（待客服裁决） ——
  const arbJob = mkCancelled(risky, {
    title: '紧急·演唱会安检安保（企业拒付赔付，仲裁中）', industry: 'SECURITY',
    location: '上海市徐汇区滨江音乐公园 2 号门',
    dailyWage: 320, startInMin: 40, headcount: 1,
    cancelReason: '演唱会临时改期',
  });
  await jobs.save(arbJob);
  // 保证金 1200：临期取消罚 50%=600（净影响余额 -600，冻结已回落）
  risky.depositBalance = Number(risky.depositBalance) - 600;

  const arbA = await assignments.save(assignments.create({
    jobId: arbJob.id, workerId: worker4.id, status: 'CANCELLED', riskAcknowledged: true,
    appliedAt: new Date(), acceptedAt: new Date(), ratingSnapshot: 5, completedJobsCount: 5,
  }));
  await policies.save(policies.create({
    assignmentId: arbA.id, jobId: arbJob.id, workerId: worker4.id, enterpriseId: risky.id,
    insurerProduct: '安保人员高危意外险', coverageWan: 50, premium: 12.8,
    status: 'VOID', jobRiskLevel: 5, enterpriseConfirmed: true,
  }));
  const arbLat = 31.2308, arbLng = 121.4744;
  await pings.save(pings.create({
    assignmentId: arbA.id, jobId: arbJob.id, workerId: worker4.id,
    lat: arbLat, lng: arbLng,
    distanceMeters: haversineMeters(arbLat, arbLng, SITE_LAT, SITE_LNG), bucket: 'ON_SITE',
  }));
  const supportUser = await users.findOne({ where: { username: 'support' } });
  await comps.save(comps.create({
    jobId: arbJob.id, assignmentId: arbA.id, workerId: worker4.id, enterpriseId: risky.id,
    cancelledAt: new Date(), minutesToStart: 40,
    noticeTier: 'LT_1H', noticeTierLabel: '开工前 1 小时内（含 0.5 小时）',
    locationBucket: 'ON_SITE', distanceMeters: haversineMeters(arbLat, arbLng, SITE_LAT, SITE_LNG),
    checkedIn: false, priorLateCancels: 3, historyMultiplier: 1.5,
    kind: 'ATTENDANCE_TRANSPORT', attendanceAllowance: 160, transportAllowance: 30, totalAmount: 190,
    ruleBreakdown:
      '【通知时间】开工前 40 分钟取消 → 开工前 1 小时内档\n' +
      '【工人位置】已到达现场（距签到点约 90m）\n【签到状态】尚未签到岗位即取消\n' +
      '【历史取消】该企业此前临期取消并赔付 3 次 → 补偿倍率 ×1.5\n' +
      '【建议金额】到场补贴 ¥160（日结320×50%×1.0→企业主张按 1.0；系统建议 1.5 倍为 ¥240，取保守建议 ¥160）+ 交通 ¥30 = ¥190',
    status: 'ARBITRATION',
    enterpriseDecidedAt: new Date(), enterpriseDecidedBy: risky.accountUserId,
    enterpriseNote: '企业拒付：活动改期属不可抗力，且工人尚未签到，不同意支付到场补贴。',
  }));

  // —— 案例 3：雷霆人力历史拒付败诉（已结案）→ 保证金附加 +0.5 倍、排序罚分已生效 ——
  const doneJob = mkCancelled(risky, {
    title: '上月·展会引导员临时取消（仲裁已判企业有责）', industry: 'EXHIBITION',
    location: '上海市青浦区国家会展中心',
    dailyWage: 300, startInMin: -60 * 24 * 30, headcount: 1,
    cancelReason: '展位商撤展',
  });
  await jobs.save(doneJob);
  const doneA = await assignments.save(assignments.create({
    jobId: doneJob.id, workerId: worker3.id, status: 'CANCELLED', riskAcknowledged: true,
    appliedAt: new Date(), acceptedAt: new Date(), ratingSnapshot: 5, completedJobsCount: 1,
  }));
  await policies.save(policies.create({
    assignmentId: doneA.id, jobId: doneJob.id, workerId: worker3.id, enterpriseId: risky.id,
    insurerProduct: '高危作业人员意外险·搭建专项', coverageWan: 30, premium: 9,
    status: 'VOID', jobRiskLevel: 5, enterpriseConfirmed: true,
  }));
  await pings.save(pings.create({
    assignmentId: doneA.id, jobId: doneJob.id, workerId: worker3.id,
    lat: 31.2315, lng: 121.4737, distanceMeters: 120, bucket: 'ON_SITE',
  }));
  await comps.save(comps.create({
    jobId: doneJob.id, assignmentId: doneA.id, workerId: worker3.id, enterpriseId: risky.id,
    cancelledAt: new Date(Date.now() - 30 * 86400000), minutesToStart: 35,
    noticeTier: 'LT_1H', noticeTierLabel: '开工前 1 小时内（含 0.5 小时）',
    locationBucket: 'ON_SITE', distanceMeters: 120, checkedIn: false,
    priorLateCancels: 2, historyMultiplier: 1.2,
    kind: 'ATTENDANCE_TRANSPORT', attendanceAllowance: 180, transportAllowance: 30, totalAmount: 180,
    ruleBreakdown: '历史案例：开工前 35 分钟取消，工人已到场。仲裁按到场补贴 ¥150 + 交通 ¥30 裁决。',
    status: 'ARBITRATION_AWARD_PAY',
    enterpriseDecidedAt: new Date(Date.now() - 30 * 86400000), enterpriseDecidedBy: risky.accountUserId,
    enterpriseNote: '拒付：工人未签到。',
    arbitratedBy: supportUser?.id ?? null, arbitratedAt: new Date(Date.now() - 29 * 86400000),
    arbitrationAward: '裁决企业有责：位置心跳证明工人已到场 120m，企业临期取消事实成立。按建议 ¥180 从保证金扣付工人；' +
      '并对该企业后续发单保证金附加 +0.5 倍、岗位排序降权。',
    awardedAmount: 180, workerNotifiedAt: new Date(Date.now() - 29 * 86400000),
    paidAt: new Date(Date.now() - 29 * 86400000),
    surchargeApplied: true, rankPenaltyApplied: true,
  }));
  // 雷霆拒付败诉后果落到企业画像
  risky.arbitrationLostCount = Number(risky.arbitrationLostCount) + 1;
  risky.depositSurchargeRate = 0.5;
  risky.rankPenalty = Number(risky.rankPenalty) + 8;
  // 历史已结案取消岗的保证金罚没 50%（450）+ 仲裁判付工人（180）
  risky.depositBalance = Number(risky.depositBalance) - 450 - 180;
  await enterprises.save(risky);
  await enterprises.save(ent1);

  console.log('[seed] 种子数据完成：worker1/worker2/worker3/worker4/enterprise1/supervisor1/enterprise_risky/support，密码均为 123456');
}

if (require.main === module) {
  runSeed()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
