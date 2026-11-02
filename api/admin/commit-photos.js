'use strict';
// بيربط الصور المرفوعة بالعقار: commit واحد فيه الصور + photo-gallery.json.
const { send, readJsonBody, guard, sendError } = require('../_lib/http');
const { requireAdmin, verifyBlobProof } = require('../_lib/auth');
const { findPropertyById, isValidId } = require('../_lib/sheet');
const { commitGallery } = require('../_lib/github');

const MIN_PHOTOS = 1;
const MAX_PHOTOS = 8;

// اسم فولدر آمن للـ id (حروف وأرقام و ~ و - و _ بس): نفس الـ id دايماً بيدي نفس الاسم
function dirNameFor(id) {
  return encodeURIComponent(id).replace(/[%.]/g, c => (c === '%' ? '~' : '~2E'));
}

module.exports = async (req, res) => {
  if (!guard(req, res, 'POST')) return;
  if (!requireAdmin(req, res)) return;
  try {
    const body = await readJsonBody(req);
    const id = String((body && body.id) || '').trim();
    const photos = body && body.photos;
    if (!isValidId(id)) return send(res, 400, { error: 'invalid_id' });
    if (!Array.isArray(photos) || photos.length < MIN_PHOTOS || photos.length > MAX_PHOTOS) {
      return send(res, 400, { error: 'invalid_photo_count', min: MIN_PHOTOS, max: MAX_PHOTOS });
    }
    const seen = new Set();
    for (const p of photos) {
      const okShape = p && /^[0-9a-f]{40}$/.test(p.sha) && (p.ext === 'webp' || p.ext === 'jpg') && typeof p.proof === 'string';
      if (!okShape || !verifyBlobProof(p.sha, p.ext, id, p.proof)) return send(res, 400, { error: 'invalid_photo_reference' });
      if (seen.has(p.sha)) return send(res, 400, { error: 'duplicate_photo' });
      seen.add(p.sha);
    }

    const property = await findPropertyById(id);
    if (!property) return send(res, 404, { error: 'property_not_found' });

    const dir = dirNameFor(id);
    const stamp = Date.now().toString(36); // أسماء فريدة: القديم مبيتمسحش ولا بيتدوس عليه
    const files = photos.map((p, i) => {
      const rel = `property-photos/${dir}/${stamp}-${i + 1}.${p.ext}`;
      return { sha: p.sha, path: rel, url: '/' + rel };
    });
    const message = `Update photo gallery for ${id.replace(/[\r\n]/g, ' ')} (${files.length} photos)`;
    const result = await commitGallery({ id, files, message });
    return send(res, 200, { ok: true, commit: result.commitSha, urls: files.map(f => f.url), property });
  } catch (e) { return sendError(res, e); }
};

module.exports.dirNameFor = dirNameFor;
