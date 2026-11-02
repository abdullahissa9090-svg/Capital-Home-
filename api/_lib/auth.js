'use strict';
// تسجيل دخول المدير: كلمة سر واحدة (من Environment Variables) + جلسة موقّعة
// في كوكي HttpOnly. مفيش أسرار بتروح للمتصفح.
const crypto = require('crypto');
const { send } = require('./http');

const COOKIE_NAME = 'ch_admin';
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function config() {
  const password = process.env.ADMIN_PASSWORD || '';
  const secret = process.env.SESSION_SECRET || '';
  if (password.length < 8 || secret.length < 32) {
    const e = new Error('auth_not_configured');
    e.code = 'auth_not_configured';
    throw e;
  }
  return { password, secret };
}

function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest(); }
function safeEqual(a, b) { return crypto.timingSafeEqual(sha256(a), sha256(b)); }
function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function hmac(secret, data) { return crypto.createHmac('sha256', secret).update(data).digest('base64url'); }

function checkPassword(input) {
  const { password } = config();
  return safeEqual(String(input || ''), password);
}

function createSessionToken() {
  const { secret } = config();
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ iat: now, exp: now + SESSION_TTL_SECONDS, n: crypto.randomBytes(8).toString('hex') }));
  return payload + '.' + hmac(secret, payload);
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  });
  return out;
}

function verifySessionToken(token) {
  try {
    const { secret } = config();
    const [payload, sig] = String(token || '').split('.');
    if (!payload || !sig) return false;
    const expected = hmac(secret, payload);
    if (!safeEqual(sig, expected)) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof data.exp === 'number' && data.exp > Math.floor(Date.now() / 1000);
  } catch (e) {
    return false;
  }
}

function isAuthenticated(req) {
  return verifySessionToken(parseCookies(req.headers.cookie)[COOKIE_NAME]);
}

function cookieAttrs(maxAge) {
  const secure = process.env.ALLOW_INSECURE_COOKIE === '1' ? '' : '; Secure';
  return `; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}
function sessionCookie(token) { return `${COOKIE_NAME}=${token}${cookieAttrs(SESSION_TTL_SECONDS)}`; }
function clearCookie() { return `${COOKIE_NAME}=${cookieAttrs(0)}`; }

function requireAdmin(req, res) {
  let ok = false;
  try { ok = isAuthenticated(req); }
  catch (e) { send(res, 500, { error: 'auth_not_configured' }); return false; }
  if (!ok) { send(res, 401, { error: 'unauthorized' }); return false; }
  return true;
}

// دليل إن الـ blob عدّى من فحص الصور عندنا (HMAC على sha + امتداد + id)
function blobProof(sha, ext, id) {
  const { secret } = config();
  return hmac(secret + ':blob', `${sha}|${ext}|${id}`);
}
function verifyBlobProof(sha, ext, id, proof) {
  try { return safeEqual(proof, blobProof(sha, ext, id)); } catch (e) { return false; }
}

// حد محاولات الدخول (بيشتغل جوه نفس الـ instance، فهو طبقة إضافية مش بديل للـ WAF)
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
function clientKey(req) {
  return String(req.headers['x-forwarded-for'] || req.socket && req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}
function isLocked(req) {
  const rec = attempts.get(clientKey(req));
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) { attempts.delete(clientKey(req)); return false; }
  return rec.count >= MAX_FAILS;
}
function recordFailure(req) {
  const k = clientKey(req);
  const rec = attempts.get(k);
  if (!rec || Date.now() - rec.first > WINDOW_MS) attempts.set(k, { count: 1, first: Date.now() });
  else rec.count++;
}
function clearFailures(req) { attempts.delete(clientKey(req)); }
function _resetAttemptsForTests() { attempts.clear(); }

module.exports = {
  checkPassword, createSessionToken, verifySessionToken, isAuthenticated, requireAdmin,
  sessionCookie, clearCookie, blobProof, verifyBlobProof,
  isLocked, recordFailure, clearFailures, _resetAttemptsForTests, SESSION_TTL_SECONDS
};
