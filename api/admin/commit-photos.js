"use strict";
// بيربط الصور المرفوعة بالعقار: commit واحد فيه الصور + photo-gallery.json.
const { send, readJsonBody, guard, sendError } = require("../_lib/http");
const { requireAdmin, verifyBlobProof } = require("../_lib/auth");
const { findPropertyById, isValidId } = require("../_lib/sheet");
const { commitGallery, readManifestAtBranch } = require("../_lib/github");

const MIN_PHOTOS = 0; // 0 = مسح كل الصور (العقار يرجع لصورته القديمة)
const MAX_PHOTOS = 8;

// اسم فولدر آمن للـ id (حروف وأرقام و ~ و - و _ بس): نفس الـ id دايماً بيدي نفس الاسم
function dirNameFor(id) {
  return encodeURIComponent(id).replace(/[%.]/g, (c) =>
    c === "%" ? "~" : "~2E"
  );
}

module.exports = async (req, res) => {
  if (!guard(req, res, "POST")) return;
  if (!requireAdmin(req, res)) return;
  try {
    const body = await readJsonBody(req);
    const id = String((body && body.id) || "").trim();
    const photos = body && body.photos;
    if (!isValidId(id)) return send(res, 400, { error: "invalid_id" });
    if (
      !Array.isArray(photos) ||
      photos.length < MIN_PHOTOS ||
      photos.length > MAX_PHOTOS
    ) {
      return send(res, 400, {
        error: "invalid_photo_count",
        min: MIN_PHOTOS,
        max: MAX_PHOTOS,
      });
    }
    const dir = dirNameFor(id);
    const urlRe = new RegExp(
      "^/property-photos/" +
        dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        "/[A-Za-z0-9_-]+\\.(?:webp|jpg)$"
    );
    const seen = new Set();
    let existing = null;
    for (const p of photos) {
      if (p && typeof p.url === "string") {
        // صورة موجودة بالفعل في معرض العقار ده (للترتيب/الحذف/الأساسية من غير رفع تاني)
        if (!urlRe.test(p.url))
          return send(res, 400, { error: "invalid_photo_reference" });
        if (existing === null)
          existing = (await readManifestAtBranch()).galleries[id] || [];
        if (!existing.includes(p.url))
          return send(res, 400, { error: "photo_not_in_gallery" });
        if (seen.has(p.url))
          return send(res, 400, { error: "duplicate_photo" });
        seen.add(p.url);
        continue;
      }
      const okShape =
        p &&
        /^[0-9a-f]{40}$/.test(p.sha) &&
        (p.ext === "webp" || p.ext === "jpg") &&
        typeof p.proof === "string";
      if (!okShape || !verifyBlobProof(p.sha, p.ext, id, p.proof))
        return send(res, 400, { error: "invalid_photo_reference" });
      if (seen.has(p.sha)) return send(res, 400, { error: "duplicate_photo" });
      seen.add(p.sha);
    }

    const property = await findPropertyById(id);
    if (!property) return send(res, 404, { error: "property_not_found" });

    const stamp = Date.now().toString(36); // أسماء فريدة: القديم مبيتمسحش ولا بيتدوس عليه
    const files = [];
    const urls = photos.map((p, i) => {
      if (typeof p.url === "string") return p.url;
      const rel = `property-photos/${dir}/${stamp}-${i + 1}.${p.ext}`;
      files.push({ sha: p.sha, path: rel, url: "/" + rel });
      return "/" + rel;
    });
    const message = `Update photo gallery for ${id.replace(/[\r\n]/g, " ")} (${ urls.length } photos)`;
    const result = await commitGallery({ id, files, urls, message });
    return send(res, 200, {
      ok: true,
      commit: result.commitSha,
      urls,
      property,
    });
  } catch (e) {
    return sendError(res, e);
  }
};

module.exports.dirNameFor = dirNameFor;
