'use strict';
/**
 * 學校系統交接（spelling-srs-backend 的「本課作業」→ Auto-Grader → 回傳成績）。
 *
 * 學校系統（每間分校是獨立服務）產生一張 HMAC 簽章的交接票，放在網址 fragment：
 *   /assignment.html#handoff=<base64url(payload)>.<base64url(hmac)>
 *   payload = { b: 分校代碼, sid: 學生 id, iid: 作業 id, lvl, unit, book, name, ret?, exp }
 * 每間分校一把密鑰與一個回傳網址（Auto-Grader 的環境變數）：
 *   HANDOFF_SECRET_<B>    與該分校 LESSON_HANDOFF_SECRET 相同
 *   HANDOFF_CALLBACK_<B>  例如 https://tienmu.kniph.app/api/lesson-tasks/grader-callback
 * <B> 是分校代碼大寫、非英數換成底線（tienmu → TIENMU）。回傳網址只從環境變數來，
 * 不從票或請求內容來，所以票不能把成績送到別的地方。
 *
 * 學生自己輸入名字的原本用法完全不變；只有帶交接票時才鎖定名字並回傳成績。
 */
const crypto = require('crypto');

const hmac = (secret, s) => crypto.createHmac('sha256', secret).update(s).digest('base64url');
const envKey = (b) => String(b || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');

function branchConfig(b, env = process.env) {
  const key = envKey(b);
  if (!key) return null;
  const secret = env[`HANDOFF_SECRET_${key}`] || '';
  const callback = env[`HANDOFF_CALLBACK_${key}`] || '';
  const callbackOk = /^https:\/\//.test(callback) || /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(callback);
  if (secret.length < 32 || !callbackOk) return null;
  return { secret, callback };
}

/** 驗證交接票；回傳 { payload, config } 或 null。allowExpiredSec 用於交卷時（學生可能寫很久）。 */
function verifyHandoff(token, { now = Date.now(), allowExpiredSec = 0, env = process.env } = {}) {
  if (typeof token !== 'string' || token.length > 2000) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (_) { return null; }
  if (!p || typeof p !== 'object') return null;
  const config = branchConfig(p.b, env);
  if (!config) return null;
  const expect = hmac(config.secret, body);
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  if (!Number.isFinite(p.exp) || p.exp + allowExpiredSec < Math.floor(now / 1000)) return null;
  if (!Number.isInteger(p.lvl) || !Number.isInteger(p.unit) || !/^[ABC]$/.test(String(p.book || ''))) return null;
  return { payload: p, config };
}

/** 交卷後把成績送回學校系統。簽章字串與 spelling-srs-backend 的 callbackSigningString 相同。 */
async function sendResult({ token, config, result }, { attempts = 3, fetchImpl = fetch } = {}) {
  const ts = Math.floor(Date.now() / 1000);
  const r = {
    submission_id: result.submission_id, total_score: result.total_score, total_possible: result.total_possible,
    percentage: result.percentage, score_status: result.score_status,
  };
  const signing = `${token}.${r.submission_id}.${r.total_score}.${r.total_possible}.${r.percentage}.${r.score_status}`;
  const body = JSON.stringify({ token, ts, sig: hmac(config.secret, `${ts}.${signing}`), result: r });
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetchImpl(config.callback, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(8000),
      });
      if (res.ok) return { ok: true };
      last = `HTTP ${res.status}`;
      if (res.status >= 400 && res.status < 500) break; // 4xx 重送也不會好
    } catch (err) {
      last = err.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
  }
  return { ok: false, error: last };
}

/** 交卷後要回到的學校頁面：只能是回傳網址的同一個網站。 */
function returnUrl(payload, config) {
  const ret = String(payload.ret || '');
  if (!/^\/[A-Za-z0-9/_\-.]*$/.test(ret)) return null;
  return new URL(config.callback).origin + ret;
}

module.exports = { verifyHandoff, sendResult, returnUrl, branchConfig, hmac };
