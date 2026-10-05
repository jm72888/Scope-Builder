// Scope builder: local server.
// Serves the page and passes the Claude calls to lib/core.js, the same code
// the Vercel functions in api/ use, so your key never reaches the browser.
// Projects and people live in each visitor's browser, not here.
//
// MOCK=1 serves canned fixtures instead of calling the API. Useful for working
// on the page itself, and as a safety net if the network dies mid-demo.
// BUILD_LIMIT=n turns on the per-visitor daily build limit locally.
// IMPORT_LEGACY=1 offers projects saved as files by earlier versions (in
// PROJECTS_DIR) to the browser once, so they are not stranded.

const http = require('http');
const fs = require('fs');
const path = require('path');
const core = require('./lib/core');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

const STATIC = ['/index.html', '/styles.css', '/app.js', '/backdrop.js', '/examples.txt', '/developer-notes.md'];
// Self-hosted type, so the page renders correctly with no network.
const FONT_RE = /^\/fonts\/[a-z0-9-]+\.woff2$/;
// The worked example and its sample details, fetched by the page.
const EXAMPLE_RE = /^\/example\/[a-z0-9-]+\.json$/;

const IMPORT_LEGACY = process.env.IMPORT_LEGACY === '1';
const PROJECTS_DIR = process.env.PROJECTS_DIR || path.join(ROOT, 'projects');
const PEOPLE_FILE = process.env.PEOPLE_FILE || path.join(PROJECTS_DIR, '..', 'people.json');

function legacyProjects() {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  return fs.readdirSync(PROJECTS_DIR).filter((f) => f.endsWith('.json')).map((f) => {
    try { return JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, f), 'utf8')); } catch { return null; }
  }).filter((p) => p && p.id && Array.isArray(p.versions) && p.versions.length);
}

function legacyPeople() {
  try { return JSON.parse(fs.readFileSync(PEOPLE_FILE, 'utf8')).people || []; } catch { return []; }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 400000) reject(new Error('Input too long.'));
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch (err) {
        reject(new Error('Could not read the request body.'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, type, body) {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj));
}

const ROUTES = {
  '/api/questions': core.handleQuestions,
  '/api/plan': core.handlePlan,
  '/api/status': core.handleStatus,
};

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'GET') {
    const file = url === '/' ? '/index.html' : url;
    if (!STATIC.includes(file) && !FONT_RE.test(file) && !EXAMPLE_RE.test(file)) {
      return send(res, 404, 'text/plain', 'Not found');
    }
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) return send(res, 404, 'text/plain', 'Not found');
    return send(res, 200, TYPES[path.extname(file)] || 'text/plain', fs.readFileSync(full));
  }

  if (req.method !== 'POST') return send(res, 405, 'text/plain', 'Method not allowed');

  try {
    const body = await readBody(req);
    if (url === '/api/legacy') {
      if (!IMPORT_LEGACY) return send(res, 404, 'text/plain', 'Not found');
      return sendJson(res, 200, { projects: legacyProjects(), people: legacyPeople() });
    }
    const handler = ROUTES[url];
    if (!handler) return send(res, 404, 'text/plain', 'Not found');
    const out = await handler(body, req.headers);
    return sendJson(res, out.status, out.body);
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log('Scope builder running at http://localhost:' + PORT);
  for (const line of core.describeSetup()) console.log(line);
  if (IMPORT_LEGACY) console.log('Offering saved project files to the browser once: ' + PROJECTS_DIR);
});
