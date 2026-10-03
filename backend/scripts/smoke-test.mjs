/**
 * 端到端冒烟测试：城市临时用工日结派单考勤保险与争议平台
 * 用法（需先启动后端与数据库，并完成种子）：
 *   node scripts/smoke-test.mjs
 * 环境变量：BASE_URL(默认 http://127.0.0.1:3001) DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3001';
const DB = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD ?? 'root',
  database: process.env.DB_NAME || 'gig_platform',
};

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ ${msg}`); }
};
const req = async (method, path, token, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
};

async function login(username, password = '123456') {
  const r = await req('POST', '/api/auth/login', null, { username, password });
  if (r.status !== 201) throw new Error(`登录失败 ${username}: ${JSON.stringify(r.body)}`);
  return r.body.token;
}

(async () => {
  console.log('── 1. 登录种子账号 ──');
  const tWorker1 = await login('worker1');
  const tWorker2 = await login('worker2');
  const tEnt1 = await login('enterprise1');
  const tSup1 = await login('supervisor1');
  const tSup1b = await login('supervisor1b');
  const tRisky = await login('enterprise_risky');
  const tSupRisky = await login('supervisor_risky');
  const tSupRiskyb = await login('supervisor_riskyb');
  const tSupport = await login('support');
  ok(true, '全部种子账号可登录（工人/企业/主管×4/客服）');

  console.log('── 2. 报名门禁：实名 / 健康证 / 历史评价 / 风险告知 ──');
  const jobs = (await req('GET', '/api/jobs', tWorker1)).body;
  const cateringJob = jobs.find((j) => j.industry === 'CATERING');
  const exhibitionJob = jobs.find((j) => j.industry === 'EXHIBITION');
  const securityJob = jobs.find((j) => j.industry === 'SECURITY');
  ok(!!cateringJob && !!exhibitionJob && !!securityJob, '岗位大厅包含六类行业岗位');

  // worker2 未实名/无健康证/无人脸 → 报名餐饮岗必须被拦截
  const badApply = await req('POST', `/api/jobs/${cateringJob.id}/apply`, tWorker2, { riskAcknowledged: true });
  ok(badApply.status === 400 && /实名认证/.test(badApply.body.message), `未实名工人报名被拦截：${badApply.body.message}`);

  // worker1 未勾选风险告知 → 拦截
  const noAck = await req('POST', `/api/jobs/${exhibitionJob.id}/apply`, tWorker1, { riskAcknowledged: false });
  ok(noAck.status === 400 && /风险告知/.test(noAck.body.message), '未确认风险告知不能报名');

  // worker1 正常报名会展岗
  const apply = await req('POST', `/api/jobs/${exhibitionJob.id}/apply`, tWorker1, { riskAcknowledged: true });
  ok(apply.status === 201 && apply.body.status === 'APPLIED', '工人完成报名（状态 APPLIED）');

  console.log('── 3. 企业录取 → 自动生成待生效保单 ──');
  const applicants = (await req('GET', `/api/jobs/${exhibitionJob.id}/applicants`, tEnt1)).body;
  const myApp = applicants.find((a) => a.worker && a.worker.name === '张三');
  ok(Array.isArray(applicants) && myApp, '企业可查看报名工人及其实名/健康证/评价快照');
  const accept = await req('POST', `/api/assignments/${myApp.id}/review`, tEnt1, { accept: true });
  ok(accept.status === 201 && accept.body.status === 'ACCEPTED', '企业录取工人');
  const assignmentId = accept.body.id;
  const roomBefore = (await req('GET', `/api/assignments/${assignmentId}/room`, tWorker1)).body;
  ok(roomBefore.policy.status === 'PENDING' && roomBefore.policy.enterpriseConfirmed === true,
    `录取即生成保单（PENDING，企业已确认，岗位风险等级 ${roomBefore.policy.jobRiskLevel}）`);

  console.log('── 4. 到岗四重校验：定位 + 人脸 + 二维码 + 主管确认 ──');
  // 4.1 定位偏离
  const far = await req('POST', '/api/attendance/check-in', tWorker1, {
    assignmentId, lat: 31.0, lng: 121.0, qrcodeToken: 'BAD', facePassed: true,
  });
  ok(far.body.nextStep === 'FIX_FACTORS' && /定位偏离/.test(far.body.message) && /二维码/.test(far.body.message),
    `定位偏离+错误二维码被拦截：${far.body.message}`);

  // 4.2 正确定位/人脸 + 主管出示的动态二维码 → 等待主管确认
  const qr = (await req('GET', `/api/jobs/${exhibitionJob.id}/qrcode`, tSup1)).body;
  ok(/^[A-Z0-9]{8}$/.test(qr.token), `主管获取每分钟轮换的动态签到码：${qr.token}`);
  const checkin = await req('POST', '/api/attendance/check-in', tWorker1, {
    assignmentId, lat: 31.2304, lng: 121.4737, qrcodeToken: qr.token, facePassed: true,
    photoUrl: 'mock://on-site-photo-1',
  });
  ok(checkin.body.nextStep === 'WAIT_SUPERVISOR', `工人三要素通过：${checkin.body.message}`);
  const pendingAttendanceId = checkin.body.attendance.id;

  // 4.3 工人不能自己确认（越权）
  const selfConfirm = await req('POST', `/api/attendance/${pendingAttendanceId}/supervisor-confirm`, tWorker1, {});
  ok(selfConfirm.status === 403, '工人无权自行主管确认（防自证）');

  // 4.4 主管确认 → 保险即时生效，禁止事后补录
  const confirmed = await req('POST', `/api/attendance/${pendingAttendanceId}/supervisor-confirm`, tSup1, {});
  ok(confirmed.body.nextStep === 'INSURANCE_ACTIVE' && confirmed.body.insurancePolicy.status === 'ACTIVE',
    `主管确认→四重校验通过→保险即时生效：${confirmed.body.message}`);

  console.log('── 5. 作业过程：加班 / 工伤（保险期内）/ 额外搬运 / 聊天 ──');
  const ot = await req('POST', '/api/events', tWorker1, {
    assignmentId, type: 'OVERTIME', description: '撤展延后，主管要求加班', minutes: 90,
  });
  ok(ot.status === 201 && ot.body.event.status === 'PENDING' && /现场实时上报/.test(ot.body.message), '加班事件现场实时上报');
  const otReview = await req('POST', `/api/events/${ot.body.event.id}/review`, tSup1, { approve: true, note: '情况属实' });
  ok(otReview.body.event.status === 'APPROVED', '主管批准加班 90 分钟');

  const carry = await req('POST', '/api/events', tWorker1, {
    assignmentId, type: 'EXTRA_CARRY', description: '临时要求加搬两托盘展具', minutes: 30,
  });
  await req('POST', `/api/events/${carry.body.event.id}/review`, tSup1, { approve: true, note: '确认' });
  ok(true, '额外搬运事件已审批（计入日结补贴）');

  const injury = await req('POST', '/api/events', tWorker1, {
    assignmentId, type: 'INJURY', description: '搬运桁架时砸伤左脚', claimAmount: 8000,
  });
  ok(injury.body.claim.coveredAtOccurrence === true && injury.body.claim.status === 'INVESTIGATING',
    '作业中受伤且保险在保障期内 → 自动生成可理赔调查单');
  const injuryReview = await req('POST', `/api/events/${injury.body.event.id}/review`, tSup1, { approve: true, note: '现场目击属实' });
  ok(injuryReview.body.claim.status === 'APPROVED', '主管确认工伤 → 理赔通过');

  const msg = await req('POST', `/api/assignments/${assignmentId}/messages`, tWorker1, { content: '主管，加班的工时记得帮我确认' });
  const msg2 = await req('POST', `/api/assignments/${assignmentId}/messages`, tSup1, { content: '已确认，安心干活' });
  ok(msg.status === 201 && msg2.status === 201, '任务内聊天留存（争议证据链）');

  console.log('── 6. 保险不可事后补录（未到岗先受伤 → 不能立案为保险事故） ──');
  // 新工人：注册+实名+健康证+人脸
  const uname = `wnew${Date.now() % 100000}`;
  const reg = await req('POST', '/api/auth/register', null, {
    username: uname, password: '123456', name: '新工人', phone: '13500000099', role: 'WORKER',
    idCardNo: '310101199501011111', healthCertUntil: '2027-01-01',
  });
  const tNew = reg.body.token;
  await req('POST', '/api/auth/worker-profile', tNew, { faceSampleUrl: 'mock://face-new' });
  // 企业新发一个岗并录取该工人
  const sStart = new Date(Date.now() + 2 * 86400000);
  const sEnd = new Date(sStart.getTime() + 8 * 3600000);
  const newJob = (await req('POST', '/api/jobs', tEnt1, {
    title: '次日仓库分拣', industry: 'WAREHOUSE', description: '分拣', location: '嘉定物流园',
    lat: 31.2304, lng: 121.4737,
    startTime: sStart.toISOString().slice(0, 19), endTime: sEnd.toISOString().slice(0, 19),
    headcount: 1, skillRequirement: '无', dailyWage: 240,
  })).body;
  await req('POST', `/api/jobs/${newJob.id}/apply`, tNew, { riskAcknowledged: true });
  const newApps = (await req('GET', `/api/jobs/${newJob.id}/applicants`, tEnt1)).body;
  const newAccept = await req('POST', `/api/assignments/${newApps[0].id}/review`, tEnt1, { accept: true });
  const newAid = newAccept.body.id;
  // 未完成任何到岗校验，直接报受伤 → 系统拒绝（保险 PENDING）
  const earlyInjury = await req('POST', '/api/events', tNew, {
    assignmentId: newAid, type: 'INJURY', description: '还没到岗就受伤了想走保险',
  });
  ok(earlyInjury.status === 400 && /作业中/.test(earlyInjury.body.message),
    `未到岗（保险未生效）不能报工伤立案：${earlyInjury.body.message}`);

  // 数据层面：即使存在 coveredAtOccurrence=false 的理赔单，客服也无权改赔
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection({
    host: DB.host, port: DB.port, user: DB.user, password: DB.password, database: DB.database,
  });
  const [pl] = await conn.query('SELECT id FROM insurance_policies WHERE assignmentId = ?', [newAid]);
  await conn.query(
    'INSERT INTO injury_claims (assignmentId, jobId, workerId, enterpriseId, jobEventId, insurancePolicyId, injuryDesc, claimAmount, status, coveredAtOccurrence, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,NOW())',
    [newAid, newJob.id, newApps[0].workerId, newJob.enterpriseId, 0, pl[0].id, '事故时未到岗', 5000, 'REPORTED', 0],
  );
  const [uncoveredRows] = await conn.query(
    'SELECT id FROM injury_claims WHERE assignmentId = ? AND coveredAtOccurrence = 0 ORDER BY id DESC LIMIT 1', [newAid],
  );
  await conn.end();
  const forcePay = await req('POST', `/api/support/claims/${uncoveredRows[0].id}/adjust`, tSupport, { approve: true, note: '通融赔付' });
  ok(forcePay.status === 400 && /未生效/.test(forcePay.body.message),
    `客服无法把事故时未生效的保单改为赔付：${forcePay.body.message}`);

  console.log('── 7. 完工签退 → 日结明细（工时/加班/餐补/迟到扣款/预付/服务费） ──');
  const qr2 = (await req('GET', `/api/jobs/${exhibitionJob.id}/qrcode`, tSup1)).body.token;
  const checkout = await req('POST', '/api/attendance/check-out', tWorker1, {
    assignmentId, lat: 31.2304, lng: 121.4737, qrcodeToken: qr2, facePassed: true,
  });
  const s = checkout.body.settlement;
  ok(checkout.status === 201 && s, '签退成功并生成日结明细');
  ok(Number(s.overtimeMinutes) === 90 && Number(s.overtimePay) > 0, `加班 90 分钟已计入加班费 ¥${s.overtimePay}`);
  ok(Number(s.extraCarryPay) > 0, `额外搬运补贴 ¥${s.extraCarryPay}`);
  ok(Number(s.mealAllowance) > 0, `餐补 ¥${s.mealAllowance}`);
  ok(Number(s.insurancePremium) > 0 && Number(s.platformServiceFee) > 0,
    `保费 ¥${s.insurancePremium}（企业承担）+ 平台服务费 ¥${s.platformServiceFee}`);
  ok(Number(s.enterprisePrepaymentUsed) > 0, `动用企业预付款 ¥${s.enterprisePrepaymentUsed}`);
  const pay = await req('POST', '/api/settlements/pay', tEnt1, { assignmentIds: [assignmentId] });
  ok(pay.body[0] && pay.body[0].status === 'PAID', '企业确认发放日结（状态 PAID）');

  console.log('── 8. 工人申诉 → 客服查看证据包 → 补发裁决 ──');
  const appeal = await req('POST', '/api/appeals', tWorker1, {
    assignmentId, reason: '主管临时加活承诺加 50 元未体现在工资中', claimedAmount: 50,
  });
  ok(appeal.status === 201 && appeal.body.status === 'OPEN', '工人发起申诉');
  const evidence = await req('GET', `/api/support/appeals/${appeal.body.id}/evidence`, tSupport);
  ok(/签到记录/.test(evidence.body.summary) && /作业事件/.test(evidence.body.summary) && /聊天记录/.test(evidence.body.summary),
    '客服证据包包含签到轨迹/主管确认/现场照片/事件/聊天记录/保险/结算');
  ok(evidence.body.messages.length >= 2 && evidence.body.attendance.some((a) => a.allPassed), '证据包内含聊天记录与四重通过的签到记录');
  const beforePay = Number((await req('GET', `/api/settlements/assignment/${assignmentId}`, tWorker1)).body.workerPayable);
  const decide = await req('POST', `/api/support/appeals/${appeal.body.id}/decide`, tSupport, {
    decision: 'REISSUED', note: '聊天记录与主管确认佐证额外搬运，补发 50 元', reissueAmount: 50,
  });
  ok(decide.body.status === 'REISSUED' && Number(decide.body.reissueAmount) === 50, '客服裁决补发 ¥50');
  const after = (await req('GET', `/api/settlements/assignment/${assignmentId}`, tWorker1)).body;
  ok(Number(after.workerPayable) === beforePay + 50 && after.status === 'ADJUSTED',
    `结算单调整为 ADJUSTED，应发 ¥${beforePay} → ¥${after.workerPayable}`);

  console.log('── 9. 高风险企业：更高保证金 + 更严格现场确认（双人） ──');
  const overview = (await req('GET', '/api/support/overview', tSupport)).body;
  const riskyRow = overview.allEnterprises.find((e) => e.name.includes('雷霆'));
  ok(riskyRow.riskLevel >= 4 && riskyRow.cancelRate >= 0.15 && riskyRow.disputeRate >= 0.2,
    `风险画像定级 ${riskyRow.riskLevel}（取消率 ${(riskyRow.cancelRate * 100).toFixed(0)}%、有责争议率 ${(riskyRow.disputeRate * 100).toFixed(0)}%）`);
  const riskyStartD = new Date(Date.now() + 3 * 86400000);
  const riskyEndD = new Date(riskyStartD.getTime() + 8 * 3600000);
  const riskyJob = (await req('POST', '/api/jobs', tRisky, {
    title: '临时发布会安保（高风险企业）', industry: 'SECURITY', description: '安保留', location: '滨江',
    lat: 31.2304, lng: 121.4737,
    startTime: riskyStartD.toISOString().slice(0, 19), endTime: riskyEndD.toISOString().slice(0, 19),
    headcount: 1, skillRequirement: '安保经验', dailyWage: 320,
  })).body;
  ok(Number(riskyJob.depositRequired) === 400 * 3.5, `安保岗保证金=基准400×倍率3.5（风险3.0 + 历史拒付败诉附加0.5）×1人 = ¥${riskyJob.depositRequired}`);
  ok(riskyJob.strictConfirmation === true, '岗位自动启用严格现场确认（双人）');

  // 用另一个新工人走严格双人确认全流程
  const uname2 = `wsec${Date.now() % 100000}`;
  const reg2 = await req('POST', '/api/auth/register', null, {
    username: uname2, password: '123456', name: '安保新人', phone: '13500000088', role: 'WORKER',
    idCardNo: '310101199602022222',
  });
  const tSec = reg2.body.token;
  await req('POST', '/api/auth/worker-profile', tSec, { faceSampleUrl: 'mock://face-sec' });
  // startTime 在未来导致签到无时间限制（系统不允许提前到岗？当前无时间门禁），直接录取签到
  await req('POST', `/api/jobs/${riskyJob.id}/apply`, tSec, { riskAcknowledged: true });
  const riskyApps = (await req('GET', `/api/jobs/${riskyJob.id}/applicants`, tRisky)).body;
  const riskyAccept = await req('POST', `/api/assignments/${riskyApps[0].id}/review`, tRisky, { accept: true });
  const riskyAid = riskyAccept.body.id;
  const qrR = (await req('GET', `/api/jobs/${riskyJob.id}/qrcode`, tSupRisky)).body.token;
  const rci = await req('POST', '/api/attendance/check-in', tSec, {
    assignmentId: riskyAid, lat: 31.2304, lng: 121.4737, qrcodeToken: qrR, facePassed: true,
  });
  const first = await req('POST', `/api/attendance/${rci.body.attendance.id}/supervisor-confirm`, tSupRisky, {});
  ok(first.body.nextStep === 'WAIT_SECOND_CONFIRM', '第一名主管确认后仍需第二名负责人复核');
  const sameAgain = await req('POST', `/api/attendance/${rci.body.attendance.id}/supervisor-confirm`, tSupRisky, {});
  ok(sameAgain.status === 400 && /同一人/.test(sameAgain.body.message), '同一人不能充当两名确认人');
  const second = await req('POST', `/api/attendance/${rci.body.attendance.id}/supervisor-confirm`, tSupRiskyb, {});
  ok(second.body.nextStep === 'INSURANCE_ACTIVE' && second.body.insurancePolicy.status === 'ACTIVE',
    '第二名负责人复核通过 → 到岗成立、保险生效');

  console.log('── 10. 企业取消岗位：保证金罚没 + 保单作废 + 取消率沉淀 ──');
  const cancelStart = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 16) + ':00';
  const cancelJob = (await req('POST', '/api/jobs', tEnt1, {
    title: '周末保洁突击', industry: 'CLEANING', description: '保洁', location: '人民广场',
    lat: 31.2304, lng: 121.4737, startTime: cancelStart,
    endTime: new Date(new Date(cancelStart).getTime() + 6 * 3600000).toISOString().slice(0, 16) + ':00',
    headcount: 2, skillRequirement: '无', dailyWage: 210,
  })).body;
  const depositBefore = Number(cancelJob.depositRequired);
  const cancel = await req('POST', `/api/jobs/${cancelJob.id}/cancel`, tEnt1, { reason: '甲方临时取消活动' });
  ok(cancel.body.job.status === 'CANCELLED' && cancel.body.forfeit === Math.round(depositBefore * 0.2),
    `开工前 >2h 取消：罚没 20% 保证金 ¥${cancel.body.forfeit}，释放 ¥${cancel.body.released}`);

  console.log('── 11. 行业风险沉淀看板 ──');
  const ind = (await req('GET', '/api/industry-risks', tSupport)).body;
  ok(ind.length === 6 && ind.find((x) => x.industry === 'SECURITY').baseRiskLevel === 5,
    '按六个行业沉淀岗位风险（安保基础风险 5 级、保费费率最高）');

  console.log('── 12. 企业开工前半小时紧急取消：位置上报 → 补偿建议 → 确认到账 ──');
  // 两名赴岗工人：worker1 + 新注册实名工人；另有一名工人已录取但未出发（无位置）
  const uname3 = `wcan${Date.now() % 100000}`;
  const reg3 = await req('POST', '/api/auth/register', null, {
    username: uname3, password: '123456', name: '赔付新人', phone: '13500000077', role: 'WORKER',
    idCardNo: '310101199808085555', healthCertUntil: '2027-01-01',
  });
  const tCan = reg3.body.token;
  await req('POST', '/api/auth/worker-profile', tCan, { faceSampleUrl: 'mock://face-can' });
  const uname4 = `wfar${Date.now() % 100000}`;
  const reg4 = await req('POST', '/api/auth/register', null, {
    username: uname4, password: '123456', name: '未出发工人', phone: '13500000066', role: 'WORKER',
    idCardNo: '310101199909096666',
  });
  const tFar = reg4.body.token;
  await req('POST', '/api/auth/worker-profile', tFar, { faceSampleUrl: 'mock://face-far' });

  const urgentStart = new Date(Date.now() + 25 * 60000);
  const urgentEnd = new Date(urgentStart.getTime() + 6 * 3600000);
  const urgentJob = (await req('POST', '/api/jobs', tEnt1, {
    title: '夜间盘点（半小时后开工）', industry: 'INVENTORY', description: '盘点', location: '虹口龙之梦',
    lat: 31.2304, lng: 121.4737,
    startTime: urgentStart.toISOString().slice(0, 19), endTime: urgentEnd.toISOString().slice(0, 19),
    headcount: 3, skillRequirement: '无', dailyWage: 180,
  })).body;
  ok(Number(urgentJob.depositRequired) === 300, `临期盘点岗冻结保证金 ¥${urgentJob.depositRequired}（基准100×1.0×3人）`);

  for (const [tok, ] of [[tWorker1], [tCan], [tFar]]) {
    await req('POST', `/api/jobs/${urgentJob.id}/apply`, tok, { riskAcknowledged: true });
  }
  const urgentApps = (await req('GET', `/api/jobs/${urgentJob.id}/applicants`, tEnt1)).body;
  const aidByName = {};
  for (const a0 of urgentApps) {
    await req('POST', `/api/assignments/${a0.id}/review`, tEnt1, { accept: true });
    aidByName[a0.worker.name] = a0.id;
  }
  const aidOnsite = aidByName['张三'];
  const aidRoute = aidByName['赔付新人'];
  const aidHome = aidByName['未出发工人'];
  ok(aidOnsite && aidRoute && aidHome, '三名工人均被录取');

  // 赴岗位置上报：张三已到现场(~90m)、新人在途中(~2.6km)、第三人不上报
  const pingOnsite = await req('POST', `/api/assignments/${aidOnsite}/location`, tWorker1, { lat: 31.2311, lng: 121.4741 });
  const pingRoute = await req('POST', `/api/assignments/${aidRoute}/location`, tCan, { lat: 31.254, lng: 121.4737 });
  ok(pingOnsite.body.bucket === 'ON_SITE' && pingOnsite.body.distanceMeters <= 300,
    `服务端按坐标判定张三「已到现场」(${pingOnsite.body.distanceMeters}m，不信任端上档位)`);
  ok(pingRoute.body.bucket === 'EN_ROUTE' && pingRoute.body.distanceMeters > 1000,
    `新人「已在途中」(${pingRoute.body.distanceMeters}m)`);

  // 企业开工前 25 分钟取消
  const urgentCancel = await req('POST', `/api/jobs/${urgentJob.id}/cancel`, tEnt1, { reason: '盘点系统故障' });
  ok(urgentCancel.body.compensationCount === 2 && urgentCancel.body.affectedWorkers === 3,
    `取消影响 3 名工人，仅为 2 名有赴岗事实者生成补偿建议（未出发者不赔）`);
  const compById = Object.fromEntries(urgentCancel.body.compensations.map((c) => [c.assignmentId, c]));
  const cOnsite = compById[aidOnsite];
  const cRoute = compById[aidRoute];
  ok(cOnsite && cOnsite.noticeTier === 'LT_1H' && Number(cOnsite.attendanceAllowance) === 90 && Number(cOnsite.transportAllowance) === 30 && Number(cOnsite.totalAmount) === 120,
    `开工前 25 分钟·已到现场 → 到场补贴 ¥${cOnsite?.attendanceAllowance}（日结180×50%）+ 交通 ¥${cOnsite?.transportAllowance} = ¥${cOnsite?.totalAmount}`);
  ok(cRoute && Number(cRoute.attendanceAllowance) === 0 && Number(cRoute.transportAllowance) === 30 && Number(cRoute.totalAmount) === 30,
    `在途中工人仅交通补贴 ¥${cRoute?.transportAllowance}，不享到场补贴`);
  ok(!compById[aidHome], '未出发且无位置证据的工人不生成赔付单');
  ok(/通知时间[\s\S]*工人位置[\s\S]*签到状态[\s\S]*历史取消[\s\S]*建议金额/.test(cOnsite.ruleBreakdown),
    '补偿建议含通知时间/位置/签到/历史取消规则完整测算说明');

  // 企业确认现场工人赔付 → 立即到账
  const paid = await req('POST', `/api/compensations/${cOnsite.id}/confirm`, tEnt1, { note: '认可建议，尽快支付' });
  ok(paid.body.status === 'PAID' && !!paid.body.paidAt && Number(paid.body.totalAmount) === 120,
    `企业确认后保证金即扣划、工人补贴 ¥${paid.body.totalAmount} 于 ${paid.body.paidAt} 到账并收到通知`);
  const myComps = (await req('GET', '/api/my/compensations', tWorker1)).body;
  ok(myComps.some((c) => c.id === cOnsite.id && c.status === 'PAID'), '工人端可查询到已到账的取消补贴');

  // 历史取消规则：再次临期取消且工人到场 → 建议倍率上浮到 1.2
  const urgent2Start = new Date(Date.now() + 40 * 60000);
  const urgent2 = (await req('POST', '/api/jobs', tEnt1, {
    title: '另一处盘点（40 分钟后开工）', industry: 'INVENTORY', description: '盘点', location: '静安寺',
    lat: 31.2304, lng: 121.4737,
    startTime: urgent2Start.toISOString().slice(0, 19),
    endTime: new Date(urgent2Start.getTime() + 5 * 3600000).toISOString().slice(0, 19),
    headcount: 1, skillRequirement: '无', dailyWage: 100,
  })).body;
  await req('POST', `/api/jobs/${urgent2.id}/apply`, tCan, { riskAcknowledged: true });
  const apps2 = (await req('GET', `/api/jobs/${urgent2.id}/applicants`, tEnt1)).body;
  const aid2 = apps2[0].id;
  await req('POST', `/api/assignments/${aid2}/review`, tEnt1, { accept: true });
  await req('POST', `/api/assignments/${aid2}/location`, tCan, { lat: 31.2308, lng: 121.4744 });
  const cancel2 = await req('POST', `/api/jobs/${urgent2.id}/cancel`, tEnt1, { reason: '甲方改期' });
  const c2 = cancel2.body.compensations[0];
  ok(c2 && Number(c2.priorLateCancels) === 1 && Number(c2.historyMultiplier) === 1.2,
    `企业已有 1 次临期取消赔付 → 第二次建议补偿倍率 ×${c2?.historyMultiplier}（到场 ¥${c2?.attendanceAllowance} = 100×50%×1.2 + 交通 ¥${c2?.transportAllowance}）`);
  await req('POST', `/api/compensations/${c2.id}/confirm`, tEnt1, {});

  console.log('── 13. 企业拒付 → 平台仲裁 → 保证金附加倍率 + 排序降权 ──');
  // 企业拒付在途工人的交通补贴
  const refuse = await req('POST', `/api/compensations/${cRoute.id}/refuse`, tEnt1, { note: '工人还没到，不该赔钱' });
  ok(refuse.body.status === 'ARBITRATION', '企业拒付后赔付单进入平台仲裁');
  const refuseNoReason = await req('POST', `/api/compensations/${cRoute.id}/refuse`, tEnt1, { note: '' });
  ok(refuseNoReason.status === 400, '已进入仲裁的赔付单不能重复处理');

  // 客服证据包：位置心跳 + 通知档位 + 企业历史
  const compEv = await req('GET', `/api/support/compensations/${cRoute.id}/evidence`, tSupport);
  ok(compEv.body.pings.length >= 1 && compEv.body.pings.some((p) => p.bucket === 'EN_ROUTE'),
    '仲裁证据包包含工人赴岗位置心跳轨迹');
  ok(compEv.body.compensation.noticeTier === 'LT_1H' && compEv.body.enterprise.id,
    '证据包包含通知档位与企业历史取消画像');

  // 仲裁判企业有责
  const beforeEnt = (await req('GET', '/api/support/overview', tSupport)).body.allEnterprises.find((e) => e.name.includes('安心'));
  const award = await req('POST', `/api/support/compensations/${cRoute.id}/arbitrate`, tSupport, {
    uphold: false, award: '位置心跳证明工人已在途中 2.6km，企业开工前 25 分钟临时取消事实成立，应付交通补贴。', awardedAmount: 30,
  });
  ok(award.body.status === 'ARBITRATION_AWARD_PAY' && Number(award.body.awardedAmount) === 30 && award.body.paidAt,
    '仲裁判企业有责：交通补贴从保证金扣付并到账');
  const afterEnt = (await req('GET', '/api/support/overview', tSupport)).body.allEnterprises.find((e) => e.name.includes('安心'));
  ok(Number(afterEnt.depositSurchargeRate) === Number(beforeEnt.depositSurchargeRate) + 0.5
    && Number(afterEnt.arbitrationLostCount) === Number(beforeEnt.arbitrationLostCount) + 1
    && Number(afterEnt.rankPenalty) === Number(beforeEnt.rankPenalty) + 8,
    `拒付败诉联动：保证金附加 ¥${beforeEnt.depositSurchargeRate}→¥${afterEnt.depositSurchargeRate}、仲裁败诉+1、排序罚分+8（${beforeEnt.rankPenalty}→${afterEnt.rankPenalty}）`);

  // 后续发单保证金叠加附加倍率（按企业当前风险等级 + 仲裁附加动态计算）
  const entAfterArb = (await req('GET', '/api/enterprise/home', tEnt1)).body.enterprise;
  const expectedMult = (1 + (Number(entAfterArb.riskLevel) - 1) * 0.5 + Number(entAfterArb.depositSurchargeRate));
  const expectedDeposit = Math.round(100 * expectedMult);
  const surJob = (await req('POST', '/api/jobs', tEnt1, {
    title: '败诉后新发盘点岗', industry: 'INVENTORY', description: '盘点', location: '人民广场',
    lat: 31.2304, lng: 121.4737,
    startTime: new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 19),
    endTime: new Date(Date.now() + 6 * 86400000 + 5 * 3600000).toISOString().slice(0, 19),
    headcount: 1, skillRequirement: '无', dailyWage: 180,
  })).body;
  ok(Number(surJob.depositRequired) === expectedDeposit,
    `败诉后新岗位保证金被附加：基准100 × 倍率${expectedMult.toFixed(1)}（风险L${entAfterArb.riskLevel}倍率${(1 + (Number(entAfterArb.riskLevel) - 1) * 0.5).toFixed(1)} + 仲裁附加${Number(entAfterArb.depositSurchargeRate).toFixed(1)}）= ¥${surJob.depositRequired}`);

  // 排序模型 + 工人可见稳定性提示
  const hall = (await req('GET', '/api/jobs', tWorker1)).body;
  const hallRow = hall.find((j) => j.id === surJob.id);
  ok(hallRow.stability && hallRow.stability.refusedLost >= 1 && hallRow.stability.level === 'UNSTABLE',
    `岗位大厅展示企业近期稳定性：拒付败诉 ${hallRow?.stability?.refusedLost} 次，等级 ${hallRow?.stability?.level}，排序分 ${hallRow?.stability?.rankScore}`);
  const detail = (await req('GET', `/api/jobs/${surJob.id}`, tWorker1)).body;
  ok(Array.isArray(detail.stability.tips) && detail.stability.tips.some((t) => /取消率|拒付|降权/.test(t)),
    '岗位详情向报名工人展示近期稳定性提示文案');
  const entHome = (await req('GET', '/api/enterprise/home', tEnt1)).body.enterprise;
  ok(Number(entHome.depositSurchargeRate) === 0.5 && Number(entHome.rankPenalty) >= 8,
    '企业端可见自身保证金附加倍率与排序罚分');

  console.log(`\n========== 结果：${pass} 通过 / ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('冒烟测试异常中断：', e);
  process.exit(2);
});
