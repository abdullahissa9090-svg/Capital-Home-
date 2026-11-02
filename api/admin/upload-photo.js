'use strict';
// بيرفع صورة واحدة كـ blob (طلب صغير) بعد فحص نوعها وحجمها. مش بيعمل commit.
const { send, readJsonBody, guard, sendError } = require('../_lib/http');
const { requireAdmin, blobProof } = require('../_lib/auth');
const { isValidId } = require('../_lib/sheet');
const { createBlob } = require('../_lib/github');

const MAX_BYTES = 1536 * 1024;        // 1.5MB بعد الضغط
const MAX_BASE64_CHARS = Math.ceil(MAX_BYTES * 4 / 3) + 16;

function detectType(buf) {
  if (buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpg';
  return null;
}

module.exports = async (req, res) => {
  if (!guard(req, res, 'POST')) return;
  if (!requireAdmin(req, res)) return;
  try {
    const body = await readJsonBody(req);
    const id = String((body && body.id) || '').trim();
    const data = body && body.data;
    if (!isValidId(id)) return send(res, 400, { error: 'invalid_id' });
    if (typeof data === 'string' && data.length > MAX_BASE64_CHARS) return send(res, 413, { error: 'image_too_large' });
    if (typeof data !== 'string' || !data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      return send(res, 400, { error: 'invalid_image_data' });
    }
    const buf = Buffer.from(data, 'base64');
    if (buf.length > MAX_BYTES) return send(res, 413, { error: 'image_too_large' });
    const ext = detectType(buf);
    if (!ext) return send(res, 415, { error: 'unsupported_image_type' });
    const sha = await createBlob(data);
    return send(res, 200, { sha, ext, proof: blobProof(sha, ext, id), bytes: buf.length });
  } catch (e) { return sendError(res, e); }
};
