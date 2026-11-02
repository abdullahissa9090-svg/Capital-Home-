'use strict';
// أدوات HTTP صغيرة مشتركة بين كل endpoints لوحة الصور.

const MAX_BODY_BYTES = 3 * 1024 * 1024; // أقل من حد فيرسل (4.5MB)

function send(res, status, body, headers) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (headers) Object.keys(headers).forEach(k => res.setHeader(k, headers[k]));
  res.end(JSON.stringify(body));
}

function getQuery(req) {
  try { return Object.fromEntries(new URL(req.url, 'http://local').searchParams); }
  catch (e) { return {}; }
}

async function readJsonBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8'));
    if (typeof req.body === 'object') return req.body;
    return JSON.parse(String(req.body));
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) { const e = new Error('body_too_large'); e.code = 'body_too_large'; throw e; }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

// فحص الطريقة + حماية CSRF (الكوكي SameSite=Strict + هيدر مخصص + فحص Origin)
function guard(req, res, method) {
  if (req.method !== method) {
    res.setHeader('Allow', method);
    send(res, 405, { error: 'method_not_allowed' });
    return false;
  }
  const origin = req.headers.origin;
  if (origin) {
    let ok = false;
    try { ok = new URL(origin).host === req.headers.host; } catch (e) { ok = false; }
    if (!ok) { send(res, 403, { error: 'bad_origin' }); return false; }
  }
  if (req.headers['x-requested-with'] !== 'ch-admin') {
    send(res, 403, { error: 'missing_csrf_header' });
    return false;
  }
  if (method !== 'GET') {
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    if (!ct.includes('application/json')) { send(res, 415, { error: 'json_required' }); return false; }
  }
  return true;
}

module.exports = { send, getQuery, readJsonBody, guard, MAX_BODY_BYTES };

// تحويل الأخطاء الداخلية لردود واضحة من غير ما نسرّب تفاصيل حساسة
function sendError(res, e) {
  const code = e && e.code;
  if (code === 'auth_not_configured') return send(res, 500, { error: 'auth_not_configured' });
  if (code === 'github_not_configured') return send(res, 500, { error: 'github_not_configured' });
  if (code === 'sheet_unreachable') return send(res, 503, { error: 'sheet_unreachable' });
  if (code === 'body_too_large') return send(res, 413, { error: 'body_too_large' });
  if (e instanceof SyntaxError) return send(res, 400, { error: 'invalid_json' });
  if (e && e.name === 'GhError') {
    const status = e.status === 401 || e.status === 403 ? 502 : (e.status === 504 ? 504 : 502);
    return send(res, status, { error: 'github_error', githubStatus: e.status });
  }
  console.error('admin api error:', e && e.message);
  return send(res, 500, { error: 'server_error' });
}
module.exports.sendError = sendError;
