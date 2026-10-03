import { useState } from 'react';
import { post } from '../../api';
import { useAuth } from '../../auth';
import { Alert, Badge, Field, Face, fmtMoney } from '../../components/ui';

export default function Profile() {
  const { user, refresh } = useAuth();
  const [idCardNo, setIdCardNo] = useState(user?.idCardNo || '');
  const [healthCertUntil, setHealth] = useState(user?.healthCertUntil || '');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const save = async () => {
    setMsg(''); setError('');
    try {
      await post('/auth/worker-profile', { idCardNo: idCardNo || undefined, healthCertUntil: healthCertUntil || undefined });
      await refresh();
      setMsg('实名资料已保存');
    } catch (e: any) { setError(e.message); }
  };

  const enrollFace = async () => {
    setMsg(''); setError('');
    try {
      // 演示环境：以头像占位地址模拟人脸样本采集
      await post('/auth/worker-profile', { faceSampleUrl: `face://enrolled-${user?.id}-${Date.now()}` });
      await refresh();
      setMsg('人脸样本采集成功，到岗签到时将自动进行人脸比对');
    } catch (e: any) { setError(e.message); }
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <h1>实名与资质资料</h1>
      {msg && <Alert kind="ok">{msg}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}

      <div className="card">
        <div className="row">
          <Face name={user?.name || '?'} />
          <div>
            <h3 style={{ margin: 0 }}>{user?.name} <span className="small muted">@{user?.username}</span></h3>
            <div className="row small" style={{ marginTop: 4 }}>
              {user?.idVerified ? <Badge tone="green">已实名</Badge> : <Badge tone="red">未实名</Badge>}
              {user?.healthCertUntil
                ? <Badge tone="green">健康证至 {user.healthCertUntil}</Badge>
                : <Badge tone="gray">无健康证</Badge>}
              {user?.hasFaceSample ? <Badge tone="green">人脸已采集</Badge> : <Badge tone="orange">未采集人脸</Badge>}
            </div>
          </div>
          <div className="spacer" />
          <div style={{ textAlign: 'right' }}>
            <div className="small muted">钱包余额（取消赔付等到账）</div>
            <div className="money" style={{ fontSize: 22 }}>{fmtMoney(user?.walletBalance ?? 0)}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>实名认证 / 健康证</h2>
        <Field label="身份证号">
          <input className="input" value={idCardNo} disabled={user?.idVerified}
            onChange={(e) => setIdCardNo(e.target.value)} placeholder="提交后进入实名审核（演示环境即时通过）" />
        </Field>
        <Field label="健康证有效期至（餐饮岗位必需）">
          <input className="input" type="date" value={healthCertUntil} onChange={(e) => setHealth(e.target.value)} />
        </Field>
        <button className="btn btn-primary" onClick={save}>保存资料</button>
      </div>

      <div className="card">
        <h2>人脸样本采集</h2>
        <p className="muted small">到岗与签退时，系统将把现场抓拍与人脸样本比对（演示环境使用模拟比对，得分 ≥ 90 视为通过）。</p>
        <button className={user?.hasFaceSample ? 'btn' : 'btn btn-primary'} onClick={enrollFace}>
          {user?.hasFaceSample ? '重新采集人脸' : '立即采集人脸样本'}
        </button>
      </div>
    </div>
  );
}
