'use strict';
const { send, getQuery, guard, sendError } = require('../_lib/http');
const { requireAdmin } = require('../_lib/auth');
const { findPropertyById, isValidId } = require('../_lib/sheet');
const { readManifestAtBranch } = require('../_lib/github');

module.exports = async (req, res) => {
  if (!guard(req, res, 'GET')) return;
  if (!requireAdmin(req, res)) return;
  try {
    const id = String(getQuery(req).id || '').trim();
    if (!isValidId(id)) return send(res, 400, { error: 'invalid_id' });
    const property = await findPropertyById(id);
    if (!property) return send(res, 200, { found: false });
    let existingPhotos = [];
    try {
      const manifest = await readManifestAtBranch();
      existingPhotos = manifest.galleries[id] || [];
    } catch (e) { existingPhotos = []; }
    return send(res, 200, { found: true, property, existingPhotos });
  } catch (e) { return sendError(res, e); }
};
