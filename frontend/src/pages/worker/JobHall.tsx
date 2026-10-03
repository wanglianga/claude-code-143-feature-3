import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../../api';
import { Badge, RiskLevel, Spinner, StabilityTag, fmtDate } from '../../components/ui';

const INDUSTRIES = [
  { key: '', label: '全部' },
  { key: 'INVENTORY', label: '商超盘点' },
  { key: 'EXHIBITION', label: '会展搭建' },
  { key: 'WAREHOUSE', label: '仓库分拣' },
  { key: 'CATERING', label: '餐饮帮工' },
  { key: 'CLEANING', label: '保洁突击' },
  { key: 'SECURITY', label: '活动安保' },
];

export default function JobHall() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [ind, setInd] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (ind) qs.set('industry', ind);
    if (q) qs.set('q', q);
    get(`/jobs?${qs.toString()}`).then(setJobs).finally(() => setLoading(false));
  }, [ind, q]);

  return (
    <div>
      <h1>岗位大厅</h1>
      <div className="card row">
        <input className="input" style={{ maxWidth: 260 }} placeholder="搜索岗位 / 地点"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="spacer" />
        <div className="row">
          {INDUSTRIES.map((i) => (
            <button key={i.key} className={`btn btn-sm ${ind === i.key ? 'btn-primary' : ''}`} onClick={() => setInd(i.key)}>
              {i.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? <Spinner /> : jobs.length === 0 ? (
        <div className="card muted">暂无符合条件的岗位</div>
      ) : (
        <div className="grid grid-2">
          {jobs.map((j) => (
            <Link key={j.id} to={`/jobs/${j.id}`} className="card" style={{ display: 'block' }}>
              <div className="row">
                <Badge tone="blue">{j.industryLabel}</Badge>
                <RiskLevel level={j.industryRiskLevel} />
                {j.requireHealthCert && <Badge tone="orange">需健康证</Badge>}
                {j.enterpriseRiskLevel >= 4 && <Badge tone="red">高风险企业·双人确认</Badge>}
                <div className="spacer" />
                <span className="money" style={{ fontSize: 18 }}>¥{j.dailyWage}/班</span>
              </div>
              <h3 style={{ margin: '10px 0 4px' }}>{j.title}</h3>
              <div className="small muted">📍 {j.location}</div>
              <div className="small muted">🕒 {fmtDate(j.startTime)} ~ {fmtDate(j.endTime)}</div>
              <div className="row" style={{ marginTop: 10 }}>
                <span className="small muted">{j.enterpriseName}</span>
                <RiskLevel level={j.enterpriseRiskLevel} />
                {j.stability?.level === 'UNSTABLE' && <Badge tone="red">排序已降权</Badge>}
                <div className="spacer" />
                <span className="small">招 {j.headcount} 人</span>
                <Badge tone={j.status === 'OPEN' ? 'green' : j.status === 'IN_PROGRESS' ? 'blue' : 'orange'}>
                  {j.status === 'OPEN' ? '招募中' : j.status === 'FULL' ? '已报满' : '作业中'}
                </Badge>
              </div>
              {j.stability && j.stability.level !== 'STABLE' && (
                <div style={{ marginTop: 8 }}>
                  <StabilityTag stability={j.stability} size="sm" />
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
