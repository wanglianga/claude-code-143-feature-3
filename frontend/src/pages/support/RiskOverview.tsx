import { useEffect, useState } from 'react';
import { get } from '../../api';
import { Badge, RiskLevel, Spinner, fmtPct } from '../../components/ui';

export default function RiskOverview() {
  const [d, setD] = useState<any>(null);
  useEffect(() => { get('/support/overview').then(setD); }, []);
  if (!d) return <Spinner />;

  return (
    <div>
      <h1>风险画像与行业沉淀</h1>

      <div className="card">
        <h2>高风险企业名单（需更高保证金 + 更严格现场确认）</h2>
        {d.highRiskEnterprises.length === 0 && <div className="muted small">暂无高风险企业</div>}
        {d.highRiskEnterprises.map((e: any) => (
          <div key={e.id} className="alert alert-error" style={{ display: 'block' }}>
            <div className="row">
              <b>{e.name}</b>
              <RiskLevel level={e.riskLevel} />
              <div className="spacer" />
              <span className="small">保证金倍率 3.0 · 双人现场确认 · 可用 ¥{e.depositBalance} · 冻结 ¥{e.depositFrozen}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>企业风险指标（近窗口累计）</h2>
        <table>
          <thead>
            <tr><th>企业</th><th>风险等级</th><th>发单</th><th>取消率</th><th>有责争议率</th><th>工伤率</th><th>临期赔付/拒付败诉</th><th>保证金附加</th><th>排序罚分</th><th>保证金(可用/冻结)</th></tr>
          </thead>
          <tbody>
            {d.allEnterprises.map((e: any) => (
              <tr key={e.id}>
                <td><b>{e.name}</b><div className="small muted">#{e.id}</div></td>
                <td><RiskLevel level={e.riskLevel} /></td>
                <td>{e.totalJobs}（取消 {e.cancelledJobs}）</td>
                <td>
                  <div className="row"><div className="progress-bar" style={{ width: 80 }}><i style={{ width: `${Math.min(100, e.cancelRate * 300)}%` }} /></div>{fmtPct(e.cancelRate)}</div>
                  <div className="small muted" style={{ color: e.cancelRate >= 0.15 ? 'var(--red)' : undefined }}>阈值 15%（{e.cancelledJobs}/{e.totalJobs}）</div>
                </td>
                <td>
                  <div className="row"><div className="progress-bar" style={{ width: 80 }}><i style={{ width: `${Math.min(100, e.disputeRate * 300)}%` }} /></div>{fmtPct(e.disputeRate)}</div>
                  <div className="small muted" style={{ color: e.disputeRate >= 0.2 ? 'var(--red)' : undefined }}>阈值 20%（有责 {e.lostDisputes}/申诉 {e.disputedAssignments}）</div>
                </td>
                <td>
                  {fmtPct(e.injuryRate)}
                  <div className="small muted" style={{ color: e.injuryRate >= 0.1 ? 'var(--red)' : undefined }}>阈值 10%（{e.injuryJobs} 次）</div>
                </td>
                <td className="small">
                  <div>{e.lateCancelCompensatedJobs || 0} 次临期赔付</div>
                  <div style={{ color: (e.arbitrationLostCount || 0) > 0 ? 'var(--red)' : undefined }}>{e.arbitrationLostCount || 0} 次拒付败诉</div>
                </td>
                <td>{Number(e.depositSurchargeRate || 0) > 0
                  ? <Badge tone="red">+{Number(e.depositSurchargeRate).toFixed(1)} 倍</Badge>
                  : <span className="small muted">+0.0</span>}</td>
                <td style={{ color: e.rankPenalty > 0 ? 'var(--red)' : undefined }}>{e.rankPenalty || 0}</td>
                <td className="small">¥{e.depositBalance} / <span style={{ color: 'var(--orange)' }}>¥{e.depositFrozen}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>按行业沉淀岗位风险</h2>
        <table>
          <thead>
            <tr><th>行业</th><th>基础风险</th><th>基准保证金</th><th>保费率</th><th>累计岗位</th><th>取消率</th><th>工伤</th><th>事故时未保险</th></tr>
          </thead>
          <tbody>
            {d.industries.map((x: any) => (
              <tr key={x.industry}>
                <td><Badge tone="blue">{x.label}</Badge></td>
                <td><RiskLevel level={x.baseRiskLevel} /></td>
                <td>¥{x.baseDeposit}/人</td>
                <td>{(x.insuranceRate * 100).toFixed(1)}%</td>
                <td>{x.jobs}</td>
                <td>{fmtPct(x.cancelRate)}（{x.cancelled}）</td>
                <td>{x.injuries}</td>
                <td>{x.uncoveredInjuries > 0
                  ? <Badge tone="red">{x.uncoveredInjuries} 起（系统拒赔）</Badge>
                  : <Badge tone="green">0</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
