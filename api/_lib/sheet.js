'use strict';
// التأكد إن الـ ID موجود فعلاً في شيت العقارات (قراءة بس، من السيرفر).

const DEFAULT_SHEET_ID = '1ghSjffYNF3HaeokjO6kQTTAoL0o7AKZkyUbkJihqmSs';

function gvizUrl() {
  if (process.env.SHEET_GVIZ_URL) return process.env.SHEET_GVIZ_URL;
  const id = process.env.SHEET_ID || DEFAULT_SHEET_ID;
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json&gid=0&headers=1`;
}

// نفس قواعد تنقية الـ id اللي في الموقع (index.html)
function sanitizeId(v) { return String(v).replace(/[^\w\-. \u0600-\u06FF]/g, ''); }

function isValidId(id) {
  return typeof id === 'string' && id.length >= 1 && id.length <= 60 && sanitizeId(id) === id && id.trim() === id;
}

function cellText(cell) {
  if (!cell) return '';
  if (cell.v !== null && cell.v !== undefined) return String(cell.v);
  return cell.f !== null && cell.f !== undefined ? String(cell.f) : '';
}

async function findPropertyById(id) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(gvizUrl(), { signal: controller.signal });
    if (!res.ok) { const e = new Error('sheet_unreachable'); e.code = 'sheet_unreachable'; throw e; }
    const text = await res.text();
    const start = text.indexOf('{'), end = text.lastIndexOf('}');
    const data = JSON.parse(text.substring(start, end + 1));
    const cols = (data.table && data.table.cols) || [];
    const rows = (data.table && data.table.rows) || [];
    const map = {};
    cols.forEach((c, i) => {
      const m = String((c && c.label) || '').match(/\(([a-zA-Z]+)\)/);
      if (m && !(m[1].toLowerCase() in map)) map[m[1].toLowerCase()] = i;
    });
    if (map.id === undefined) { const e = new Error('sheet_unreachable'); e.code = 'sheet_unreachable'; throw e; }
    const get = (r, k) => (map[k] === undefined ? '' : cellText(r.c && r.c[map[k]]));
    for (const r of rows) {
      if (sanitizeId(get(r, 'id')) === id) {
        return {
          id,
          title: get(r, 'title'),
          category: get(r, 'category'),
          priceText: get(r, 'pricetext'),
          status: get(r, 'status')
        };
      }
    }
    return null;
  } catch (e) {
    if (e.code === 'sheet_unreachable') throw e;
    const err = new Error('sheet_unreachable'); err.code = 'sheet_unreachable'; throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { findPropertyById, isValidId, sanitizeId };
