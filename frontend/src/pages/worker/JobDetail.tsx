import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { get, post } from '../../api';
import { useAuth } from '../../auth';
import { Alert, Badge, RiskLevel, Spinner, StabilityBadge, StatusBadge, fmtDateTime, fmtMoney } from '../../components/ui';

export default function JobDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [job, setJob] = useState<any>(null);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => get(`/jobs/${id}`).then(setJob);
  useEffect(() => { load(); }, [id]);

  if (!job) return <Spinner />;

  const my = job.myApplication;
  const gates = [
    { label: '实名认证', passed: user?.idVerified, hint: user?.idVerified ? `已实名 ${user.idVerified ? '' : ''}` : '未实名，请到「实名资料」完成' },
    {
      label: '健康证',
      passed: !job.requireHealthCert || (!!user?.healthCertUntil && new Date(user.healthCertUntil) >= new Date(job.startTime)),
      hint: job.requireHealthCert ? (user?.healthCertUntil ? `有效期至 ${user.healthCertUntil}` : '岗位强制要求，请先上传有效健康证') : '本岗位不要求',
    },
    { label: '历史评价 ≥ 3.0 / 爽约 < 3 次', passed: true, hint: '报名时系统自动校验' },
    { label: '风险告知确认', passed: ack, hint: '请阅读岗位风险并勾选确认' },
  ];

  const apply = async () => {
    setError(''); setMsg(''); setBusy(true);
    try {
      await post(`/jobs/${id}/apply`, { riskAcknowledged: ack });
      setMsg('报名成功！等待企业录取');
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button className="btn btn-sm" onClick={() => nav(-1)}>← 返回</button>
      <div className="fab-space" />

      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="ok">{msg}</Alert>}

      <div className="card">
        <div className="row">
          <Badge tone="blue">{job.industryLabel}</Badge>
          <RiskLevel level={job.industryRiskLevel} />
          <StatusBadge status={job.status} />
          {job.strictConfirmation && <Badge tone="red">严格现场确认（双人）</Badge>}
          <StabilityBadge s={job.enterpriseStability} />
          <div className="spacer" />
          <span className="money" style={{ fontSize: 22 }}>{fmtMoney(job.dailyWage)}<span className="small muted">/班</span></span>
        </div>
        <h1 style={{ marginTop: 10 }}>{job.title}</h1>
        <div className="grid grid-2">
          <div className="kv">
            <span className="k">用工企业</span><span>{job.enterpriseName} <RiskLevel level={job.enterpriseRiskLevel} /></span>
            <span className="k">作业地点</span><span>📍 {job.location}</span>
            <span className="k">签到坐标</span><span className="small">{Number(job.lat).toFixed(4)}, {Number(job.lng).toFixed(4)}（300m 围栏）</span>
            <span className="k">作业时间</span><span>{fmtDateTime(job.startTime)}<br />至 {fmtDateTime(job.endTime)}</span>
            <span className="k">招聘人数</span><span>{job.headcount} 人（已录取 {job.acceptedWorkers?.length || 0}）</span>
            <span className="k">技能要求</span><span>{job.skillRequirement}</span>
            <span className="k">服装要求</span><span>{job.dressCode || '无特殊要求'}</span>
            <span className="k">健康证</span><span>{job.requireHealthCert ? <Badge tone="orange">强制要求</Badge> : '不要求'}</span>
          </div>
          <div className="kv">
            <span className="k">日结工资</span><span className="money">{fmtMoney(job.dailyWage)}</span>
            <span className="k">加班费</span><span>{fmtMoney(job.overtimeRate)}/小时</span>
            <span className="k">餐补</span><span>{fmtMoney(job.mealAllowance)}/班</span>
            <span className="k">迟到扣款</span><span>{fmtMoney(job.lateDeductPerMin)}/分钟（宽限 {job.lateGraceMinutes} 分钟）</span>
            <span className="k">保险</span><span>雇主/意外险 保额 {job.insuranceCoverageWan} 万，保费 {fmtMoney(job.insurancePremium)}（企业承担）</span>
            <span className="k">平台服务费</span><span>{(Number(job.platformFeeRate) * 100).toFixed(1)}%（企业侧）</span>
            <span className="k">结算方式</span><span>{job.settlementMethod}</span>
            <span className="k">保证金</span><span>企业已冻结 {fmtMoney(job.depositRequired)}</span>
          </div>
        </div>
        <p className="muted" style={{ margin: '12px 0 0' }}>{job.description}</p>
      </div>

      {job.enterpriseStability && (
        <div className="card">
          <h2>企业近期稳定性</h2>
          <Alert kind={job.enterpriseStability.level === 'STABLE' ? 'ok' : job.enterpriseStability.level === 'CAUTION' ? 'warn' : 'error'}>
            {job.enterpriseStability.hint}。企业取消率与取消赔付记录已进入平台排序模型。
          </Alert>
          <div className="row small muted">
            <span>近 {job.enterpriseStability.recentWindowDays} 天发单 {job.enterpriseStability.recentJobs} 个</span>
            <span>取消 {job.enterpriseStability.recentCancelled} 个</span>
            <span>累计取消率 {(Number(job.enterpriseStability.cancelRate) * 100).toFixed(0)}%</span>
            <span>取消赔付拒付 {job.enterpriseStability.compRefusals} 次</span>
          </div>
        </div>
      )}

      <div className="card">
        <h2>风险告知</h2>
        <Alert kind="warn">
          本岗位行业风险等级 L{job.industryRiskLevel}，作业过程中可能存在搬运、登高、机械、长时间站立等风险。
          请确认自身身体状况适合岗位要求；到岗需通过定位、人脸、动态二维码与现场主管确认四重校验；
          保险将于实际到岗且主管确认后即时生效，未到岗发生事故不在保障范围。
        </Alert>

        {user?.role === 'WORKER' && (
          my ? (
            <div className="row">
              <StatusBadge status={my.status} />
              <span className="muted">您的报名状态</span>
              {['ACCEPTED', 'CHECKED_IN', 'WORKING'].includes(my.status) && (
                <button className="btn btn-primary" onClick={() => nav(`/room/${my.id}`)}>进入任务室 →</button>
              )}
            </div>
          ) : (
            <>
              <div className="checklist">
                {gates.map((g) => (
                  <div key={g.label} className={`ci ${g.passed ? 'pass' : 'fail'}`}>
                    <span className="ico">{g.passed ? '✅' : '⬜'}</span>
                    <span><b>{g.label}</b> <span className="small muted">— {g.hint}</span></span>
                  </div>
                ))}
              </div>
              <label className="row" style={{ margin: '10px 0' }}>
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>我已阅读并理解上述岗位、资质与风险要求，确认实名信息真实有效</span>
              </label>
              <button className="btn btn-primary" disabled={busy || !ack} onClick={apply}>确认报名</button>
              {!user?.idVerified && <button className="btn" style={{ marginLeft: 10 }} onClick={() => nav('/profile')}>去补全实名资料</button>}
            </>
          )
        )}
      </div>

      {job.acceptedWorkers?.length > 0 && (
        <div className="card">
          <h2>已录取工人 {job.acceptedWorkers.length}/{job.headcount}</h2>
          <table>
            <thead><tr><th>工人</th><th>实名</th><th>健康证</th><th>评分</th><th>完工/爽约</th></tr></thead>
            <tbody>
              {job.acceptedWorkers.map((w: any) => (
                <tr key={w.id}>
                  <td>{w.name}</td>
                  <td>{w.idVerified ? <Badge tone="green">已实名</Badge> : <Badge tone="red">未实名</Badge>}</td>
                  <td>{w.healthCertUntil || '—'}</td>
                  <td>⭐ {w.avgRating}（{w.reviewCount}）</td>
                  <td>{w.completedCount} / {w.noShowCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
