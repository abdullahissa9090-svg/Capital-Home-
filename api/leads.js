'use strict';
// /api/leads.js
// استقبال طلبات العملاء من فورم "لم تجد عقارك؟" وتسجيلها في Google Sheet
// عند صاحب الموقع (تاب Leads) عبر Apps Script Web App.
//
// ليه بروكسي سيرفر مش فetch مباشر من المتصفح؟
//   1) رابط الـ Web App والسر المشترك بيفضلوا على السيرفر (Environment
//      Variables) مش في كود الصفحة، فمحدش يقدر يبعت طلبات وهمية للشيت.
//   2) من غير مشاكل CORS بتاعة Apps Script.
//
// لو المتغيرات مش متظبطة لسه (LEADS_WEBHOOK_URL / LEADS_WEBHOOK_SECRET)
// البوينت بترجّع 503 leads_not_configured، والواجهة بتكمل عادي على واتساب
// زي ما كانت بالظبط.
//
// الإعداد خطوة بخطوة في LEADS-SETUP.md.

const { send, readJsonBody, sendError } = require('./_lib/http');

const MAX_NAME = 60;
const MAX_REQUEST = 500;

// حد بسيط في الذاكرة ضد السبام (بيشتغل على نفس النسخة الدافئة من الفانكشن)
const hits = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 10;
function tooMany(req) {
  const ip = String((req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const rec = hits.get(ip) || { count: 0, reset: now + WINDOW_MS };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + WINDOW_MS; }
  rec.count += 1;
  hits.set(ip, rec);
  if (hits.size > 5000) hits.clear();
  return rec.count > MAX_HITS;
}

// حماية أساسية: POST + JSON + نفس الـ origin + هيدر مخصص (زي guard بتاع الأدمن)
function checkRequest(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    send(res, 405, { error: 'method_not_allowed' });
    return false;
  }
  const origin = req.headers.origin;
  if (origin) {
    let ok = false;
    try { ok = new URL(origin).host === req.headers.host; } catch (e) { ok = false; }
    if (!ok) { send(res, 403, { error: 'bad_origin' }); return false; }
  }
  if (req.headers['x-requested-with'] !== 'ch-site') {
    send(res, 403, { error: 'missing_header' });
    return false;
  }
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (!ct.includes('application/json')) { send(res, 415, { error: 'json_required' }); return false; }
  return true;
}

function clean(v) { return String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim(); }

function validate(body) {
  const name = clean(body && body.name);
  const phoneRaw = clean(body && body.phone);
  const request = clean(body && body.request);
  const phoneDigits = phoneRaw.replace(/[^\d]/g, '');
  if (name.length < 2 || name.length > MAX_NAME) return 'bad_name';
  if (phoneDigits.length < 8 || phoneDigits.length > 15 || !/^[+\d][\d\s\-()]*$/.test(phoneRaw)) return 'bad_phone';
  if (request.length < 3 || request.length > MAX_REQUEST) return 'bad_request';
  return null;
}

async function forwardToSheet(payload, url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: 'follow'
    });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* Apps Script أحياناً بيرجّع HTML عند الخطأ */ }
    if (!r.ok || !data || data.ok !== true) {
      const err = new Error('webhook_rejected');
      err.code = 'webhook_rejected';
      throw err;
    }
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async (req, res) => {
  if (!checkRequest(req, res)) return;
  try {
    const url = process.env.LEADS_WEBHOOK_URL || '';
    const secret = process.env.LEADS_WEBHOOK_SECRET || '';
    if (!url || !secret) return send(res, 503, { error: 'leads_not_configured' });

    if (tooMany(req)) return send(res, 429, { error: 'too_many_requests' });

    const body = await readJsonBody(req);

    // حقل مصيدة للبوتات: مخفي عن البشر، أي قيمة فيه = بوت. بنردّ نجاح وهمي
    // عشان البوت ميعرفش إنه اتكشف.
    if (body && body.company) return send(res, 200, { ok: true });

    const invalid = validate(body);
    if (invalid) return send(res, 400, { error: invalid });

    await forwardToSheet({
      secret,
      name: clean(body.name),
      phone: clean(body.phone),
      request: clean(body.request),
      source: 'lead-form',
      page: clean(body.page).slice(0, 200)
    }, url);

    return send(res, 200, { ok: true });
  } catch (e) {
    if (e && e.code === 'webhook_rejected') return send(res, 502, { error: 'webhook_rejected' });
    return sendError(res, e);
  }
};
