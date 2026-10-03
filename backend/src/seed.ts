import { DataSource } from 'typeorm';
import { hash } from 'bcryptjs';
import { config } from './config';
import {
  User, Enterprise, Job, Assignment, AttendanceEvent, InsurancePolicy,
  JobEvent, InjuryClaim, ChatMessage, Settlement, Appeal, Review, CancelCompensation,
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
      JobEvent, InjuryClaim, ChatMessage, Settlement, Appeal, Review, CancelCompensation,
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
  const worker3 = await users.save(users.create({
    username: 'worker3', passwordHash: pwd, name: '王五', phone: '13800000003', role: 'WORKER',
    idCardNo: '310101199208154321', idVerifiedAt: new Date(),
    healthCertUntil: '2027-06-30', faceSampleUrl: 'seed://face-wangwu',
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

  const sup1 = await users.save(users.create({
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
  // 取消赔付演示场景：开工前半小时的盘点任务，一名工人在路上、一名工人已签到到场
  const job7 = mk(ent1, {
    title: '华润万家·月末盘点突击', industry: 'INVENTORY',
    location: '上海市浦东新区张江华润万家超市',
    description: '月末库存盘点，扫码录入、货架核对。开工前半小时可演示企业临时取消赔付全流程。',
    dailyWage: 200, mealAllowance: 15,
    startTime: iso(30), endTime: iso(60 * 6), headcount: 2,
    status: 'IN_PROGRESS',
  });
  const created = await jobs.save([job1, job2, job3, job4, job5, job6, job7]);

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

  // ---------- 取消赔付演示场景：开工前半小时的盘点任务 ----------
  // 张三已出发在路上（约 4.3km），王五已签到到场；企业取消后平台将分别生成交通补贴与到场补贴建议
  const assignments = source.getRepository(Assignment);
  const attendance = source.getRepository(AttendanceEvent);
  const policies = source.getRepository(InsurancePolicy);
  const cancelDemoJob = created[6];

  const enRouteLat = 31.2304;
  const enRouteLng = 121.4287; // 距签到点约 4.3km
  const a1 = await assignments.save(assignments.create({
    jobId: cancelDemoJob.id, workerId: worker1.id, status: 'ACCEPTED',
    riskAcknowledged: true, appliedAt: iso(-120), acceptedAt: iso(-100),
    ratingSnapshot: 5, completedJobsCount: 0,
  }));
  await attendance.save(attendance.create({
    assignmentId: a1.id, jobId: cancelDemoJob.id, workerId: worker1.id,
    kind: 'EN_ROUTE', locationPassed: false,
    lat: enRouteLat, lng: enRouteLng,
    distanceMeters: haversineMeters(enRouteLat, enRouteLng, Number(cancelDemoJob.lat), Number(cancelDemoJob.lng)),
    facePassed: false, supervisorConfirmed: false, qrcodePassed: false,
    secondConfirmed: false, allPassed: false, failReason: null,
    eventTime: iso(-20),
  }));
  await policies.save(policies.create({
    assignmentId: a1.id, jobId: cancelDemoJob.id, workerId: worker1.id, enterpriseId: ent1.id,
    insurerProduct: '雇主责任险·通用A款', coverageWan: cancelDemoJob.insuranceCoverageWan,
    premium: cancelDemoJob.insurancePremium, status: 'PENDING', jobRiskLevel: 1, enterpriseConfirmed: true,
  }));

  const a2 = await assignments.save(assignments.create({
    jobId: cancelDemoJob.id, workerId: worker3.id, status: 'WORKING',
    riskAcknowledged: true, appliedAt: iso(-130), acceptedAt: iso(-110),
    ratingSnapshot: 5, completedJobsCount: 0,
  }));
  const checkIn = await attendance.save(attendance.create({
    assignmentId: a2.id, jobId: cancelDemoJob.id, workerId: worker3.id,
    kind: 'CHECK_IN', locationPassed: true,
    lat: Number(cancelDemoJob.lat), lng: Number(cancelDemoJob.lng), distanceMeters: 5,
    facePassed: true, faceScore: 95,
    supervisorConfirmed: true, confirmedBySupervisorId: sup1.id, confirmedAt: iso(-8),
    qrcodePassed: true, qrcodeToken: 'SEEDDEMO',
    secondConfirmed: false, allPassed: true, failReason: null,
    eventTime: iso(-8),
  }));
  await policies.save(policies.create({
    assignmentId: a2.id, jobId: cancelDemoJob.id, workerId: worker3.id, enterpriseId: ent1.id,
    insurerProduct: '雇主责任险·通用A款', coverageWan: cancelDemoJob.insuranceCoverageWan,
    premium: cancelDemoJob.insurancePremium, status: 'ACTIVE',
    effectiveFrom: iso(-8), activatedByAttendanceId: checkIn.id,
    jobRiskLevel: 1, enterpriseConfirmed: true,
  }));

  console.log('[seed] 种子数据完成：worker1/worker2/worker3/enterprise1/supervisor1/enterprise_risky/support，密码均为 123456');
}

if (require.main === module) {
  runSeed()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
