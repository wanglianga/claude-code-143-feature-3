import { useEffect, useState } from 'react';
import { get, post } from '../../api';
import { Alert, Badge, Modal, Spinner, fmtDateTime, fmtMoney } from '../../components/ui';

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

export default function EntCompensations() {
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [rejectJob, setRejectJob] = useState<any>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => get('/enterprise/compensations').then(setGroups).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const act = async (fn: () => Promise<any>) => {
    setMsg(''); setError(''); setBusy(true);
    try {
      const r = await fn();
      if (r?.message) setMsg(r.message);
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <h1>取消赔付</h1>
      {msg && <Alert kind="ok">{msg}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      <Alert kind="info">
        企业临时取消岗位后，平台按「通知时间 + 工人位置 + 是否已签到 + 历史取消规则」自动生成补偿建议。
        确认后补偿从保证金可用余额支付并即时到达工人钱包；拒绝支付将进入平台仲裁，
        拒付记录会影响后续发单保证金倍率与岗位排序。
      </Alert>

      {groups.length === 0 && <div className="card muted">暂无取消赔付记录</div>}

      <div className="col">
        {groups.map((g) => (
          <div key={g.jobId} className="card">
            <div className="row">
              <b>{g.jobTitle}</b>
              <CompStatus status={g.status} />
              <div className="spacer" />
              <span className="small muted">取消于 {fmtDateTime(g.cancelledAt)}</span>
            </div>
            <div className="small muted" style={{ margin: '4px 0 8px' }}>
              开工 {fmtDateTime(g.startTime)} · 日结 {fmtMoney(g.dailyWage)} · 取消原因：{g.cancelReason || '—'}
            </div>
            <table>
              <thead>
                <tr><th>工人</th><th>取消时状态</th><th>类型</th><th>建议金额</th><th>实付</th><th>状态</th><th>规则依据</th></tr>
              </thead>
              <tbody>
                {g.items.map((c: any) => (
                  <tr key={c.id}>
                    <td>{c.workerName}</td>
                    <td>
                      {STATE_LABEL[c.workerState]}
                      {c.distanceMeters != null && <span className="small muted">（{(c.distanceMeters / 1000).toFixed(1)}km）</span>}
                    </td>
                    <td><Badge tone={c.kind === 'ATTENDANCE' ? 'purple' : c.kind === 'TRANSPORT' ? 'blue' : 'gray'}>{KIND_LABEL[c.kind]}</Badge></td>
                    <td className="money">{fmtMoney(c.suggestedAmount)}</td>
                    <td>{c.finalAmount != null ? fmtMoney(c.finalAmount) : '—'}</td>
                    <td><CompStatus status={c.status} /></td>
                    <td className="small muted" style={{ maxWidth: 360 }}>{c.ruleSnapshot}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row" style={{ marginTop: 10 }}>
              <span className="small">建议合计 <b className="money">{fmtMoney(g.totalSuggested)}</b>
                {g.totalFinal > 0 && <> · 实付 <b className="money">{fmtMoney(g.totalFinal)}</b></>}</span>
              <div className="spacer" />
              {g.status === 'SUGGESTED' && (
                <>
                  <button className="btn btn-success btn-sm" disabled={busy}
                    onClick={() => act(() => post(`/jobs/${g.jobId}/compensations/confirm`))}>
                    确认并支付 {fmtMoney(g.totalSuggested)}
                  </button>
                  <button className="btn btn-danger btn-sm" disabled={busy}
                    onClick={() => { setRejectJob(g); setReason(''); }}>
                    拒绝支付（进入仲裁）
                  </button>
                </>
              )}
              {g.status === 'ARBITRATION' && <Badge tone="purple">仲裁中，等待平台裁决</Badge>}
            </div>
            {g.items.some((c: any) => c.rejectReason) && (
              <div className="small" style={{ color: 'var(--orange)', marginTop: 6 }}>
                拒付理由：{g.items.find((c: any) => c.rejectReason)?.rejectReason}
              </div>
            )}
            {g.items.some((c: any) => c.decisionNote) && (
              <div className="small muted" style={{ marginTop: 6 }}>
                仲裁裁决：{g.items.find((c: any) => c.decisionNote)?.decisionNote}
              </div>
            )}
          </div>
        ))}
      </div>

      {rejectJob && (
        <Modal title={`拒绝支付：${rejectJob.jobTitle}`} onClose={() => setRejectJob(null)}
          footer={<button className="btn btn-danger" disabled={busy}
            onClick={() => act(async () => {
              const r = await post(`/jobs/${rejectJob.jobId}/compensations/reject`, { reason });
              setRejectJob(null);
              return r;
            })}>确认拒付并进入仲裁</button>}>
          <Alert kind="warn">
            拒绝支付后，{rejectJob.items.filter((c: any) => c.status === 'SUGGESTED').length} 笔补偿（合计 {fmtMoney(rejectJob.totalSuggested)}）将进入平台仲裁。
            拒付记录将计入企业风险画像：后续发单保证金倍率上浮、岗位大厅排序降权，工人端将展示拒付记录提示。
          </Alert>
          <label className="field"><span>拒付理由（仲裁与工人可见）</span>
            <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="例如：工人未按约定时间出发，不应产生交通补贴" />
          </label>
        </Modal>
      )}
    </div>
  );
}

export function CompStatus({ status }: { status: string }) {
  const map: Record<string, { tone: any; text: string }> = {
    SUGGESTED: { tone: 'orange', text: '待企业确认' },
    PAID: { tone: 'green', text: '已支付' },
    ARBITRATION: { tone: 'purple', text: '仲裁中' },
    ARBITRATED_PAID: { tone: 'purple', text: '仲裁判付' },
    ARBITRATED_WAIVED: { tone: 'gray', text: '仲裁豁免' },
    NONE_REQUIRED: { tone: 'gray', text: '无需补偿' },
  };
  const m = map[status] || { tone: 'gray', text: status };
  return <Badge tone={m.tone as any}>{m.text}</Badge>;
}
