// /api/property-page.js
// معاينة الرابط (Link Preview) لصفحات العقارات /property/:id
//
// المشكلة: لما رابط عقار يتبعت في واتساب أو فيسبوك أو تليجرام، الـ crawler
// بتاعهم بيقرا الـ HTML الأولي بس ومبيشغّلش الجافاسكريبت، فكان بيشوف عنوان
// وصورة الموقع العامة لكل العقارات.
//
// الحل: الـ vercel.json بيوجّه طلبات الـ crawlers دي بس (بحسب User-Agent) لهنا.
// الدالة بتقرا العقار من نفس Google Sheet اللي بيقرا منه الموقع، وبتحط
// عنوانه وسعره وأول صورة له في وسوم الـ meta داخل نفس index.html بالظبط.
// الزوار العاديين ومحركات البحث مبيعدّوش من هنا خالص، فمفيش أي تغيير عليهم.
//
// أي فشل (الشيت مش متاح، العقار مش موجود...) بيرجّع الصفحة العامة زي ما هي.

const SHEET_ID = '1ghSjffYNF3HaeokjO6kQTTAoL0o7AKZkyUbkJihqmSs';
const SHEET_GID = '0';
const SHEET_GVIZ_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${SHEET_GID}`;
const BASE_URL = 'https://capital-home.vercel.app';
const SITE_NAME = 'كابيتال هوم';

// نفس قواعد الـ id اللي في الموقع (حروف وأرقام وعربي و _ - . ومسافة)
const ID_RE = /^[\w\-. \u0600-\u06FF]{1,60}$/;

const PAYMENT_PLAN_KEYWORDS = [
  ['offer', 'الأوفر'],
  ['paid', 'المدفوع'],
  ['remaining', 'المتبقي'],
  ['value', 'قيمة القسط']
];

function resolveColumnKey(label) {
  const raw = String(label || '').trim();
  if (!raw) return null;
  const parenMatch = raw.match(/\(([a-zA-Z]+)\)/);
  if (parenMatch) return parenMatch[1].toLowerCase();
  for (const [key, keyword] of PAYMENT_PLAN_KEYWORDS) {
    if (raw.includes(keyword)) return key;
  }
  return null;
}

function cellText(cell) {
  if (!cell) return '';
  if (cell.v !== null && cell.v !== undefined) return String(cell.v).trim();
  return cell.f !== null && cell.f !== undefined ? String(cell.f).trim() : '';
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchText(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

async function findProperty(id) {
  const text = await fetchText(SHEET_GVIZ_URL, 6000);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end < start) throw new Error('bad gviz response');
  const data = JSON.parse(text.substring(start, end + 1));
  const cols = (data && data.table && data.table.cols) || [];
  const rows = (data && data.table && data.table.rows) || [];
  const map = {};
  cols.forEach((c, i) => {
    const k = resolveColumnKey(c && c.label);
    if (k && !(k in map)) map[k] = i;
  });
  if (map.id === undefined) return null;
  const get = (r, k) => (map[k] === undefined ? '' : cellText(r && r.c && r.c[map[k]]));
  for (const r of rows) {
    if (get(r, 'id').replace(/[^\w\-. \u0600-\u06FF]/g, '') !== id) continue;
    const title = get(r, 'title');
    if (!title) return null;
    const status = get(r, 'status').toLowerCase();
    return {
      id,
      title,
      price: get(r, 'price'),
      priceText: get(r, 'pricetext'),
      locationCategory: get(r, 'locationcategory'),
      finishing: get(r, 'finishing'),
      image: get(r, 'image'),
      meta: get(r, 'meta'),
      sold: status === 'sold' || status.includes('مباع')
    };
  }
  return null;
}

function formatPrice(prop) {
  if (prop.priceText) return prop.priceText;
  const n = Number(String(prop.price).replace(/[^\d.]/g, ''));
  if (n > 0) return n.toLocaleString('en-US') + ' جنيه';
  return '';
}

function buildDescription(prop) {
  const parts = [];
  if (prop.sold) parts.push('تم بيع هذه الوحدة');
  const price = formatPrice(prop);
  if (price) parts.push(price);
  if (prop.locationCategory) parts.push(prop.locationCategory);
  if (prop.finishing) parts.push(prop.finishing);
  const metaItems = String(prop.meta || '')
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 3);
  parts.push(...metaItems);
  let text = parts.join(' • ');
  if (text.length > 190) text = text.slice(0, 187).trimEnd() + '...';
  return text || 'تفاصيل العقار على كابيتال هوم';
}

function absoluteImage(origin, path) {
  const p = String(path || '').trim();
  if (!p) return '';
  if (/^https:\/\//i.test(p)) return p;
  if (/^http:\/\//i.test(p) || p.startsWith('//')) return '';
  return origin + (p.startsWith('/') ? p : '/' + p);
}

async function pickImage(origin, prop) {
  try {
    const gallery = JSON.parse(await fetchText(origin + '/photo-gallery.json', 4000));
    const first = gallery && gallery.galleries && gallery.galleries[prop.id] && gallery.galleries[prop.id][0];
    const abs = absoluteImage(origin, first);
    if (abs) return abs;
  } catch (e) { /* نكمل للصورة اللي في الشيت */ }
  return absoluteImage(origin, prop.image);
}

// يستبدل قيمة content في وسم meta واحد معروف مكانه. بيرجّع { html, ok }
function setMeta(html, attr, name, content) {
  const re = new RegExp('(<meta\\s+' + attr + '="' + name.replace(/[:.]/g, '\\$&') + '"\\s+content=")[^"]*(")');
  if (!re.test(html)) return { html, ok: false };
  return { html: html.replace(re, (m, a, b) => a + escapeAttr(content) + b), ok: true };
}

function applyPreview(html, prop, imageUrl) {
  const title = prop.title + ' | ' + SITE_NAME;
  const description = buildDescription(prop);
  const url = BASE_URL + '/property/' + encodeURIComponent(prop.id);
  const missing = [];
  const set = (attr, name, content) => {
    const r = setMeta(html, attr, name, content);
    if (!r.ok) missing.push(name);
    html = r.html;
  };

  html = html.replace(/<title>[^<]*<\/title>/, () => '<title>' + escapeAttr(title) + '</title>');
  set('name', 'description', description);
  set('property', 'og:title', title);
  set('property', 'og:description', description);
  set('property', 'og:url', url);
  set('name', 'twitter:title', title);
  set('name', 'twitter:description', description);
  html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, (m, a, b) => a + escapeAttr(url) + b);

  if (imageUrl) {
    set('property', 'og:image', imageUrl);
    set('name', 'twitter:image', imageUrl);
    // أبعاد صورة الموقع العامة مش بتنطبق على صورة العقار
    html = html.replace(/<meta\s+property="og:image:(width|height)"\s+content="[^"]*"\s*>\s*/g, '');
  }
  return { html, missing };
}

// صفحة بسيطة جدًا لو مقدرناش نجيب index.html: الـ crawler بيقرا الوسوم،
// وأي إنسان بيوصل لها بيتحوّل فورًا لصفحة العقار العادية.
function minimalPage(prop, imageUrl) {
  const title = prop.title + ' | ' + SITE_NAME;
  const description = buildDescription(prop);
  const url = BASE_URL + '/property/' + encodeURIComponent(prop.id);
  const target = '/?property=' + encodeURIComponent(prop.id);
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<title>${escapeAttr(title)}</title>
<meta name="description" content="${escapeAttr(description)}">
<link rel="canonical" href="${escapeAttr(url)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeAttr(title)}">
<meta property="og:description" content="${escapeAttr(description)}">
<meta property="og:url" content="${escapeAttr(url)}">
<meta property="og:site_name" content="${SITE_NAME}">
${imageUrl ? `<meta property="og:image" content="${escapeAttr(imageUrl)}">\n` : ''}<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0;url=${escapeAttr(target)}">
</head><body><script>location.replace(${JSON.stringify(target)});</script></body></html>`;
}

function pickOrigin(req) {
  const host = String((req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '').split(',')[0].trim();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.vercel\.app$/i.test(host) ? 'https://' + host : BASE_URL;
}

function sendHtml(res, status, html, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(html);
}

const CACHE_OK = 'public, s-maxage=600, stale-while-revalidate=3600';
const CACHE_FALLBACK = 'public, s-maxage=60, stale-while-revalidate=300';

module.exports = async (req, res) => {
  let id = '';
  try {
    const q = new URL(req.url, 'http://local').searchParams.get('id') || '';
    id = decodeURIComponent(q).trim();
  } catch (e) { id = ''; }

  const origin = pickOrigin(req);
  let baseHtml = '';
  try {
    baseHtml = await fetchText(origin + '/index.html', 6000);
  } catch (e) {
    console.error('property-page: index.html fetch failed:', e && e.message);
  }

  // id غير صالح أو الصفحة الأساسية مش متاحة => نرجّع الصفحة العامة كما هي (لو معانا)
  let prop = null;
  if (ID_RE.test(id)) {
    try {
      prop = await findProperty(id);
    } catch (e) {
      console.error('property-page: sheet lookup failed:', e && e.message);
    }
  }

  if (!prop) {
    if (baseHtml) return sendHtml(res, 200, baseHtml, CACHE_FALLBACK);
    return sendHtml(res, 200, '<!DOCTYPE html><html lang="ar"><head><meta charset="UTF-8"><meta http-equiv="refresh" content="0;url=/"></head><body><script>location.replace("/");</script></body></html>', CACHE_FALLBACK);
  }

  const imageUrl = await pickImage(origin, prop);
  if (!baseHtml) return sendHtml(res, 200, minimalPage(prop, imageUrl), CACHE_FALLBACK);

  const { html, missing } = applyPreview(baseHtml, prop, imageUrl);
  if (missing.length) console.error('property-page: meta tags not found in index.html:', missing.join(','));
  return sendHtml(res, 200, html, CACHE_OK);
};

// للاختبار فقط
module.exports._internals = { applyPreview, buildDescription, minimalPage, findProperty, resolveColumnKey };
