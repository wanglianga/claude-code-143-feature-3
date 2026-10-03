import { useEffect, useState } from 'react';
import { get, post } from '../../api';
import { Alert, Badge, Field, RiskLevel, Spinner, fmtMoney } from '../../components/ui';

export default function EntDashboard() {
  const [data, setData] = useState<any>(null);
  const [amount, setAmount] = useState(5000);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const load = () => get('/enterprise/home').then(setData);
  useEffect(() => { load(); }, []);
  if (!data) return <Spinner />;
  const e = data.enterprise;
  const high = e.riskLevel >= 4;

  const recharge = async () => {
    setMsg(''); setError('');
    try {
      await post('/enterprise/deposit/recharge', { amount: Number(amount) });
      setMsg(`保证金充值 ${fmtMoney(amount)} 成功`);
      await load();
    } catch (er: any) { setError(er.message); }
  };

  return (
    <div>
      <h1>企业总览</h1>
      {msg && <Alert kind="ok">{msg}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}

      {high && (
        <Alert kind="error">
          贵企业当前风险等级 L{e.riskLevel}，已被平台列为长期高风险企业：
          近 {e.totalJobs} 单中取消率 {(Number(e.cancelRate) * 100).toFixed(0)}%、
          有责争议率 {(Number(e.disputeRate) * 100).toFixed(0)}%、工伤率 {(Number(e.injuryRate) * 100).toFixed(0)}%。
          新发岗位保证金将按 <b>3.0 倍</b>上浮，且所有到岗必须 <b>双人现场确认</b>。
        </Alert>
      )}

      <div className="grid grid-4">
        <div className="card stat"><div className="v">{data.stats.totalJobs}</div><div className="l">累计发单</div></div>
        <div className="card stat"><div className="v money">{fmtMoney(data.stats.availableDeposit)}</div><div className="l">可用保证金</div></div>
        <div className="card stat"><div className="v" style={{ color: 'var(--orange)' }}>{fmtMoney(data.stats.frozenDeposit)}</div><div className="l">冻结中保证金</div></div>
        <div className="card stat"><div className="v">{data.stats.cancelled}</div><div className="l">取消岗位</div></div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>企业画像</h2>
          <div className="kv">
            <span className="k">企业名称</span><span>{e.name}</span>
            <span className="k">风险等级</span><span><RiskLevel level={e.riskLevel} /> {high && <Badge tone="red">高风险加严监管</Badge>}</span>
            <span className="k">取消率</span><span>{(Number(e.cancelRate) * 100).toFixed(0)}%（{e.cancelledJobs}/{e.totalJobs}，阈值 15%）</span>
            <span className="k">有责争议率</span><span>{(Number(e.disputeRate) * 100).toFixed(0)}%（{e.lostDisputes} 次有责 / {e.disputedAssignments} 次申诉，阈值 20%）</span>
            <span className="k">工伤率</span><span>{(Number(e.injuryRate) * 100).toFixed(0)}%（{e.injuryJobs} 次，阈值 10%）</span>
            <span className="k">临期取消赔付</span><span>{e.lateCancelCompensatedJobs || 0} 次（确认的开工前 2 小时内取消）</span>
            <span className="k">拒付仲裁败诉</span><span>{e.arbitrationLostCount || 0} 次</span>
            <span className="k">保证金附加倍率</span><span className={Number(e.depositSurchargeRate) > 0 ? '' : 'muted'}>+{Number(e.depositSurchargeRate || 0).toFixed(1)} 倍（败诉叠加，封顶 +1.5）</span>
            <span className="k">排序模型罚分</span><span className={Number(e.rankPenalty) > 0 ? '' : 'muted'}>{e.rankPenalty || 0} 分（岗位大厅降权）</span>
          </div>
          <div className="fab-space" />
          <div className="small muted">风险画像在发单、取消、申诉裁决、工伤确认后由系统自动重算（近 3 单起计）。</div>
        </div>

        <div className="card">
          <h2>保证金账户</h2>
          <p className="small muted">发单时按「行业基准保证金 × 企业风险倍率 × 人数」冻结；正常完工释放，企业取消按规则罚没。</p>
          <Field label="充值金额（元）">
            <div className="row">
              <input className="input" type="number" value={amount} onChange={(ev) => setAmount(Number(ev.target.value))} />
              <button className="btn btn-primary" onClick={recharge}>充值</button>
            </div>
          </Field>
          <div className="risk-pills">
            {[1000, 5000, 20000].map((v) => (
              <button key={v} className="btn btn-sm" onClick={() => setAmount(v)}>{fmtMoney(v)}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>现场主管账号（{data.supervisors.length}）</h2>
        {data.supervisors.length === 0 ? (
          <div className="muted small">尚未配置主管账号（演示环境由平台预置）。主管负责出示动态二维码、四重到岗确认、作业事件审批；高风险岗位需两名负责人确认。</div>
        ) : (
          <table>
            <thead><tr><th>用户名</th><th>姓名</th><th>电话</th></tr></thead>
            <tbody>
              {data.supervisors.map((s: any) => (
                <tr key={s.id}><td>{s.username}</td><td>{s.name}</td><td>{s.phone}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
