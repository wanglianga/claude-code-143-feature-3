import { useEffect, useState } from 'react';
import { get, post } from '../../api';
import { Alert, Badge, Field, Modal, Spinner, StatusBadge, fmtDateTime, fmtMoney } from '../../components/ui';

const TABS = [
  { key: '', label: '全部' },
  { key: 'SUGGESTED', label: '待确认' },
  { key: 'ARBITRATION', label: '仲裁中' },
  { key: 'PAID', label: '已到账' },
  { key: 'ARBITRATION_AWARD_PAY', label: '仲裁判付' },
];

export default function EntCompensations() {
  const [list, setList] = useState<any[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [target, setTarget] = useState<any>(null);
  const [action, setAction] = useState<'confirm' | 'refuse'>('confirm');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = (s = status) => {
    setLoading(true);
    const qs = s ? `?status=${s}` : '';
    get(`/enterprise/compensations${qs}`).then(setList).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    setError(''); setBusy(true);
    try {
      if (action === 'confirm') {
        const r = await post(`/compensations/${target.id}/confirm`, { note });
        setMsg(`已确认支付，工人补贴 ${fmtMoney(r.totalAmount)} 已到账`);
      } else {
        await post(`/compensations/${target.id}/refuse`, { note });
        setMsg('已拒付，该赔付单进入平台仲裁');
      }
      setTarget(null); setNote('');
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const totalPending = list.filter((c) => c.status === 'SUGGESTED').reduce((s, c) => s + Number(c.totalAmount), 0);

  return (
    <div>
      <h1>临时取消赔付</h1>
      {msg && <Alert kind="ok">{msg}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}

      <Alert kind="warn">
        企业开工前临时取消时，平台依据 <b>通知时间 + 工人赴岗位置 + 是否签到 + 历史取消记录</b> 自动生成到场补贴/交通补贴建议。
        确认后立即从保证金账户扣付给工人；拒付将进入仲裁，败诉会提高后续发单保证金倍率并降低发单排序。
        {totalPending > 0 && <> 当前待确认合计 <b className="money">{fmtMoney(totalPending)}</b>。</>}
      </Alert>

      <div className="row">
        {TABS.map((t) => (
          <button key={t.key} className={`btn btn-sm ${status === t.key ? 'btn-primary' : ''}`}
            onClick={() => { setStatus(t.key); load(t.key); }}>{t.label}</button>
        ))}
      </div>

      {loading ? <Spinner /> : list.length === 0 ? (
        <div className="card muted">暂无取消赔付记录</div>
      ) : (
        <div className="col">
          {list.map((c) => (
            <div key={c.id} className="card">
              <div className="row">
                <Badge tone="blue">{c.locationBucketLabel || c.locationBucket}</Badge>
                <b>{c.workerName}</b>
                <span className="small muted">{c.workerPhone}</span>
                <div className="spacer" />
                <StatusBadge status={c.status} />
              </div>
              <div className="small muted" style={{ margin: '6px 0' }}>
                {c.jobTitle} · {c.jobLocation} · 取消于 {fmtDateTime(c.cancelledAt)}（开工前 {c.minutesToStart} 分钟）
              </div>
              <div className="row small">
                <span>到场补贴 <b className="money">{fmtMoney(c.attendanceAllowance)}</b></span>
                <span>交通补贴 <b className="money">{fmtMoney(c.transportAllowance)}</b></span>
                <span>合计 <b className="money" style={{ fontSize: 16 }}>{fmtMoney(c.totalAmount)}</b></span>
                <span className="muted">历史倍率 ×{c.historyMultiplier}</span>
                <div className="spacer" />
                {c.status === 'SUGGESTED' && (
                  <>
                    <button className="btn btn-success btn-sm"
                      onClick={() => { setTarget(c); setAction('confirm'); setNote('企业确认平台补偿建议'); }}>
                      确认支付
                    </button>
                    <button className="btn btn-danger btn-sm"
                      onClick={() => { setTarget(c); setAction('refuse'); setNote(''); }}>
                      拒绝支付
                    </button>
                  </>
                )}
              </div>
              <pre className="rule-box" style={{ whiteSpace: 'pre-wrap' }}>{c.ruleBreakdown}</pre>
              {c.enterpriseNote && <div className="small" style={{ color: '#c0392b' }}>企业意见：{c.enterpriseNote}</div>}
              {c.arbitrationAward && <Alert kind="warn"><b>仲裁裁决：</b>{c.arbitrationAward}</Alert>}
              {(c.status === 'PAID' || c.status === 'ARBITRATION_AWARD_PAY') && (
                <div className="small money-green">已于 {fmtDateTime(c.paidAt)} 到账 {fmtMoney(c.awardedAmount || c.totalAmount)}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {target && (
        <Modal
          title={action === 'confirm' ? `确认支付赔付：${target.workerName}` : `拒绝支付：${target.workerName}`}
          onClose={() => setTarget(null)}
          footer={
            <button className={action === 'confirm' ? 'btn btn-success' : 'btn btn-danger'}
              disabled={busy || (action === 'refuse' && !note.trim())} onClick={submit}>
              {action === 'confirm' ? `确认支付 ${fmtMoney(target.totalAmount)}` : '拒付并进入仲裁'}
            </button>
          }
        >
          {action === 'confirm' ? (
            <Alert kind="ok">确认后立即从保证金账户（优先冻结额、其次可用余额）扣划 <b>{fmtMoney(target.totalAmount)}</b>，工人即时收到到场/交通补贴与平台通知。临期取消确认会计入取消率与排序模型。</Alert>
          ) : (
            <Alert kind="error">拒付后订单进入平台仲裁。若败诉：后续发单保证金附加 <b>+0.5 倍</b>（封顶 +1.5 倍）、排序罚分 <b>+8</b>，工人报名时会看到稳定性警示。</Alert>
          )}
          <Field label={action === 'confirm' ? '备注（可选）' : '拒付理由（必填）'}>
            <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  );
}
