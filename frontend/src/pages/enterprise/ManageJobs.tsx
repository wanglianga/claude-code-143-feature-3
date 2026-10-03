import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post } from '../../api';
import { Alert, Badge, Modal, Spinner, StatusBadge, fmtDate, fmtMoney } from '../../components/ui';

export default function ManageJobs() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState<any>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [prepayTarget, setPrepayTarget] = useState<any>(null);
  const [prepay, setPrepay] = useState(1000);

  const load = () => get('/enterprise/jobs').then(setJobs).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const doCancel = async () => {
    setError('');
    try {
      const r = await post(`/jobs/${cancelTarget.id}/cancel`, { reason });
      setMsg(r.compensationCount > 0
        ? `岗位已取消：罚没保证金 ¥${r.forfeit}，释放 ¥${r.released}；平台为 ${r.compensationCount} 名在途/到场工人生成补偿建议，合计 ¥${r.suggestedTotal}，请到「取消赔付」确认或拒付。`
        : `岗位已取消：罚没保证金 ¥${r.forfeit}，释放 ¥${r.released}，影响工人 ${r.affectedWorkers} 名（无在途/到场工人，未生成补偿建议）`);
      setCancelTarget(null);
      await load();
    } catch (e: any) { setError(e.message); }
  };

  const doPrepay = async () => {
    try {
      await post(`/jobs/${prepayTarget.id}/prepayment`, { amount: Number(prepay) });
      setMsg(`已追加预付款 ${fmtMoney(prepay)}`);
      setPrepayTarget(null);
      await load();
    } catch (e: any) { setError(e.message); }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <h1>岗位管理</h1>
      {msg && <Alert kind="ok">{msg}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      <div className="col">
        {jobs.map((j) => (
          <div key={j.id} className="card">
            <div className="row">
              <Badge tone="blue">{j.industryLabel}</Badge>
              <Link to={`/ent/jobs/${j.id}/applicants`}><b>{j.title}</b></Link>
              {j.strictConfirmation && <Badge tone="red">双人确认</Badge>}
              <div className="spacer" />
              <StatusBadge status={j.status} />
            </div>
            <div className="small muted" style={{ margin: '6px 0' }}>
              📍 {j.location} · 🕒 {fmtDate(j.startTime)} · 招 {j.headcount} 人
              {j.status === 'CANCELLED' && j.cancelReason ? ` · 取消原因：${j.cancelReason}` : ''}
            </div>
            <div className="row small">
              <span>日结 <b className="money">{fmtMoney(j.dailyWage)}</b></span>
              <span>冻结保证金 <b style={{ color: 'var(--orange)' }}>{fmtMoney(j.depositRequired)}</b></span>
              <span>预付款 {fmtMoney(j.prepayment)}</span>
              <div className="spacer" />
              <Link className="btn btn-sm" to={`/ent/jobs/${j.id}/applicants`}>报名与派单</Link>
              {['OPEN', 'FULL', 'IN_PROGRESS'].includes(j.status) && (
                <>
                  <button className="btn btn-sm" onClick={() => setPrepayTarget(j)}>追加预付款</button>
                  <button className="btn btn-sm btn-danger" onClick={() => { setCancelTarget(j); setReason(''); }}>取消岗位</button>
                </>
              )}
            </div>
          </div>
        ))}
        {jobs.length === 0 && <div className="card muted">还没有发布过岗位</div>}
      </div>

      {cancelTarget && (
        <Modal title={`取消岗位：${cancelTarget.title}`} onClose={() => setCancelTarget(null)}
          footer={<button className="btn btn-danger" onClick={doCancel}>确认取消</button>}>
          <Alert kind="warn">
            保证金罚没规则：开工前 2 小时以上取消罚没 20%，2 小时内罚没 50%，已有工人到岗罚没 100%；
            录取工人将被通知且保单作废，取消会计入企业取消率风险画像。
            <br />若在开工前 24 小时内取消且已有工人在途中或到场，平台还会按通知时间/工人位置/签到/历史取消记录
            逐人生成<b>到场补贴/交通补贴建议</b>，需到「取消赔付」页确认支付或拒付（拒付将进入仲裁）。
          </Alert>
          <label className="field"><span>取消原因（将告知工人）</span>
            <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </Modal>
      )}

      {prepayTarget && (
        <Modal title={`追加预付款：${prepayTarget.title}`} onClose={() => setPrepayTarget(null)}
          footer={<button className="btn btn-primary" onClick={doPrepay}>确认预付</button>}>
          <p className="small muted">预付款将在日结时按实际到岗人数平摊抵扣企业应付款。</p>
          <input className="input" type="number" value={prepay} onChange={(e) => setPrepay(Number(e.target.value))} />
        </Modal>
      )}
    </div>
  );
}
