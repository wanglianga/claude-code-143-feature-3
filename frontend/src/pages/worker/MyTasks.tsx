import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../../api';
import { Badge, Spinner, StatusBadge, fmtDate, fmtMoney } from '../../components/ui';

function CompStatusText({ status }: { status: string }) {
  const map: Record<string, string> = {
    SUGGESTED: '待企业确认',
    PAID: '已到账',
    ARBITRATION: '仲裁中',
    ARBITRATED_PAID: '仲裁判付已到账',
    ARBITRATED_WAIVED: '仲裁豁免',
    NONE_REQUIRED: '无需补偿',
  };
  return <span className="muted">{map[status] || status}</span>;
}

export default function MyTasks() {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { get('/my/applications').then(setList).finally(() => setLoading(false)); }, []);

  if (loading) return <Spinner />;

  return (
    <div>
      <h1>我的任务</h1>
      {list.length === 0 ? (
        <div className="card muted">还没有报名记录，去 <Link to="/jobs">岗位大厅</Link> 看看吧</div>
      ) : (
        <div className="col">
          {list.map((a) => (
            <div key={a.id} className="card">
              <div className="row">
                <Badge tone="blue">{a.job.industryLabel}</Badge>
                <b>{a.job.title}</b>
                <div className="spacer" />
                <StatusBadge status={a.status} />
              </div>
              <div className="small muted" style={{ margin: '6px 0' }}>
                {a.job.enterpriseName} · 📍 {a.job.location} · 🕒 {fmtDate(a.job.startTime)}
              </div>
              <div className="row">
                {a.settlement ? (
                  <span className="small">日结应发 <b className={Number(a.settlement.workerPayable) > 0 ? 'money-green' : ''}>{fmtMoney(a.settlement.workerPayable)}</b>
                    <StatusBadge status={a.settlement.status} /></span>
                ) : (
                  <span className="small muted">日结单待完工后生成</span>
                )}
                <div className="spacer" />
                {['ACCEPTED', 'CHECKED_IN', 'WORKING', 'COMPLETED', 'LEFT_EARLY'].includes(a.status) && (
                  <Link className="btn btn-primary btn-sm" to={`/room/${a.id}`}>进入任务室 →</Link>
                )}
              </div>
              {a.compensation && (
                <div className="row small" style={{ marginTop: 6 }}>
                  <Badge tone={a.compensation.kind === 'ATTENDANCE' ? 'purple' : a.compensation.kind === 'TRANSPORT' ? 'blue' : 'gray'}>
                    取消赔付·{a.compensation.kind === 'ATTENDANCE' ? '到场补贴' : a.compensation.kind === 'TRANSPORT' ? '交通补贴' : '无需补偿'}
                  </Badge>
                  <span>金额 <b className="money">{fmtMoney(a.compensation.finalAmount ?? a.compensation.suggestedAmount)}</b></span>
                  <CompStatusText status={a.compensation.status} />
                  <div className="spacer" />
                  <Link className="btn btn-sm" to={`/room/${a.id}`}>查看详情 →</Link>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
