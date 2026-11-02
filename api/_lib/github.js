'use strict';
// عمليات GitHub (Git Data API). التوكن بيتقرا من Environment Variable بس.
// بنرفع الصور كـ blobs، وبعدين commit واحد فيه الصور + الملف المركزي (ذري).

const API = () => (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
const MANIFEST_PATH = 'photo-gallery.json';

class GhError extends Error {
  constructor(status, message) { super(message); this.status = status; this.name = 'GhError'; }
}

function cfg() {
  const token = process.env.GITHUB_TOKEN || '';
  const repo = process.env.GITHUB_REPO || '';
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[\w./-]+$/.test(branch) || branch.includes('..')) {
    const e = new Error('github_not_configured');
    e.code = 'github_not_configured';
    throw e;
  }
  return { token, repo, branch };
}

async function gh(method, path, body) {
  const { token } = cfg();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(API() + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'capital-home-photo-admin',
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
    if (!res.ok) throw new GhError(res.status, (json && json.message) || ('GitHub ' + res.status));
    return json;
  } catch (e) {
    if (e.name === 'AbortError') throw new GhError(504, 'github_timeout');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function createBlob(base64) {
  const { repo } = cfg();
  const r = await gh('POST', `/repos/${repo}/git/blobs`, { content: base64, encoding: 'base64' });
  return r.sha;
}

async function getHead() {
  const { repo, branch } = cfg();
  const ref = await gh('GET', `/repos/${repo}/git/ref/heads/${branch}`);
  const commit = await gh('GET', `/repos/${repo}/git/commits/${ref.object.sha}`);
  return { commitSha: ref.object.sha, treeSha: commit.tree.sha };
}

async function readJsonFile(path, ref) {
  const { repo } = cfg();
  try {
    const f = await gh('GET', `/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`);
    return JSON.parse(Buffer.from(f.content || '', 'base64').toString('utf8'));
  } catch (e) {
    if (e instanceof GhError && e.status === 404) return null;
    throw e;
  }
}

function normalizeManifest(m) {
  const out = { version: 1, updatedAt: null, galleries: {} };
  if (m && typeof m === 'object' && m.galleries && typeof m.galleries === 'object') {
    Object.keys(m.galleries).forEach(k => {
      if (Array.isArray(m.galleries[k])) out.galleries[k] = m.galleries[k].filter(x => typeof x === 'string');
    });
  }
  return out;
}

async function readManifestAtBranch() {
  const { branch } = cfg();
  return normalizeManifest(await readJsonFile(MANIFEST_PATH, branch));
}

// بيكتب الصور + الملف المركزي في commit واحد. لو الفرع اتحرّك وإحنا شغالين (تعارض)
// بيعيد القراءة من أول وجديد بدل ما يدوس على تغيير حد تاني.
async function commitGallery({ id, files, message }) {
  const { repo, branch } = cfg();
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const head = await getHead();
      const manifest = normalizeManifest(await readJsonFile(MANIFEST_PATH, head.commitSha));
      manifest.galleries[id] = files.map(f => f.url);
      manifest.updatedAt = new Date().toISOString();

      const entries = files.map(f => ({ path: f.path, mode: '100644', type: 'blob', sha: f.sha }));
      entries.push({ path: MANIFEST_PATH, mode: '100644', type: 'blob', content: JSON.stringify(manifest, null, 2) + '\n' });

      const tree = await gh('POST', `/repos/${repo}/git/trees`, { base_tree: head.treeSha, tree: entries });
      const commit = await gh('POST', `/repos/${repo}/git/commits`, { message, tree: tree.sha, parents: [head.commitSha] });
      await gh('PATCH', `/repos/${repo}/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
      return { commitSha: commit.sha, manifest };
    } catch (e) {
      lastErr = e;
      const conflict = e instanceof GhError && (e.status === 409 || e.status === 422);
      if (!conflict) throw e;
    }
  }
  throw lastErr;
}

module.exports = { createBlob, readManifestAtBranch, commitGallery, GhError, MANIFEST_PATH };
