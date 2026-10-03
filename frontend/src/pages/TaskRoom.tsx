import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { get, post } from '../api';
import { useAuth } from '../auth';
import {
  Alert, Badge, EventTypeTag, Field, Modal, Spinner, StatusBadge,
  fmtDateTime, fmtMoney,
} from '../components/ui';

const EVENT_TYPES = [
  { key: 'OVERTIME', label: '临时加班' },
  { key: 'POSITION_CHANGE', label: '岗位调换' },
  { key: 'EARLY_LEAVE', label: '工人早退' },
  { key: 'EXTRA_CARRY', label: '额外搬运' },
  { key: 'INJURY', label: '工人受伤' },
  { key: 'WAGE_DISPUTE', label: '工资被扣争议' },
  { key: 'OTHER', label: '其他' },
];

export default function TaskRoom() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [room, setRoom] = useState<any>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState(false);
  const timer = useRef<any>(null);

  const load = async (silent = false) => {
    try {
      const r = await get(`/assignments/${id}/room`);
      setRoom(r);
    } catch (e: any) { if (!silent) setError(e.message); }
  };
  useEffect(() => {
    load();
    timer.current = setInterval(() => load(true), 5000);
    return () => clearInterval(timer.current);
  }, [id]);

  const act = async (fn: () => Promise<any>, okMsg?: string) => {
    setError(''); setMsg(''); setBusy(true);
    try {
      const r = await fn();
      if (r?.message) setMsg(r.message);
      else if (okMsg) setMsg(okMsg);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!room) return <Spinner />;

  const isWorker = user?.role === 'WORKER';
  const isField = user?.role === 'SUPERVISOR' || user?.role === 'ENTERPRISE';
  const a = room.assignment;
  const canCheckIn = a.status === 'ACCEPTED';
  const canCheckOut = ['WORKING', 'CHECKED_IN'].includes(a.status);

  return (
    <div>
      <button className="btn btn-sm" onClick={() => nav(-1)}>← 返回</button>
      <div className="fab-space" />
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="ok">{msg}</Alert>}

      <div className="card">
        <div className="row">
          <Badge tone="blue">{room.job.industryLabel}</Badge>
          <b style={{ fontSize: 16 }}>{room.job.title}</b>
          <div className="spacer" />
          <StatusBadge status={a.status} />
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>
          {room.enterprise.name} · 📍 {room.job.location} · 🕒 {fmtDateTime(room.job.startTime)} ~ {fmtDateTime(room.job.endTime)}
        </div>
        <div className="small" style={{ marginTop: 6 }}>
          工人：{room.worker.name}（{room.worker.phone}）· 现场主管：
          {room.supervisors.map((s: any) => s.name).join('、') || '未指派'}
        </div>
      </div>

      <div className="tabs">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>考勤与保险</button>
        <button className={tab === 'events' ? 'active' : ''} onClick={() => setTab('events')}>作业事件 ({room.events.length})</button>
        <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>任务沟通 ({room.messages.length})</button>
        <button className={tab === 'settlement' ? 'active' : ''} onClick={() => setTab('settlement')}>日结结算</button>
      </div>

      {tab === 'overview' && (
        <>
          <CompensationCard room={room} isField={isField} />
          <InsuranceCard room={room} />

          {isWorker && canCheckIn && (
            <LocationPanel room={room} busy={busy} onReported={load} />
          )}

          {isWorker && (canCheckIn || canCheckOut) && (
            <CheckInPanel
              mode={canCheckIn ? 'in' : 'out'}
              job={room.job}
              busy={busy}
              onSubmit={(dto) => act(() => post(canCheckIn ? '/attendance/check-in' : '/attendance/check-out', { assignmentId: a.id, ...dto }))}
            />
          )}

          {isField && <SupervisorActions room={room} busy={busy} onAct={act} />}

          <div className="card">
            <h2>签到轨迹（四重校验）</h2>
            {room.attendance.length === 0 && <div className="muted small">暂无考勤记录</div>}
            <div className="timeline">
              {room.attendance.map((e: any) => (
                <div key={e.id} className="t-item">
                  <div className="row">
                    <b>{e.kind === 'CHECK_IN' ? '到岗签到' : '完工签退'}</b>
                    {e.allPassed ? <Badge tone="green">四重通过</Badge> : <Badge tone="orange">待确认/未通过</Badge>}
                    <span className="small muted">{fmtDateTime(e.eventTime)}</span>
                  </div>
                  <div className="small" style={{ marginTop: 4 }}>
                    {e.locationPassed ? '✅定位' : `❌定位(${e.distanceMeters}m)`} ·
                    {e.facePassed ? `✅人脸(${e.faceScore})` : '❌人脸'} ·
                    {e.qrcodePassed ? '✅二维码' : '❌二维码'} ·
                    {e.supervisorConfirmed ? `✅主管确认(#${e.confirmedBySupervisorId})` : '⬜主管确认'}
                    {room.job.strictConfirmation && (e.secondConfirmed ? ' · ✅双人复核' : ' · ⬜双人复核')}
                    {e.photoUrl && ' · 📷现场照片'}
                  </div>
                  {e.failReason && <div className="small" style={{ color: 'var(--orange)' }}>{e.failReason}</div>}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === 'events' && (
        <EventsTab room={room} isWorker={isWorker} isField={isField} busy={busy} onAct={act} />
      )}

      {tab === 'chat' && <ChatTab room={room} onSent={load} />}

      {tab === 'settlement' && (
        <SettlementTab room={room} isWorker={isWorker} isField={isField} busy={busy} onAct={act} gotoAppeal={() => nav('/my/appeals')} />
      )}
    </div>
  );
}

/* ---------------- 取消赔付 ---------------- */
function CompensationCard({ room, isField }: { room: any; isField: boolean }) {
  const { user } = useAuth();
  const c = room.compensation;
  const [busy2, setBusy2] = useState(false);
  const [refuseOpen, setRefuseOpen] = useState(false);
  const [note, setNote] = useState('');
  const [tip, setTip] = useState('');

  if (!c) return null;
  const decided = c.status !== 'SUGGESTED';

  const confirmPay = async () => {
    setTip(''); setBusy2(true);
    try {
      await post(`/compensations/${c.id}/confirm`, { note: '企业确认平台补偿建议' });
      window.location.reload();
    } catch (e: any) { setTip(e.message); } finally { setBusy2(false); }
  };
  const refusePay = async () => {
    setTip(''); setBusy2(true);
    try {
      await post(`/compensations/${c.id}/refuse`, { note });
      window.location.reload();
    } catch (e: any) { setTip(e.message); } finally { setBusy2(false); }
  };

  return (
    <div className="card" style={{ borderColor: 'var(--orange)' }}>
      <div className="row">
        <h2 style={{ margin: 0 }}>企业临时取消 · 工人赔付</h2>
        <div className="spacer" />
        <StatusBadge status={c.status} />
      </div>
      <div className="grid grid-2" style={{ marginTop: 10 }}>
        <div className="kv">
          <span className="k">通知档位</span><span>{c.noticeTierLabel}（开工前 {c.minutesToStart} 分钟）</span>
          <span className="k">工人位置</span><span>{c.locationBucketLabel || c.locationBucket}{c.distanceMeters !== null ? `（距签到点 ${c.distanceMeters}m）` : ''}</span>
          <span className="k">是否已签到</span><span>{c.checkedIn ? '已四重签到' : '未签到'}</span>
          <span className="k">历史取消倍率</span><span>此前临期取消 {c.priorLateCancels} 次 → ×{c.historyMultiplier}</span>
        </div>
        <div className="kv">
          <span className="k">到场补贴</span><span className="money">{fmtMoney(c.attendanceAllowance)}</span>
          <span className="k">交通补贴</span><span className="money">{fmtMoney(c.transportAllowance)}</span>
          <span className="k">建议/应付合计</span><span className="money" style={{ fontSize: 18 }}>{fmtMoney(c.totalAmount)}</span>
          {c.awardedAmount && <><span className="k">仲裁裁决金额</span><span className="money">{fmtMoney(c.awardedAmount)}</span></>}
        </div>
      </div>
      <pre className="rule-box" style={{ whiteSpace: 'pre-wrap' }}>{c.ruleBreakdown}</pre>

      {c.enterpriseNote && <div className="small" style={{ color: 'var(--red, #c0392b)' }}>企业意见：{c.enterpriseNote}</div>}
      {c.arbitrationAward && (
        <Alert kind="warn"><b>仲裁裁决：</b>{c.arbitrationAward}</Alert>
      )}
      {(c.status === 'PAID' || c.status === 'ARBITRATION_AWARD_PAY') && (
        <Alert kind="ok">✅ 补贴已从企业保证金账户扣划并于 {fmtDateTime(c.paidAt)} 到账，工人已收到平台通知。</Alert>
      )}
      {tip && <Alert kind="error">{tip}</Alert>}

      {user?.role === 'ENTERPRISE' && c.status === 'SUGGESTED' && (
        <div className="row">
          <span className="small muted">确认后立即从保证金账户扣划给工人；拒付将进入平台仲裁，败诉会影响后续发单保证金与排序。</span>
          <div className="spacer" />
          <button className="btn btn-success" disabled={busy2} onClick={confirmPay}>确认支付 {fmtMoney(c.totalAmount)}</button>
          <button className="btn btn-danger" disabled={busy2} onClick={() => setRefuseOpen(true)}>拒绝支付</button>
        </div>
      )}
      {isField && decided === false && user?.role === 'SUPERVISOR' && (
        <div className="small muted">等待企业在「岗位管理 · 取消赔付」中确认或拒付。</div>
      )}

      {refuseOpen && (
        <Modal title="拒绝支付（将提交平台仲裁）" onClose={() => setRefuseOpen(false)}
          footer={<button className="btn btn-danger" disabled={busy2 || !note.trim()} onClick={refusePay}>确认拒付并进入仲裁</button>}>
          <Alert kind="error">
            拒付后订单进入平台仲裁：客服将依据位置心跳、签到轨迹、通知时间与历史取消记录裁决。
            若被判有责，除应付补贴外，后续发单保证金附加 +0.5 倍（封顶 +1.5 倍），岗位排序将被降权。
          </Alert>
          <Field label="拒付理由（必填，工人与仲裁员可见）">
            <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  );
}

/* ---------------- 工人赴岗位置上报 ---------------- */
function LocationPanel({ room, busy, onReported }: { room: any; busy: boolean; onReported: () => void }) {
  const job = room.job;
  const [lat, setLat] = useState(Number(job.lat));
  const [lng, setLng] = useState(Number(job.lng));
  const [msg, setMsg] = useState('');
  const pings: any[] = room.locationPings || [];
  const latest = pings[pings.length - 1];

  const quick = (kind: 'home' | 'route' | 'nearby' | 'site') => {
    if (kind === 'site') { setLat(Number(job.lat) + 0.0007); setLng(Number(job.lng) + 0.0004); }
    if (kind === 'nearby') { setLat(Number(job.lat) + 0.006); setLng(Number(job.lng) + 0.002); }
    if (kind === 'route') { setLat(Number(job.lat) + 0.024); setLng(Number(job.lng)); }
    if (kind === 'home') { setLat(31.0); setLng(121.0); }
  };

  const send = async () => {
    setMsg('');
    try {
      const r = await post(`/assignments/${room.assignment.id}/location`, { lat, lng });
      setMsg(`已上报位置：距签到点 ${r.distanceMeters}m（${bucketLabel(r.bucket)}），企业临期取消时将作为补贴依据`);
      onReported();
    } catch (e: any) { setMsg(e.message); }
  };

  return (
    <div className="card">
      <h2>赴岗位置上报（取消赔付依据）</h2>
      <div className="small muted">
        赴岗途中可多次上报位置。若企业在开工前临时取消，平台将依据通知时间、最后位置（在途中/到场附近/已到现场）与签到状态生成到场或交通补贴建议。
      </div>
      {latest && (
        <div className="small" style={{ margin: '6px 0' }}>
          最近一次上报：距签到点 <b>{latest.distanceMeters}m</b>（{bucketLabel(latest.bucket)}）· {fmtDateTime(latest.createdAt)}
        </div>
      )}
      <div className="row">
        <button className="btn btn-sm" onClick={() => quick('route')}>🧪 模拟在途中(~2.6km)</button>
        <button className="btn btn-sm" onClick={() => quick('nearby')}>🧪 模拟到场附近(~700m)</button>
        <button className="btn btn-sm" onClick={() => quick('site')}>🧪 模拟已到现场(~90m)</button>
        <div className="spacer" />
        <input className="input" style={{ width: 130 }} type="number" step="0.0001" value={lat} onChange={(e) => setLat(Number(e.target.value))} />
        <input className="input" style={{ width: 130 }} type="number" step="0.0001" value={lng} onChange={(e) => setLng(Number(e.target.value))} />
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={send}>上报位置</button>
      </div>
      {msg && <><div className="fab-space" /><Alert kind="info">{msg}</Alert></>}
      {pings.length > 0 && (
        <div className="timeline" style={{ marginTop: 8 }}>
          {pings.slice().reverse().map((p) => (
            <div key={p.id} className="t-item small">
              {fmtDateTime(p.createdAt)} · {Number(p.lat).toFixed(4)},{Number(p.lng).toFixed(4)} · 距签到点 {p.distanceMeters}m（{bucketLabel(p.bucket)}）
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function bucketLabel(b: string) {
  return ({ ON_SITE: '已到现场', NEARBY: '到场附近', EN_ROUTE: '在途中', AT_HOME: '尚未出发' } as any)[b] || b;
}

/* ---------------- 保险 ---------------- */
function InsuranceCard({ room }: { room: any }) {
  const p = room.policy;
  return (
    <div className="card">
      <div className="row">
        <h2 style={{ margin: 0 }}>保险保单</h2>
        <div className="spacer" />
        {p ? <StatusBadge status={p.status} /> : <Badge tone="gray">录取后生成</Badge>}
      </div>
      {p ? (
        <div className="grid grid-2" style={{ marginTop: 10 }}>
          <div className="kv">
            <span className="k">产品</span><span>{p.insurerProduct}</span>
            <span className="k">保额</span><span>{p.coverageWan} 万元</span>
            <span className="k">保费</span><span>{fmtMoney(p.premium)}（企业承担）</span>
            <span className="k">岗位风险</span><span><Badge tone={p.jobRiskLevel >= 4 ? 'red' : 'orange'}>L{p.jobRiskLevel}</Badge></span>
          </div>
          <div className="kv">
            <span className="k">企业确认</span><span>{p.enterpriseConfirmed ? <Badge tone="green">已确认承保</Badge> : <Badge tone="orange">未确认</Badge>}</span>
            <span className="k">生效时间</span><span>{p.effectiveFrom ? fmtDateTime(p.effectiveFrom) : '待四重到岗校验通过后即时生效'}</span>
            <span className="k">终止时间</span><span>{p.effectiveTo ? fmtDateTime(p.effectiveTo) : '—'}</span>
            <span className="k">生效凭据</span><span>{p.activatedByAttendanceId ? `锚定签到记录 #${p.activatedByAttendanceId} 的服务器时间` : '—'}</span>
          </div>
        </div>
      ) : <div className="muted small">工人被录取后系统自动生成保单（待生效）。</div>}
      {p && p.status !== 'ACTIVE' && p.status !== 'EXPIRED' && (
        <Alert kind="warn">保险尚未生效：未完成「定位 + 人脸 + 二维码 + 主管确认」四重到岗校验前发生事故不在保障范围，且平台禁止事后补录。</Alert>
      )}
      {room.claim && (
        <Alert kind={room.claim.coveredAtOccurrence ? 'ok' : 'error'}>
          工伤理赔单：{room.claim.injuryDesc} — {room.claim.coveredAtOccurrence
            ? '事故时保险在保障期内' : '事故时保险未生效，不予赔付，且不可事后补录'}（{room.claim.status}）
        </Alert>
      )}
    </div>
  );
}

/* ---------------- 工人签到 ---------------- */
function CheckInPanel({ mode, job, busy, onSubmit }: { mode: 'in' | 'out'; job: any; busy: boolean; onSubmit: (dto: any) => void }) {
  const [lat, setLat] = useState(Number(job.lat));
  const [lng, setLng] = useState(Number(job.lng));
  const [token, setToken] = useState('');
  const [face, setFace] = useState(true);

  const locate = (far: boolean) => {
    if (far) { setLat(31.0); setLng(121.0); return; }
    if (!navigator.geolocation) { setLat(Number(job.lat)); setLng(Number(job.lng)); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLat(Number(pos.coords.latitude.toFixed(6))); setLng(Number(pos.coords.longitude.toFixed(6))); },
      () => { setLat(Number(job.lat)); setLng(Number(job.lng)); },
      { timeout: 4000 },
    );
  };

  return (
    <div className="card">
      <h2>{mode === 'in' ? '到岗签到' : '完工签退'}（四重校验）</h2>
      <div className="checklist">
        <div className={`ci ${Math.abs(lat - Number(job.lat)) < 0.001 ? 'pass' : 'fail'}`}>
          <span className="ico">{Math.abs(lat - Number(job.lat)) < 0.001 ? '✅' : '❌'}</span>
          <span><b>定位围栏</b>（签到点 300m 内）当前坐标 {lat.toFixed(4)}, {lng.toFixed(4)}</span>
        </div>
        <div className={`ci ${face ? 'pass' : 'fail'}`}><span className="ico">{face ? '✅' : '❌'}</span><span><b>人脸抓拍比对</b>（与人脸样本比对，演示模拟得分 ≥ 90）</span></div>
        <div className={`ci ${token ? 'pass' : 'fail'}`}><span className="ico">{token ? '✅' : '⬜'}</span><span><b>扫描现场动态二维码</b>（主管端每分钟轮换）</span></div>
        <div className="ci fail"><span className="ico">⬜</span><span><b>现场主管确认</b>（提交后由主管独立完成，不能自证）</span></div>
      </div>
      <div className="grid grid-2">
        <Field label="定位坐标">
          <div className="row">
            <input className="input" value={lat} onChange={(e) => setLat(Number(e.target.value))} />
            <input className="input" value={lng} onChange={(e) => setLng(Number(e.target.value))} />
          </div>
        </Field>
        <Field label="现场二维码口令">
          <input className="input" value={token} onChange={(e) => setToken(e.target.value)} placeholder="扫码或输入 8 位口令" />
        </Field>
      </div>
      <div className="row">
        <button className="btn btn-sm" onClick={() => locate(false)}>📍 获取我的定位</button>
        <button className="btn btn-sm" onClick={() => locate(true)}>🧪 模拟偏离签到点</button>
        <label className="row small"><input type="checkbox" checked={face} onChange={(e) => setFace(e.target.checked)} /> 人脸比对通过</label>
        <div className="spacer" />
        <button className="btn btn-primary" disabled={busy}
          onClick={() => onSubmit({ lat, lng, qrcodeToken: token, facePassed: face, photoUrl: `mock://photo-${Date.now()}` })}>
          {mode === 'in' ? '提交到岗签到' : '提交完工签退'}
        </button>
      </div>
    </div>
  );
}

/* ---------------- 主管现场操作 ---------------- */
function SupervisorActions({ room, busy, onAct }: { room: any; busy: boolean; onAct: any }) {
  const pending = room.attendance.filter((e: any) => !e.allPassed && e.locationPassed && e.facePassed && e.qrcodePassed);
  const accepted = room.assignment.status === 'ACCEPTED';
  return (
    <div className="card">
      <h2>现场主管工作台</h2>
      <QrCode jobId={room.job.id} />
      <div className="fab-space" />
      {pending.length === 0 && <div className="muted small">暂无等待确认的到岗签到</div>}
      {pending.map((e: any) => (
        <div key={e.id} className="alert alert-info row" style={{ marginBottom: 8 }}>
          <span>{room.worker.name} 已于 {fmtDateTime(e.eventTime)} 完成定位/人脸/二维码三要素
            {room.job.strictConfirmation && '（高风险岗位需双人确认）'}</span>
          <div className="spacer" />
          <button className="btn btn-success btn-sm" disabled={busy}
            onClick={() => onAct(() => post(`/attendance/${e.id}/supervisor-confirm`))}>
            {e.supervisorConfirmed ? '第二名负责人复核确认' : '确认工人到岗'}
          </button>
        </div>
      ))}
      {accepted && (
        <div className="row">
          <span className="small muted">工人尚未到岗</span>
          <div className="spacer" />
          <button className="btn btn-sm btn-danger" disabled={busy}
            onClick={() => onAct(() => post(`/assignments/${room.assignment.id}/no-show`), '已标记爽约，保单作废')}>
            开工 15 分钟未到岗 · 标记爽约
          </button>
        </div>
      )}
    </div>
  );
}

function QrCode({ jobId }: { jobId: number }) {
  const [qr, setQr] = useState<{ token: string; expireSeconds: number } | null>(null);
  useEffect(() => {
    const tick = () => get(`/jobs/${jobId}/qrcode`).then(setQr).catch(() => {});
    tick();
    const t = setInterval(tick, 10000);
    return () => clearInterval(t);
  }, [jobId]);
  return (
    <div>
      <div className="small muted" style={{ marginBottom: 6 }}>出示给工人扫描的动态签到口令（每 60 秒轮换，防代签）：</div>
      <div className="qr-box">{qr?.token || '…'}</div>
    </div>
  );
}

/* ---------------- 作业事件 ---------------- */
function EventsTab({ room, isWorker, isField, busy, onAct }: any) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('OVERTIME');
  const [desc, setDesc] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [newPosition, setNewPosition] = useState('');
  const [claimAmount, setClaimAmount] = useState(5000);

  const submit = async () => {
    await onAct(() => post('/events', {
      assignmentId: room.assignment.id, type, description: desc,
      minutes: ['OVERTIME', 'EARLY_LEAVE', 'EXTRA_CARRY'].includes(type) ? Number(minutes) : undefined,
      newPosition: type === 'POSITION_CHANGE' ? newPosition : undefined,
      claimAmount: type === 'INJURY' ? Number(claimAmount) : undefined,
      lat: room.job.lat, lng: room.job.lng, photoUrl: `mock://event-${Date.now()}`,
    }), '事件已现场实时上报（服务器时间不可篡改）');
    setOpen(false); setDesc('');
  };

  return (
    <>
      {isWorker && ['WORKING', 'CHECKED_IN'].includes(room.assignment.status) && (
        <div className="card row">
          <b>作业过程发生情况？</b>
          <div className="spacer" />
          <button className="btn btn-primary" onClick={() => setOpen(true)}>现场实时上报事件</button>
        </div>
      )}
      <div className="card">
        <h2>事件记录（派单/考勤/保险/工时/结算同任务关联）</h2>
        {room.events.length === 0 && <div className="muted small">暂无事件</div>}
        {room.events.map((e: any) => (
          <div key={e.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
            <div className="row">
              <EventTypeTag type={e.type} />
              <StatusBadge status={e.status} />
              <span className="small muted">{fmtDateTime(e.occurredAt)}</span>
              {e.minutes ? <span className="small">{e.minutes} 分钟</span> : null}
              {e.newPosition ? <span className="small">调至：{e.newPosition}</span> : null}
              <div className="spacer" />
              {isField && e.status === 'PENDING' && (
                <div className="row">
                  <button className="btn btn-success btn-sm" disabled={busy}
                    onClick={() => onAct(() => post(`/events/${e.id}/review`, { approve: true, note: '现场确认情况属实' }))}>批准</button>
                  <button className="btn btn-danger btn-sm" disabled={busy}
                    onClick={() => onAct(() => post(`/events/${e.id}/review`, { approve: false, note: '情况不属实' }))}>驳回</button>
                </div>
              )}
            </div>
            <div className="small" style={{ marginTop: 4 }}>{e.description} {e.photoUrl && '📷'}</div>
            {e.reviewNote && <div className="small muted">审核备注：{e.reviewNote}</div>}
          </div>
        ))}
      </div>

      {open && (
        <Modal title="现场实时上报事件" onClose={() => setOpen(false)}
          footer={<button className="btn btn-primary" onClick={submit}>立即上报</button>}>
          <Alert kind="warn">事件时间取平台服务器当前时间，必须现场实时上报；事后补录将被系统拒绝。</Alert>
          <Field label="事件类型">
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              {EVENT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="情况描述">
            <textarea className="input" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="请描述现场情况" />
          </Field>
          {['OVERTIME', 'EARLY_LEAVE', 'EXTRA_CARRY'].includes(type) && (
            <Field label="时长（分钟）"><input className="input" type="number" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></Field>
          )}
          {type === 'POSITION_CHANGE' && (
            <Field label="调换后的新岗位"><input className="input" value={newPosition} onChange={(e) => setNewPosition(e.target.value)} /></Field>
          )}
          {type === 'INJURY' && (
            <>
              <Field label="预估理赔金额（元）"><input className="input" type="number" value={claimAmount} onChange={(e) => setClaimAmount(Number(e.target.value))} /></Field>
              <Alert kind="info">系统将即时判定事故时点保险是否在保障期内；未完成四重到岗校验的事故不能理赔。</Alert>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

/* ---------------- 聊天 ---------------- */
function ChatTab({ room, onSent }: any) {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const send = async () => {
    if (!text.trim()) return;
    await post(`/assignments/${room.assignment.id}/messages`, { content: text });
    setText('');
    onSent();
  };
  return (
    <div className="card">
      <h2>任务沟通（客服裁决可调取）</h2>
      <div className="chat col">
        {room.messages.map((m: any) => (
          <div key={m.id} className={`chat-row ${m.senderId === user?.id ? 'me' : 'other'}`}>
            <div className="bubble">
              <div className="meta">{m.senderName} · {m.senderRole === 'WORKER' ? '工人' : m.senderRole === 'SUPERVISOR' ? '主管' : '企业'} · {fmtDateTime(m.createdAt)}</div>
              {m.content}
            </div>
          </div>
        ))}
        {room.messages.length === 0 && <div className="muted small">暂无消息</div>}
      </div>
      <div className="fab-space" />
      <div className="row">
        <input className="input" value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="输入消息，与主管/企业沟通加班、扣款等事项…" />
        <button className="btn btn-primary" onClick={send}>发送</button>
      </div>
    </div>
  );
}

/* ---------------- 结算 ---------------- */
function SettlementTab({ room, isWorker, isField, busy, onAct, gotoAppeal }: any) {
  const s = room.settlement;
  const [appealOpen, setAppealOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState(0);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');

  const line = (k: string, v: any, cls = '') => (
    <div className="row" style={{ padding: '6px 0', borderBottom: '1px dashed var(--line)' }}>
      <span className="muted">{k}</span><div className="spacer" /><span className={cls}>{v}</span>
    </div>
  );

  return (
    <>
      <div className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>日结明细</h2>
          <div className="spacer" />
          {s && <StatusBadge status={s.status} />}
        </div>
        {!s ? (
          <Alert kind="info">完工签退后系统自动生成结算明细。</Alert>
        ) : (
          <>
            {line('有效工时', `${s.workMinutes} 分钟（迟到 ${s.lateMinutes} 分钟，加班 ${s.overtimeMinutes} 分钟）`)}
            {line('基础工资', fmtMoney(s.baseWage))}
            {line('加班费', `+ ${fmtMoney(s.overtimePay)}`, 'money-green')}
            {line('额外搬运补贴', `+ ${fmtMoney(s.extraCarryPay)}`, 'money-green')}
            {line('餐补', `+ ${fmtMoney(s.mealAllowance)}`, 'money-green')}
            {line('迟到扣款', `- ${fmtMoney(s.lateDeduction)}`, s.lateDeduction > 0 ? '' : '')}
            {line('其他扣款', `- ${fmtMoney(s.otherDeduction)}`)}
            {s.deductionReason && <div className="small" style={{ color: 'var(--orange)' }}>扣款说明：{s.deductionReason}</div>}
            <div className="row" style={{ padding: '10px 0' }}>
              <b>工人应发合计</b><div className="spacer" /><span className="money" style={{ fontSize: 20 }}>{fmtMoney(s.workerPayable)}</span>
            </div>
            <div className="small muted">
              企业侧：保费 {fmtMoney(s.insurancePremium)} + 平台服务费 {fmtMoney(s.platformServiceFee)}，
              企业应付 {fmtMoney(s.enterpriseCharged)}（预付款抵扣 {fmtMoney(s.enterprisePrepaymentUsed)}）
            </div>
            <div className="fab-space" />
            <div className="row">
              {isWorker && (
                <button className="btn btn-warn" onClick={() => { setAppealOpen(true); setAmount(Math.max(0, Number(s.lateDeduction))); }}>
                  对工资有异议 · 发起申诉
                </button>
              )}
              {isField && s.status !== 'PAID' && s.status !== 'ADJUSTED' && (
                <button className="btn btn-success" disabled={busy}
                  onClick={() => onAct(() => post('/settlements/pay', { assignmentIds: [room.assignment.id] }), '日结工资已发放')}>
                  确认并发放日结
                </button>
              )}
              {isField && (
                <button className="btn" disabled={busy}
                  onClick={() => onAct(() => post(`/settlements/job/${room.job.id}/generate`), '已按最新工时/事件重算')}>
                  重算明细
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {['COMPLETED', 'LEFT_EARLY'].includes(room.assignment.status) && (
        <div className="card">
          <h2>{isWorker ? '评价企业' : '评价工人'}</h2>
          <div className="row">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className="btn btn-sm" style={{ fontSize: 18, background: rating >= n ? '#fff7e0' : '#fff' }}
                onClick={() => setRating(n)}>⭐</button>
            ))}
            <span className="small muted">{rating} 分</span>
          </div>
          <div className="fab-space" />
          <textarea className="input" rows={2} placeholder="评价内容（可选）" value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="fab-space" />
          <button className="btn btn-primary" disabled={busy}
            onClick={() => onAct(() => post(`/reviews/assignments/${room.assignment.id}`, { rating, comment }), '评价已提交')}>
            提交评价
          </button>
        </div>
      )}

      {appealOpen && (
        <Modal title="发起工资争议申诉" onClose={() => setAppealOpen(false)}
          footer={<button className="btn btn-warn" disabled={busy}
            onClick={() => onAct(async () => {
              const r = await post('/appeals', { assignmentId: room.assignment.id, reason, claimedAmount: Number(amount) });
              setAppealOpen(false);
              gotoAppeal();
              return r;
            })}>提交申诉</button>}>
          <Field label="申诉理由（客服将调取签到轨迹/主管确认/现场照片/聊天记录）">
            <textarea className="input" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Field label="诉求补发金额（元）"><input className="input" type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
        </Modal>
      )}
    </>
  );
}
