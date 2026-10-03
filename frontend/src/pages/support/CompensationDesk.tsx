import { useEffect, useState } from 'react';
import { get, post } from '../../api';
import { Alert, Badge, Modal, RiskLevel, Spinner, fmtDateTime, fmtMoney, fmtPct } from '../../components/ui';

const KIND_LABEL: Record<string, string> = {
  ATTENDANCE: '到场补贴',
  TRANSPORT: '交通补贴',
  NONE: '无需补偿',
};
const STATE_LABEL: Record<string, string> = {
  CHECKED_IN: '已签到到场',
  ON_THE_WAY: '在路上',
  NOT_DEPARTED: '未出发',
};

export default function CompensationDesk() {
  const [queue, setQueue] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [target, setTarget] = useState<any>(null);
  const [decision, setDecision] = useState<'PAY' | 'WAIVE'>('PAY');
  const [note, setNote] = useState('');
  const [amounts, setAmounts] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);

  const load = () => get('/support/compensations').then(setQueue).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const openArbitrate = (g: any) => {
    setTarget(g);
    setDecision('PAY');
    setNote('');
    const init: Record<number, number> = {};
    for (const c of g.items) if (c.status === 'ARBITRATION') init[c.id] = Number(c.suggestedAmount);
    setAmounts(init);
  };

  const submit = async () => {
    setBusy(true); setMsg(''); setError('');
    try {
      const items = Object.entries(amounts).map(([id, amount]) => ({ id: Number(id), amount: Number(amount) }));
      const r = await post(`/support/jobs/${target.job.id}/compensations/arbitrate`, { decision, note, items });
      setMsg(r.message);
      setTarget(null);
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <h1>取消赔付仲裁</h1>
      {msg && <Alert kind="ok">{msg}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      <Alert kind="info">
        企业拒绝支付取消赔付的案件在此裁决。判付金额由平台从企业保证金账户强制划扣（可用余额不足时划扣冻结保证金），
        并计入企业有责争议；裁决结果影响企业风险等级、后续发单保证金倍率与岗位排序。
      </Alert>

      {queue.length === 0 && <div className="card muted">当前没有仲裁中的取消赔付案件</div>}

      <div className="col">
        {queue.map((g) => (
          <div key={g.job.id} className="card">
            <div className="row">
              <b>{g.job.title}</b>
              <Badge tone="purple">仲裁中</Badge>
              <div className="spacer" />
              <span className="small muted">取消于 {fmtDateTime(g.job.cancelledAt)}</span>
            </div>
            <div className="grid grid-2" style={{ margin: '8px 0' }}>
              <div className="kv">
                <span className="k">企业</span><span>{g.enterprise?.name} <RiskLevel level={g.enterprise?.riskLevel || 1} /></span>
                <span className="k">累计取消率</span><span>{fmtPct(g.enterprise?.cancelRate)}（进入排序模型）</span>
                <span className="k">拒付记录</span><span>{g.enterprise?.compRefusals} 次</span>
                <span className="k">保证金账户</span>
                <span>可用 {fmtMoney(g.enterprise?.depositBalance)} / 冻结 {fmtMoney(g.enterprise?.depositFrozen)}</span>
              </div>
              <div className="kv">
                <span className="k">开工时间</span><span>{fmtDateTime(g.job.startTime)}</span>
                <span className="k">取消原因</span><span>{g.job.cancelReason || '—'}</span>
                <span className="k">企业拒付理由</span><span style={{ color: 'var(--orange)' }}>{g.items.find((c: any) => c.rejectReason)?.rejectReason || '—'}</span>
                <span className="k">建议合计</span><span className="money">{fmtMoney(g.totalSuggested)}</span>
              </div>
            </div>
            <table>
              <thead>
                <tr><th>工人</th><th>取消时状态</th><th>类型</th><th>建议金额</th><th>规则依据（通知时间/位置/签到/历史规则）</th></tr>
              </thead>
              <tbody>
                {g.items.map((c: any) => (
                  <tr key={c.id}>
                    <td>{c.workerName}</td>
                    <td>
                      {STATE_LABEL[c.workerState]}
                      {c.distanceMeters != null && <span className="small muted">（{(c.distanceMeters / 1000).toFixed(1)}km）</span>}
                      <div className="small muted">通知时距开工 {c.minutesToStart} 分钟</div>
                    </td>
                    <td><Badge tone={c.kind === 'ATTENDANCE' ? 'purple' : c.kind === 'TRANSPORT' ? 'blue' : 'gray'}>{KIND_LABEL[c.kind]}</Badge></td>
                    <td className="money">{fmtMoney(c.suggestedAmount)}</td>
                    <td className="small muted" style={{ maxWidth: 380 }}>{c.ruleSnapshot}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-primary btn-sm" onClick={() => openArbitrate(g)}>裁决</button>
            </div>
          </div>
        ))}
      </div>

      {target && (
        <Modal title={`仲裁裁决：${target.job.title}`} onClose={() => setTarget(null)}
          footer={<button className="btn btn-primary" disabled={busy} onClick={submit}>提交裁决</button>}>
          <div className="row" style={{ marginBottom: 10 }}>
            <button className={`btn btn-sm ${decision === 'PAY' ? 'btn-primary' : ''}`} onClick={() => setDecision('PAY')}>判付（企业支付）</button>
            <button className={`btn btn-sm ${decision === 'WAIVE' ? 'btn-danger' : ''}`} onClick={() => setDecision('WAIVE')}>豁免（企业无需支付）</button>
          </div>
          {decision === 'PAY' && (
            <>
              <Alert kind="warn">判付金额将从企业保证金账户强制划扣并到达工人钱包，同时计入企业有责争议。</Alert>
              {target.items.filter((c: any) => c.status === 'ARBITRATION').map((c: any) => (
                <label key={c.id} className="field">
                  <span>{c.workerName} · {KIND_LABEL[c.kind]}（建议 {fmtMoney(c.suggestedAmount)}）</span>
                  <input className="input" type="number" value={amounts[c.id] ?? 0}
                    onChange={(e) => setAmounts({ ...amounts, [c.id]: Number(e.target.value) })} />
                </label>
              ))}
            </>
          )}
          {decision === 'WAIVE' && (
            <Alert kind="warn">豁免后企业无需支付补偿；企业的拒付记录仍保留在风险画像与排序模型中。</Alert>
          )}
          <label className="field"><span>裁决依据（企业与工人可见）</span>
            <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="依据签到记录、位置上报、通知时间与平台取消赔付规则作出裁决…" />
          </label>
        </Modal>
      )}
    </div>
  );
}
