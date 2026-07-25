// /api/sitemap.js
// يولّد sitemap.xml ديناميكياً وقت الطلب، بيانات العقارات بتتجاب لحظياً
// من نفس Google Sheet اللي بيقرأ منه الموقع، فأي عقار يتضاف/يتحذف
// من الشيت بيظهر/يختفي من الـ sitemap تلقائياً من غير أي تعديل كود.

const SHEET_ID = '1ghSjffYNF3HaeokjO6kQTTAoL0o7AKZkyUbkJihqmSs';
const SHEET_GID = '0';
const SHEET_GVIZ_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${SHEET_GID}`;
const BASE_URL = 'https://capital-home.vercel.app';

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

function buildColumnIndexMap(cols) {
  const map = {};
  (cols || []).forEach((col, index) => {
    const key = resolveColumnKey(col && col.label);
    if (key && !(key in map)) map[key] = index;
  });
  return map;
}

function getCell(cells, colIndexMap, key) {
  const idx = colIndexMap[key];
  if (idx === undefined || !cells || !cells[idx]) return '';
  const v = cells[idx].v;
  return v === null || v === undefined ? '' : String(v).trim();
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseGvizResponse(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('صيغة استجابة gviz غير متوقعة');
  }
  return JSON.parse(text.substring(start, end + 1));
}

async function fetchPropertyIds() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(SHEET_GVIZ_URL, { signal: controller.signal });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const text = await response.text();
    const data = parseGvizResponse(text);

    const cols = (data && data.table && data.table.cols) || [];
    const rows = (data && data.table && data.table.rows) || [];
    const colIndexMap = buildColumnIndexMap(cols);

    if (!('id' in colIndexMap)) return [];

    return rows
      .map((r) => getCell(r && r.c, colIndexMap, 'id'))
      .filter(Boolean);
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildSitemapXml(ids) {
  const today = new Date().toISOString().split('T')[0];

  const staticEntry = `  <url>
    <loc>${BASE_URL}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>`;

  const propertyEntries = ids.map((id) => `  <url>
    <loc>${BASE_URL}/property/${escapeXml(encodeURIComponent(id))}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticEntry}
${propertyEntries}
</urlset>`;
}

module.exports = async (req, res) => {
  try {
    const ids = await fetchPropertyIds();
    const xml = buildSitemapXml(ids);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    // كاش قصير على مستوى الـ CDN مع السماح بتقديم نسخة قديمة أثناء
    // التحديث في الخلفية، بدل ما كل زيارة تعمل طلب جديد لجوجل شيت.
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).send(xml);
  } catch (err) {
    console.error('sitemap generation failed:', err);
    // في حالة فشل القراءة من الشيت، نرجّع خريطة موقع بسيطة بالصفحة
    // الرئيسية بس، بدل ما نرجّع خطأ 500 لمحركات البحث.
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=300');
    res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${BASE_URL}/</loc>
  </url>
</urlset>`);
  }
};
