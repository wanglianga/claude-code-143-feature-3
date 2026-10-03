import { useEffect, useState } from 'react';
import { get, post } from '../../api';
import { Alert, Badge, Field, Modal, Spinner, StatusBadge, fmtDateTime, fmtMoney } from '../../components/ui';

const TABS = [
  { key: 'ARBITRATION', label: '仲裁中' },
  { key: '', label: '全部' },
  { key: 'SUGGESTED', label: '待企业确认' },
  { key: 'PAID', label: '已支付' },
  { key: 'ARBITRATION_AWARD_PAY', label: '判付已到账' },
  { key: 'ARBITRATION_UPHELD', label: '判企业无责' },
];

export default function CompensationDesk() {
  const [list, setList] = useState<any[]>([]);
  const [status, setStatus] = useState('ARBITRATION');
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<any>(null);
  const [evidence, setEvidence] = useState<any>(null);
  const [award, setAward] = useState('');
  const [amount, setAmount] = useState(0);
  const [uphold, setUphold] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = (s = status) => {
    setLoading(true);
    const qs = s ? `?status=${s}` : '';
    get(`/support/compensations${qs}`).then(setList).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const open = async (c: any) => {
    setTarget(c); setError(''); setAward(''); setAmount(Number(c.totalAmount)); setUphold(false); setEvidence(null);
    setEvidence(await get(`/support/compensations/${c.id}/evidence`));
  };

  const submit = async () => {
    setError(''); setBusy(true);
    try {
      await post(`/support/compensations/${target.id}/arbitrate`, {
        uphold, award, awardedAmount: uphold ? 0 : Number(amount),
      });
      setTarget(null);
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <h1>取消赔付仲裁台</h1>
      <Alert kind="info">
        企业开工前临时取消且拒绝支付工人到场/交通补贴时进入仲裁。裁决依据：位置心跳轨迹、签到记录、通知档位、企业历史取消。
        判企业有责后：补贴从保证金扣付工人，并对企业 <b>后续发单保证金 +0.5 倍</b>（封顶 +1.5）、<b>排序罚分 +8</b>、计入风险画像。
      </Alert>

      <div className="row">
        {TABS.map((t) => (
          <button key={t.key} className={`btn btn-sm ${status === t.key ? 'btn-primary' : ''}`}
            onClick={() => { setStatus(t.key); load(t.key); }}>{t.label}</button>
        ))}
      </div>

      {loading ? <Spinner /> : list.length === 0 ? (
        <div className="card muted">暂无该状态的赔付单</div>
      ) : (
        <div className="col">
          {list.map((c) => (
            <div key={c.id} className="card">
              <div className="row">
                <Badge tone="purple">{c.jobTitle}</Badge>
                <b>{c.workerName}</b>
                <span className="small muted">{c.locationBucketLabel || c.locationBucket}{c.distanceMeters !== null ? ` ${c.distanceMeters}m` : ''}</span>
                <div className="spacer" />
                <span className="money">{fmtMoney(c.totalAmount)}</span>
                <StatusBadge status={c.status} />
                {c.status === 'ARBITRATION' && (
                  <button className="btn btn-primary btn-sm" onClick={() => open(c)}>审理仲裁</button>
                )}
                {c.status !== 'ARBITRATION' && (
                  <button className="btn btn-sm" onClick={() => open(c)}>查看证据</button>
                )}
              </div>
              <div className="small muted" style={{ margin: '6px 0' }}>
                开工前 {c.minutesToStart} 分钟取消 · {c.noticeTierLabel} · 历史倍率 ×{c.historyMultiplier}
              </div>
              {c.enterpriseNote && <div className="small" style={{ color: '#c0392b' }}>企业拒付理由：{c.enterpriseNote}</div>}
            </div>
          ))}
        </div>
      )}

      {target && (
        <Modal title={`仲裁审理：${target.workerName} · ${target.jobTitle}`} onClose={() => setTarget(null)}
          footer={
            <button className="btn btn-primary" disabled={busy || !award.trim() || (!uphold && !(amount > 0))} onClick={submit}>
              下达仲裁裁决
            </button>
          }>
          {error && <Alert kind="error">{error}</Alert>}
          {!evidence ? <Spinner /> : (
            <>
              <div className="card" style={{ background: '#fafafa' }}>
                <h2>企业画像</h2>
                <div className="kv">
                  <span className="k">企业</span><span>{evidence.enterprise?.name}（风险 L{evidence.enterprise?.riskLevel}）</span>
                  <span className="k">历史临期取消赔付</span><span>{evidence.enterprise?.lateCancelCompensatedJobs} 次</span>
                  <span className="k">拒付败诉</span><span>{evidence.enterprise?.arbitrationLostCount} 次</span>
                  <span className="k">保证金附加倍率</span><span>+{Number(evidence.enterprise?.depositSurchargeRate || 0).toFixed(1)} 倍</span>
                  <span className="k">当前排序罚分</span><span>{evidence.enterprise?.rankPenalty}</span>
                </div>
              </div>

              <div className="card">
                <h2>赴岗位置心跳（{evidence.pings.length}）</h2>
                {evidence.pings.length === 0 ? <div className="muted small">无位置上报</div> : (
                  <table>
                    <thead><tr><th>时间</th><th>坐标</th><th>距签到点</th><th>档位</th></tr></thead>
                    <tbody>
                      {evidence.pings.map((p: any) => (
                        <tr key={p.id}>
                          <td>{fmtDateTime(p.createdAt)}</td>
                          <td>{Number(p.lat).toFixed(4)},{Number(p.lng).toFixed(4)}</td>
                          <td>{p.distanceMeters}m</td>
                          <td>{({ ON_SITE: '已到现场', NEARBY: '到场附近', EN_ROUTE: '在途中' } as any)[p.bucket] || p.bucket}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <h2 style={{ marginTop: 12 }}>签到记录（{evidence.attendance.length}）</h2>
                {evidence.attendance.length === 0 ? <div className="muted small">无签到记录</div> : evidence.attendance.map((a: any) => (
                  <div key={a.id} className="small">
                    {a.kind} · {fmtDateTime(a.eventTime)} · 定位{a.locationPassed ? '✓' : '✗'}({a.distanceMeters}m) ·
                    人脸{a.facePassed ? '✓' : '✗'} · 四重{a.allPassed ? '全部通过' : '未通过'}
                  </div>
                ))}
              </div>

              <pre className="rule-box" style={{ whiteSpace: 'pre-wrap' }}>{target.ruleBreakdown}</pre>

              <label className="row" style={{ margin: '8px 0' }}>
                <input type="checkbox" checked={uphold} onChange={(e) => setUphold(e.target.checked)} />
                <span>裁决企业无责（撤销赔付建议，不扣保证金、不计罚分）</span>
              </label>

              {!uphold && (
                <Field label={`裁决赔付金额（建议 ${fmtMoney(target.totalAmount)}）`}>
                  <input className="input" type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
                </Field>
              )}
              <Field label="仲裁裁决书（事实认定与裁决依据，必填）">
                <textarea className="input" rows={4} value={award} onChange={(e) => setAward(e.target.value)}
                  placeholder="例如：位置心跳显示工人取消时已到现场 90m，企业临期取消事实成立……" />
              </Field>
              {!uphold && (
                <Alert kind="error">判企业有责后将从保证金扣付，并叠加保证金 +0.5 倍附加与排序罚分（同岗位只计一次）。</Alert>
              )}
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
