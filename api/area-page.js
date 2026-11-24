// /api/area-page.js
// صفحات هبوط لكل منطقة (/area/:slug) بعنوان ووصف ومحتوى خاص بيها.
//
// المشكلة: الموقع كله صفحة واحدة، فمحركات البحث بتشوف صفحة رئيسية واحدة بس،
// ومفيش صفحة متخصصة تظهر في نتايج بحث زي "شقق للبيع في المنيا الجديدة".
//
// الحل: الدالة دي بتقرا العقارات من نفس Google Sheet اللي بيقرا منه الموقع،
// وبترجّع نفس index.html بالظبط بعد ما تحقن فيه:
//   1) عنوان ووصف ووسوم OG/Twitter وcanonical خاصة بالمنطقة.
//   2) محتوى سيرفر-سايد حقيقي (H1 المنطقة + مقدمة + قائمة لينكات العقارات).
//   3) window.__AREA_PAGE__ عشان الواجهة تفلتر العقارات على المنطقة دي تلقائياً.
//
// الزوار العاديين ومحركات البحث بياخدوا نفس الصفحة (مفيش dynamic rendering هنا).
// أي فشل (الشيت مش متاح...) بيرجّع الصفحة العامة زي ما هي من غير الحقن.

const SHEET_ID = '1ghSjffYNF3HaeokjO6kQTTAoL0o7AKZkyUbkJihqmSs';
const SHEET_GID = '0';
const SHEET_GVIZ_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${SHEET_GID}`;
const BASE_URL = 'https://capital-home.vercel.app';
const SITE_NAME = 'كابيتال هوم';

// نفس منطق normalizeLocationCategory اللي في index.html بالظبط:
// "المنيا شارع طه حسين" بتتصنّف تحت "المنيا".
function normalizeLocationCategory(loc) {
  const clean = String(loc || '').trim();
  if (!clean) return '';
  if (clean.includes('المنيا')) return clean.includes('الجديدة') ? 'المنيا الجديدة' : 'المنيا';
  return clean;
}

// المناطق اللي ليها صفحات. location لازم يطابق ناتج normalizeLocationCategory.
const AREAS = {
  'minya': {
    location: 'المنيا',
    h1: 'عقارات للبيع في المنيا',
    title: 'عقارات للبيع في المنيا | شقق وفلل ومحلات | كابيتال هوم',
    intro:
      'كابيتال هوم بيقدم تشكيلة مختارة من العقارات في قلب محافظة المنيا: شقق على الكورنيش وفي الأحياء الحيوية، فلل، محلات تجارية وأراضٍ، كلها بفحص قانوني كامل وتنسيق مباشر مع الملاك. تصفح الوحدات المتاحة بالأسعار وخطط السداد، وتواصل معنا لمعاينة أي وحدة.'
  },
  'new-minya': {
    location: 'المنيا الجديدة',
    h1: 'عقارات للبيع في المنيا الجديدة',
    title: 'عقارات للبيع في المنيا الجديدة | شقق بالتقسيط | كابيتال هوم',
    intro:
      'المنيا الجديدة من أسرع مدن الصعيد نمواً: تخطيط حديث، شوارع متسعة، وقرب من الجامعات والخدمات. كابيتال هوم بيوفر فيها شققاً بمساحات مختلفة وأنظمة تقسيط مرنة، مع ضمان الأمان القانوني والتعامل المباشر مع المالك. اختر وحدتك من القائمة وتواصل معنا.'
  }
};

const SLUG_RE = /^[a-z0-9-]{1,40}$/;

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

async function fetchAreaProperties(area) {
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
  if (map.id === undefined) return [];
  const get = (r, k) => (map[k] === undefined ? '' : cellText(r && r.c && r.c[map[k]]));
  const out = [];
  for (const r of rows) {
    if (normalizeLocationCategory(get(r, 'locationcategory')) !== area.location) continue;
    const id = get(r, 'id');
    const title = get(r, 'title');
    if (!id || !title) continue;
    const status = get(r, 'status').toLowerCase();
    out.push({
      id,
      title,
      price: get(r, 'price'),
      priceText: get(r, 'pricetext'),
      sold: status === 'sold' || status.includes('مباع')
    });
  }
  return out;
}

function formatPrice(p) {
  if (p.priceText) return p.priceText;
  const n = Number(String(p.price).replace(/[^\d.]/g, ''));
  if (n > 0) return n.toLocaleString('en-US') + ' جنيه';
  return '';
}

function buildDescription(area, count) {
  let text = `${area.h1}: شقق وفلل ومحلات بأمان قانوني وتنسيق مباشر مع الملاك. ${count} عقار متاح الآن على كابيتال هوم.`;
  if (text.length > 190) text = text.slice(0, 187).trimEnd() + '...';
  return text;
}

// يستبدل قيمة content في وسم meta واحد معروف مكانه. بيرجّع { html, ok }
function setMeta(html, attr, name, content) {
  const re = new RegExp('(<meta\\s+' + attr + '="' + name.replace(/[:.]/g, '\\$&') + '"\\s+content=")[^"]*(")');
  if (!re.test(html)) return { html, ok: false };
  return { html: html.replace(re, (m, a, b) => a + escapeAttr(content) + b), ok: true };
}

function buildListingsHtml(props) {
  if (!props.length) return '<p>لا توجد عقارات منشورة في هذه المنطقة حالياً. تواصل معنا وسنبحث لك.</p>';
  const items = props.map((p) => {
    const price = formatPrice(p);
    const label = escapeAttr(p.title) + (price ? ' — ' + escapeAttr(price) : '') + (p.sold ? ' (مباع)' : '');
    return `              <li><a class="text-goldCustom hover:underline font-semibold" href="/property/${encodeURIComponent(p.id)}">${label}</a></li>`;
  }).join('\n');
  return `<ul class="space-y-1.5 text-sm leading-relaxed">\n${items}\n            </ul>`;
}

function applyAreaPage(html, area, slug, props) {
  const available = props.filter((p) => !p.sold).length;
  const description = buildDescription(area, available);
  const url = BASE_URL + '/area/' + slug;
  const missing = [];
  const set = (attr, name, content) => {
    const r = setMeta(html, attr, name, content);
    if (!r.ok) missing.push(name);
    html = r.html;
  };

  html = html.replace(/<title>[^<]*<\/title>/, () => '<title>' + escapeAttr(area.title) + '</title>');
  // H1 واحد بس في الصفحة: بنبدّل عنوان الهيدر الرئيسي بعنوان المنطقة.
  html = html.replace(/<h1([^>]*)>[^<]*<\/h1>/, (m, attrs) => '<h1' + attrs + '>' + escapeAttr(area.h1) + '</h1>');
  set('name', 'description', description);
  set('property', 'og:title', area.title);
  set('property', 'og:description', description);
  set('property', 'og:url', url);
  set('name', 'twitter:title', area.title);
  set('name', 'twitter:description', description);
  html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, (m, a, b) => a + escapeAttr(url) + b);

  // محتوى سيرفر-سايد حقيقي: مقدمة عن المنطقة + قائمة لينكات العقارات،
  // وسكربت صغير يقول للواجهة تفلتر على المنطقة دي. بيتحقن قبل شبكة العقارات.
  const section = `            <section id="areaLanding" class="w-[92%] max-w-3xl mx-auto mb-10 bg-bgCard/40 border border-white/5 rounded-3xl p-6 md:p-8 text-zinc-300 shadow-xl">
              <script>window.__AREA_PAGE__ = ${JSON.stringify({ location: area.location, slug })};<\/script>
              <p class="mb-5 leading-relaxed text-sm md:text-base">${escapeAttr(area.intro)}</p>
              <h2 class="text-white font-bold text-lg mb-3">العقارات المتاحة في ${escapeAttr(area.location)} (${props.length})</h2>
              ${buildListingsHtml(props)}
            </section>
`;
  const anchor = '<div id="propertiesWrapper"';
  const idx = html.indexOf(anchor);
  if (idx === -1) {
    missing.push('propertiesWrapper');
  } else {
    html = html.slice(0, idx) + section + html.slice(idx);
  }
  return { html, missing };
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
  let slug = '';
  try {
    const q = new URL(req.url, 'http://local').searchParams.get('slug') || '';
    slug = decodeURIComponent(q).trim();
  } catch (e) { slug = ''; }

  const area = AREAS[slug];
  const origin = pickOrigin(req);
  let baseHtml = '';
  try {
    baseHtml = await fetchText(origin + '/index.html', 6000);
  } catch (e) {
    console.error('area-page: index.html fetch failed:', e && e.message);
  }

  // slug غير معروف: 404 واضح لمحركات البحث مع لينك للرئيسية للزوار.
  if (!area || !SLUG_RE.test(slug)) {
    const notFound = '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="robots" content="noindex"><title>الصفحة غير موجودة | ' + SITE_NAME + '</title></head><body><p>الصفحة غير موجودة. <a href="/">العودة للرئيسية</a></p></body></html>';
    return sendHtml(res, 404, notFound, CACHE_FALLBACK);
  }

  let props = [];
  try {
    props = await fetchAreaProperties(area);
  } catch (e) {
    console.error('area-page: sheet lookup failed:', e && e.message);
  }

  if (!baseHtml) {
    return sendHtml(res, 200, '<!DOCTYPE html><html lang="ar"><head><meta charset="UTF-8"><meta http-equiv="refresh" content="0;url=/"></head><body><script>location.replace("/");</script></body></html>', CACHE_FALLBACK);
  }

  const { html, missing } = applyAreaPage(baseHtml, area, slug, props);
  if (missing.length) console.error('area-page: anchors not found in index.html:', missing.join(','));
  return sendHtml(res, 200, html, CACHE_OK);
};

// للاختبار فقط
module.exports._internals = { AREAS, applyAreaPage, buildDescription, normalizeLocationCategory, fetchAreaProperties };
