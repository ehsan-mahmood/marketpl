/**
 * Serves the static shop + admin UI. Data: data/context.json, products (local CSV or published Sheet URL), orders (local CSV or Google Sheet via API + service account).
 * Product images: assets/. Admin: admin-auth.json in project root.
 */
import http from 'http';
import https from 'https';
import fs from 'fs';
import { promises as fsp } from 'fs';
import crypto from 'crypto';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;

const DATA_DIR = path.join(__dirname, 'data');
const ASSETS_DIR = path.join(__dirname, 'assets');
const CONTEXT_PATH = path.join(DATA_DIR, 'context.json');
const PRODUCTS_PATH = path.join(DATA_DIR, 'products.csv');
const ORDERS_PATH = path.join(DATA_DIR, 'orders.csv');

function ensureDataDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

const AUTH_FILENAME = 'admin-auth.json';

/** Block direct HTTP GET of sensitive or append-only logs. */
const BLOCKED_STATIC_BASENAMES = new Set([AUTH_FILENAME.toLowerCase(), 'orders.csv']);
const AUTH_PATH = path.join(__dirname, AUTH_FILENAME);
const COOKIE_NAME = 'admin_session';
const SESSION_DAYS = 7;
const SESSION_MS = SESSION_DAYS * 864e5;
const PBKDF2_ITER = 120000;
const MIN_PASSWORD_LEN = 6;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function normPhone(s) {
  return String(s || '').replace(/\D/g, '');
}

function readContextPhoneDigits() {
  try {
    if (!fs.existsSync(CONTEXT_PATH)) return '';
    const j = JSON.parse(fs.readFileSync(CONTEXT_PATH, 'utf8'));
    return normPhone(j && j.whatsapp);
  } catch (_) {
    return '';
  }
}

function derivePasswordHash(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITER, 32, 'sha256').toString('hex');
}

function verifyPassword(plain, auth) {
  try {
    const h = derivePasswordHash(plain, auth.salt);
    const a = Buffer.from(h, 'hex');
    const b = Buffer.from(auth.passwordHash, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

/**
 * Render / cloud deploy: set these env vars so auth survives redeploys.
 *   ADMIN_PHONE           — vendor phone digits
 *   ADMIN_PASSWORD_HASH   — hex hash (from a previous first-run console output)
 *   ADMIN_SALT            — hex salt  (paired with ADMIN_PASSWORD_HASH)
 *   ADMIN_SESSION_SECRET  — 64-char hex string
 *   ADMIN_DEV_KEY         — dev reset key (also accepted by devKeyValid)
 *
 * If none are set, falls back to reading/creating admin-auth.json as before (local dev).
 * If env vars ARE set, admin-auth.json is ignored for reads; saveAuth() writes to the file
 * for change-password (persists until next redeploy, then env vars take over again).
 */
function loadAuthFromEnv() {
  const phone = process.env.ADMIN_PHONE;
  const hash  = process.env.ADMIN_PASSWORD_HASH;
  const salt  = process.env.ADMIN_SALT;
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (phone && hash && salt && secret) {
    return {
      phoneDigits:    String(phone).replace(/\D/g, ''),
      passwordHash:   String(hash),
      salt:           String(salt),
      sessionSecret:  String(secret),
      devResetKey:    process.env.ADMIN_DEV_KEY || ''
    };
  }
  return null;
}

function ensureAuthFile() {
  // If env vars are configured (Render / cloud), use them — no file needed.
  const fromEnv = loadAuthFromEnv();
  if (fromEnv) return fromEnv;

  if (fs.existsSync(AUTH_PATH)) {
    return JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const defaultPass = 'changeme';
  const passwordHash = derivePasswordHash(defaultPass, salt);
  const sessionSecret = crypto.randomBytes(32).toString('hex');
  const devResetKey = crypto.randomBytes(24).toString('base64url');
  const phoneDigits = readContextPhoneDigits();

  const data = {
    phoneDigits,
    passwordHash,
    salt,
    sessionSecret,
    devResetKey
  };
  fs.writeFileSync(AUTH_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log('\n── Admin auth (first run) ─────────────────────────────');
  console.log('  File:     ' + AUTH_FILENAME);
  console.log('  Login:    vendor phone (digits) + password');
  console.log('  Phone:    ' + (phoneDigits ? phoneDigits + ' (from data/context.json whatsapp)' : '(empty — use dev-reset to set)'));
  console.log('  Password: changeme   ← change after first login');
  console.log('  Dev key:  ' + devResetKey + '   (or set ADMIN_DEV_KEY env)');
  console.log('\n── For Render / cloud deploys (so auth survives redeploys) ──');
  console.log('  Set these env vars in your Render dashboard → Environment:');
  console.log('  ADMIN_PHONE          = ' + (phoneDigits || 'your-phone-digits'));
  console.log('  ADMIN_PASSWORD_HASH  = ' + passwordHash);
  console.log('  ADMIN_SALT           = ' + salt);
  console.log('  ADMIN_SESSION_SECRET = ' + sessionSecret);
  console.log('  ADMIN_DEV_KEY        = ' + devResetKey);
  console.log('──────────────────────────────────────────────────────\n');
  return data;
}

function loadAuth() {
  return ensureAuthFile();
}

function saveAuth(auth) {
  // Always write to file (for change-password during a running session).
  // On next redeploy, env vars will take over again if set.
  fs.writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 2) + '\n', 'utf8');
}

function devKeyValid(key) {
  if (!key || typeof key !== 'string') return false;
  const env = process.env.ADMIN_DEV_KEY;
  if (env && key.length === env.length && crypto.timingSafeEqual(Buffer.from(key, 'utf8'), Buffer.from(env, 'utf8'))) {
    return true;
  }
  const auth = loadAuth();
  const dk = auth.devResetKey;
  if (dk && key.length === dk.length && crypto.timingSafeEqual(Buffer.from(key, 'utf8'), Buffer.from(dk, 'utf8'))) {
    return true;
  }
  return false;
}

function parseCookies(req) {
  const h = req.headers.cookie || '';
  const out = {};
  h.split(';').forEach(function (part) {
    const i = part.indexOf('=');
    if (i === -1) return;
    const k = part.slice(0, i).trim();
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch (_) {
      out[k] = part.slice(i + 1).trim();
    }
  });
  return out;
}

function createSessionToken(phoneDigits, sessionSecret) {
  const exp = Date.now() + SESSION_MS;
  const payload = Buffer.from(JSON.stringify({ p: phoneDigits, exp }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  return payload + '.' + sig;
}

function verifySessionToken(token, sessionSecret) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expect = crypto.createHmac('sha256', sessionSecret).update(payloadB64).digest('base64url');
  if (sig.length !== expect.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expect, 'utf8'))) return null;
  try {
    const raw = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const d = JSON.parse(raw);
    if (!d || typeof d.exp !== 'number' || d.exp < Date.now()) return null;
    if (!d.p || typeof d.p !== 'string') return null;
    return d;
  } catch (_) {
    return null;
  }
}

function getSession(req) {
  const auth = loadAuth();
  const t = parseCookies(req)[COOKIE_NAME];
  if (!t) return null;
  const sess = verifySessionToken(t, auth.sessionSecret);
  if (!sess) return null;
  if (sess.p !== auth.phoneDigits) return null;
  return sess;
}

function setSessionCookie(res, phoneDigits) {
  const auth = loadAuth();
  const token = createSessionToken(phoneDigits, auth.sessionSecret);
  const maxAge = SESSION_DAYS * 86400;
  const cookie =
    COOKIE_NAME +
    '=' +
    encodeURIComponent(token) +
    '; HttpOnly; Path=/; Max-Age=' +
    maxAge +
    '; SameSite=Lax';
  res.setHeader('Set-Cookie', cookie);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', COOKIE_NAME + '=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
}

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function phoneHint(digits) {
  if (!digits || digits.length < 4) return '';
  return '…' + digits.slice(-4);
}

function safeFilePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  let p = decoded.replace(/^\/+/, '');
  if (!p || p.endsWith('/')) p = p + 'index.html';
  const base = path.basename(p).toLowerCase();
  if (BLOCKED_STATIC_BASENAMES.has(base)) return null;
  const abs = path.normalize(path.join(__dirname, p));
  const root = path.normalize(__dirname + path.sep);
  if (!abs.startsWith(root)) return null;
  return abs;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Windows often returns EBUSY when another process holds the file (Excel, editor, indexer).
 * Write a temp file then rename over the target, with retries and short backoff.
 */
async function writeFileResilient(filePath, data) {
  const enc = 'utf8';
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const maxAttempts = 15;
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const tmp = path.join(dir, `.${base}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    try {
      await fsp.writeFile(tmp, data, enc);
    } catch (e) {
      lastErr = e;
      await delay(25 + attempt * 30);
      continue;
    }
    try {
      await fsp.rename(tmp, filePath);
      return;
    } catch (e) {
      await fsp.unlink(tmp).catch(() => {});
      lastErr = e;
      if (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES') {
        await delay(25 + attempt * 30);
        continue;
      }
      throw e;
    }
  }
  const hint =
    lastErr && (lastErr.code === 'EBUSY' || lastErr.code === 'EPERM')
      ? ' File may be open in Excel, another editor, or locked by sync software — close it and retry.'
      : '';
  const err = new Error((lastErr && lastErr.message ? lastErr.message : 'Write failed') + hint);
  if (lastErr && lastErr.code) err.code = lastErr.code;
  throw err;
}

function requireAdmin(req, res) {
  const sess = getSession(req);
  if (!sess) {
    json(res, 401, { ok: false, error: 'Unauthorized' });
    return null;
  }
  return sess;
}

function readContextJson() {
  try {
    if (!fs.existsSync(CONTEXT_PATH)) return {};
    return JSON.parse(fs.readFileSync(CONTEXT_PATH, 'utf8'));
  } catch (_) {
    return {};
  }
}

/** @returns {'csv' | 'google_sheets'} */
function productsSourceMode(ctx) {
  return ctx && ctx.products_source === 'google_sheets' ? 'google_sheets' : 'csv';
}

/** Limit remote fetches to Google Sheet/Drive CSV export hosts (SSRF mitigation). */
function isAllowedGoogleSheetCsvUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return h === 'docs.google.com' || h === 'drive.google.com';
  } catch (_) {
    return false;
  }
}

/**
 * Fetch published CSV from Google (redirects, e.g. to googleusercontent.com, are followed).
 * Uses https only — matches isAllowedGoogleSheetCsvUrl entry URLs.
 */
function fetchHttpsCsvText(urlStr, maxRedirects) {
  const max = maxRedirects != null ? maxRedirects : 8;
  return new Promise(function (resolve, reject) {
    function one(url, left) {
      let u;
      try {
        u = new URL(url);
      } catch (e) {
        reject(e);
        return;
      }
      if (u.protocol !== 'https:') {
        reject(new Error('Only https URLs are allowed'));
        return;
      }
      const req = https.request(
        u,
        {
          method: 'GET',
          timeout: 45000,
          headers: { 'User-Agent': 'marketpl-server/1' }
        },
        function (res) {
          const code = res.statusCode || 0;
          if (code >= 300 && code < 400 && res.headers.location && left > 0) {
            const next = new URL(res.headers.location, url).href;
            res.resume();
            return one(next, left - 1);
          }
          if (code !== 200) {
            reject(new Error('HTTP ' + code));
            res.resume();
            return;
          }
          const chunks = [];
          res.on('data', function (c) {
            chunks.push(c);
          });
          res.on('end', function () {
            resolve(Buffer.concat(chunks).toString('utf8'));
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', function () {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.end();
    }
    one(urlStr, max);
  });
}

async function getProductsCsvForContext(ctx) {
  const mode = productsSourceMode(ctx);
  if (mode === 'google_sheets') {
    const url = String(ctx.csv_url || '').trim();
    if (!isAllowedGoogleSheetCsvUrl(url)) {
      const err = new Error(
        'Set csv_url to a Google Sheet CSV export URL (https://docs.google.com/.../export?format=csv&gid=…).'
      );
      err.code = 'BAD_URL';
      throw err;
    }
    return await fetchHttpsCsvText(url);
  }
  if (!fs.existsSync(PRODUCTS_PATH)) return '';
  return fs.readFileSync(PRODUCTS_PATH, 'utf8');
}

function csvEscapeCell(val) {
  const s = val == null ? '' : String(val);
  if (/[\r\n",]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function clampInput(s, max) {
  return String(s == null ? '' : s)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .slice(0, max);
}

/** RFC4180-style single-line CSV field parser (no embedded newlines). */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let i = 0;
  let inQuotes = false;
  while (i < line.length) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cur += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      out.push(cur);
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  out.push(cur);
  return out;
}

const ORDERS_CSV_HEADER =
  'order_id,placed_at,customer_name,customer_phone,address,city,area,note,payment_method,order_subtotal,product_id,product_name,qty,unit_price,line_total,status';
const ORDER_COLUMNS = ORDERS_CSV_HEADER.split(',');

/** Map Sheet headers (truncated / aliases) to canonical column names. */
function canonicalOrderSheetHeader(h) {
  const t = String(h || '').trim();
  if (!t) return '';
  const aliases = {
    customer_nam: 'customer_name',
    customer_phon: 'customer_phone',
    payment_meth: 'payment_method'
  };
  const norm = t.replace(/\s+/g, '_').toLowerCase();
  if (aliases[norm]) return aliases[norm];
  if (ORDER_COLUMNS.indexOf(t) !== -1) return t;
  const byLower = ORDER_COLUMNS.find(function (c) {
    return c.toLowerCase() === norm;
  });
  return byLower || t;
}

/** @returns {'csv' | 'google_sheets' | 'google_apps_script'} */
function ordersSourceMode(ctx) {
  if (ctx && ctx.orders_source === 'google_sheets') return 'google_sheets';
  if (ctx && ctx.orders_source === 'google_apps_script') return 'google_apps_script';
  return 'csv';
}

function getOrdersWebhookUrl(ctx) {
  return ctx && ctx.orders_webhook_url != null ? String(ctx.orders_webhook_url).trim() : '';
}

/**
 * True only for a deployed Apps Script web app URL (POST hits doPost).
 * Do not use a spreadsheet “edit” or docs URL — those return HTML / 405 on POST.
 */
function isAppsScriptExecUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    const path = u.pathname || '';
    if (h === 'script.google.com') {
      return /^\/macros\/s\/[^/]+\/exec\/?$/i.test(path.replace(/\/+$/, '') || '/');
    }
    if (h === 'script.googleusercontent.com') {
      return /\/macros\//i.test(path);
    }
    return false;
  } catch (_) {
    return false;
  }
}

function isAllowedAppsScriptWebhookUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.protocol === 'https:' && u.hostname.toLowerCase() === 'script.google.com' && isAppsScriptExecUrl(urlStr);
  } catch (_) {
    return false;
  }
}

function parseAppsScriptWebhookResponse(text) {
  const t = String(text || '').trim();
  if (!t) throw new Error('Empty webhook response');
  let j;
  try {
    j = JSON.parse(t);
  } catch (_) {
    throw new Error('Webhook returned non-JSON: ' + t.slice(0, 200));
  }
  if (!j.ok) throw new Error(j.error || 'Webhook error');
  return j;
}

async function postOrdersWebhook(payload) {
  const ctx = readContextJson();
  const url = getOrdersWebhookUrl(ctx);
  if (!isAllowedAppsScriptWebhookUrl(url)) {
    throw new Error(
      'orders_webhook_url must be set to https://script.google.com/macros/s/.../exec in data/context.json'
    );
  }
  const text = await postJsonHttps(url, payload);
  return parseAppsScriptWebhookResponse(text);
}

/** Admin can change order status when CSV, Sheets API, or Apps Script webhook (same URL as checkout). */
function ordersAdminCanMutate(ctx) {
  const src = ordersSourceMode(ctx);
  if (src === 'google_apps_script') {
    return isAllowedAppsScriptWebhookUrl(getOrdersWebhookUrl(ctx));
  }
  return true;
}

/**
 * Only follow redirects to Apps Script web app URLs. Broad *.google.com was wrong: a 302 to
 * docs.google.com / www.google.com yields HTML and HTTP 405 on POST.
 */
function isAllowedAppsScriptRedirectUrl(urlStr) {
  return isAppsScriptExecUrl(urlStr);
}

/**
 * POST JSON to an HTTPS URL. Follows 301/302/303/307/308 to the same POST body (Apps Script pattern).
 * @param {number} [redirectsLeft]
 */
function postJsonHttps(urlStr, payload, redirectsLeft) {
  const maxRedirects = redirectsLeft != null ? redirectsLeft : 8;
  return new Promise(function (resolve, reject) {
    if (maxRedirects < 0) {
      reject(new Error('Webhook: too many redirects'));
      return;
    }
    let u;
    try {
      u = new URL(urlStr);
    } catch (e) {
      reject(e);
      return;
    }
    if (u.protocol !== 'https:') {
      reject(new Error('Webhook URL must use HTTPS'));
      return;
    }
    const body = JSON.stringify(payload);
    const req = https.request(
      u,
      {
        method: 'POST',
        timeout: 45000,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'marketpl-server/1'
        }
      },
      function (res) {
        const chunks = [];
        res.on('data', function (c) {
          chunks.push(c);
        });
        res.on('end', function () {
          const text = Buffer.concat(chunks).toString('utf8');
          const code = res.statusCode || 0;
          const loc = res.headers.location;
          if (code >= 300 && code < 400 && loc) {
            let nextUrl;
            try {
              nextUrl = new URL(loc, u).href;
            } catch (e) {
              reject(new Error('Webhook redirect Location invalid'));
              return;
            }
            if (!isAllowedAppsScriptRedirectUrl(nextUrl)) {
              reject(
                new Error(
                  'Webhook redirect is not an Apps Script web app URL (only follow /macros/.../exec). Got: ' +
                    String(nextUrl).slice(0, 200)
                )
              );
              return;
            }
            postJsonHttps(nextUrl, payload, maxRedirects - 1).then(resolve).catch(reject);
            return;
          }
          if (code < 200 || code >= 300) {
            reject(new Error('Webhook HTTP ' + code + (text ? ': ' + text.slice(0, 300) : '')));
            return;
          }
          resolve(text);
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', function () {
      req.destroy();
      reject(new Error('Webhook request timeout'));
    });
    req.write(body);
    req.end();
  });
}

/**
 * Parse a Google Sheets edit, sharing, or export URL for spreadsheet id and optional gid.
 */
function parseGoogleSpreadsheetUrl(urlStr) {
  const s = String(urlStr || '').trim();
  if (!s) return null;
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) return null;
  const spreadsheetId = m[1];
  let gid;
  const g = s.match(/[#&?]gid=(\d+)/);
  if (g) gid = parseInt(g[1], 10);
  return { spreadsheetId, gid };
}

/**
 * Resolve spreadsheet + tab for Google orders. Prefer orders_sheet_url (like csv_url for products);
 * fall back to orders_sheet.spreadsheet_id for older configs.
 */
async function resolveOrdersSheetConfig(ctx) {
  const o = ctx && ctx.orders_sheet ? ctx.orders_sheet : {};
  const urlRaw = ctx && ctx.orders_sheet_url != null ? String(ctx.orders_sheet_url).trim() : '';
  const parsed = urlRaw ? parseGoogleSpreadsheetUrl(urlRaw) : null;
  let spreadsheetId = '';
  if (parsed && parsed.spreadsheetId) spreadsheetId = parsed.spreadsheetId;
  if (!spreadsheetId && o.spreadsheet_id != null) {
    spreadsheetId = String(o.spreadsheet_id).trim();
  }
  if (!spreadsheetId) return null;
  let sheetName =
    o.sheet_name != null && String(o.sheet_name).trim()
      ? String(o.sheet_name).trim()
      : 'Sheet1';
  if (parsed && parsed.gid != null && Number.isFinite(parsed.gid)) {
    try {
      const sheets = getSheetsClient();
      const meta = await sheets.spreadsheets.get({ spreadsheetId });
      const match = (meta.data.sheets || []).find(function (s) {
        return s.properties && s.properties.sheetId === parsed.gid;
      });
      if (match && match.properties && match.properties.title) {
        sheetName = match.properties.title;
      }
    } catch (_) {
      /* keep sheetName fallback */
    }
  }
  return { spreadsheetId, sheetName };
}

function googleCredentialsPath() {
  const fromEnv = process.env.MARKETPL_GOOGLE_CREDENTIALS;
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim();
  return path.join(__dirname, 'google-service-account.json');
}

function quoteSheetNameForRange(name) {
  const n = String(name || 'Sheet1');
  if (/^[A-Za-z0-9_]+$/.test(n)) return n;
  return "'" + n.replace(/'/g, "''") + "'";
}

let sheetsApiSingleton = null;
function getSheetsClient() {
  if (!sheetsApiSingleton) {
    const credPath = googleCredentialsPath();
    if (!fs.existsSync(credPath)) {
      throw new Error(
        'Google Sheets orders: missing credentials. Add google-service-account.json (service account JSON) in the project root, or set MARKETPL_GOOGLE_CREDENTIALS to the file path. Share the orders spreadsheet with the service account client_email as Editor.'
      );
    }
    const auth = new google.auth.GoogleAuth({
      keyFile: credPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    sheetsApiSingleton = google.sheets({ version: 'v4', auth });
  }
  return sheetsApiSingleton;
}

async function readOrderRowsFromSheets(cfg) {
  const sheets = getSheetsClient();
  const range = `${quoteSheetNameForRange(cfg.sheetName)}!A:Q`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: cfg.spreadsheetId,
    range
  });
  const values = res.data.values;
  if (!values || values.length < 2) return [];
  const header = (values[0] || []).map(function (h) {
    return String(h || '').trim();
  });
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const fields = values[i] || [];
    const obj = {};
    header.forEach(function (h, idx) {
      if (!h) return;
      const key = canonicalOrderSheetHeader(h);
      if (!key || ORDER_COLUMNS.indexOf(key) === -1) return;
      obj[key] = fields[idx] != null ? String(fields[idx]) : '';
    });
    ORDER_COLUMNS.forEach(function (col) {
      if (obj[col] === undefined) obj[col] = '';
    });
    if (!obj.status || !String(obj.status).trim()) obj.status = 'placed';
    rows.push(obj);
  }
  return rows;
}

function buildOrdersPublicCsvUrl(ctx) {
  const raw = ctx && ctx.orders_sheet_url != null ? String(ctx.orders_sheet_url).trim() : '';
  if (!raw) return '';
  if (!isAllowedGoogleSheetCsvUrl(raw)) return '';
  if (/[?&]format=csv(?:&|$)/i.test(raw)) return raw;
  const parsed = parseGoogleSpreadsheetUrl(raw);
  if (!parsed || !parsed.spreadsheetId) return '';
  let out = `https://docs.google.com/spreadsheets/d/${parsed.spreadsheetId}/export?format=csv`;
  if (parsed.gid != null && Number.isFinite(parsed.gid)) out += `&gid=${parsed.gid}`;
  return out;
}

async function readOrderRowsFromPublicCsv(url) {
  const text = await fetchHttpsCsvText(url);
  const lines = String(text || '')
    .split(/\r?\n/)
    .filter(function (l) {
      return l.length > 0;
    });
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map(canonicalOrderSheetHeader);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    let fields = parseCsvLine(lines[i]);
    while (fields.length < header.length) fields.push('');
    if (fields.length > header.length) fields = fields.slice(0, header.length);
    const obj = {};
    header.forEach(function (h, idx) {
      if (!h || ORDER_COLUMNS.indexOf(h) === -1) return;
      obj[h] = fields[idx] != null ? String(fields[idx]) : '';
    });
    ORDER_COLUMNS.forEach(function (col) {
      if (obj[col] === undefined) obj[col] = '';
    });
    if (!obj.status || !String(obj.status).trim()) obj.status = 'placed';
    rows.push(obj);
  }
  return rows;
}

async function writeOrderRowsToSheets(cfg, rows) {
  const sheets = getSheetsClient();
  const q = quoteSheetNameForRange(cfg.sheetName);
  const clearRange = `${q}!A1:Z50000`;
  const matrix = [
    ORDER_COLUMNS.slice(),
    ...rows.map(function (r) {
      return ORDER_COLUMNS.map(function (col) {
        return r[col] != null ? String(r[col]) : '';
      });
    })
  ];
  await sheets.spreadsheets.values.clear({
    spreadsheetId: cfg.spreadsheetId,
    range: clearRange
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: cfg.spreadsheetId,
    range: `${q}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: matrix }
  });
}

async function appendOrderRowsToSheets(cfg, csvLines) {
  const sheets = getSheetsClient();
  const q = quoteSheetNameForRange(cfg.sheetName);
  const headRes = await sheets.spreadsheets.values.get({
    spreadsheetId: cfg.spreadsheetId,
    range: `${q}!A1:A1`
  });
  const values = [];
  const hasAny =
    headRes.data.values &&
    headRes.data.values.length &&
    String(headRes.data.values[0][0] || '').trim() !== '';
  if (!hasAny) {
    values.push(ORDER_COLUMNS.slice());
  } else {
    const head0 = String(headRes.data.values[0][0] || '').trim().toLowerCase();
    if (head0 !== 'order_id') {
      throw new Error(
        'Orders sheet cell A1 must be the header order_id, or leave the sheet empty so the server can add headers.'
      );
    }
  }
  for (let i = 0; i < csvLines.length; i++) {
    const fields = parseCsvLine(csvLines[i]);
    const pad = fields.slice();
    while (pad.length < ORDER_COLUMNS.length) pad.push('');
    values.push(pad.slice(0, ORDER_COLUMNS.length));
  }
  await sheets.spreadsheets.values.append({
    spreadsheetId: cfg.spreadsheetId,
    range: `${q}!A:Q`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values }
  });
}

/** If orders.csv predates the `status` column, rewrite once with `placed` on each row. */
function ensureOrdersFileSchemaSync() {
  ensureDataDirs();
  if (!fs.existsSync(ORDERS_PATH) || fs.statSync(ORDERS_PATH).size === 0) return;
  const text = fs.readFileSync(ORDERS_PATH, 'utf8');
  const lines = text.split(/\r?\n/).filter(function (l) {
    return l.length > 0;
  });
  if (!lines.length) return;
  const header = parseCsvLine(lines[0]);
  if (header.indexOf('status') !== -1) return;
  const newHeader = header.concat(['status']);
  const outLines = [newHeader.map(csvEscapeCell).join(',')];
  for (let i = 1; i < lines.length; i++) {
    let fields = parseCsvLine(lines[i]);
    if (fields.length > header.length) fields = fields.slice(0, header.length);
    while (fields.length < header.length) fields.push('');
    fields = fields.concat(['placed']);
    outLines.push(
      newHeader
        .map(function (_, idx) {
          return csvEscapeCell(fields[idx] != null ? String(fields[idx]) : '');
        })
        .join(',')
    );
  }
  fs.writeFileSync(ORDERS_PATH, outLines.join('\n') + '\n', 'utf8');
}

function syncReadAllOrderRowsFromFile() {
  ensureDataDirs();
  ensureOrdersFileSchemaSync();
  if (!fs.existsSync(ORDERS_PATH) || fs.statSync(ORDERS_PATH).size === 0) return [];
  const text = fs.readFileSync(ORDERS_PATH, 'utf8');
  const lines = text.split(/\r?\n/).filter(function (l) {
    return l.length > 0;
  });
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    let fields = parseCsvLine(lines[i]);
    while (fields.length < header.length) fields.push('');
    if (fields.length > header.length) fields = fields.slice(0, header.length);
    const obj = {};
    header.forEach(function (h, idx) {
      obj[h] = fields[idx] != null ? String(fields[idx]) : '';
    });
    if (!obj.status || !String(obj.status).trim()) obj.status = 'placed';
    rows.push(obj);
  }
  return rows;
}

async function readAllOrderRowsAsync() {
  const ctx = readContextJson();
  const mode = ordersSourceMode(ctx);
  if (mode === 'google_apps_script') {
    const csvUrl = buildOrdersPublicCsvUrl(ctx);
    if (!csvUrl) {
      throw new Error(
        'orders_source is google_apps_script but orders_sheet_url is missing/invalid. Use a Google Sheets edit/share/export URL.'
      );
    }
    return await readOrderRowsFromPublicCsv(csvUrl);
  }
  if (mode === 'google_sheets') {
    const cfg = await resolveOrdersSheetConfig(ctx);
    if (!cfg) {
      throw new Error(
        'orders_source is google_sheets but orders_sheet_url (or orders_sheet.spreadsheet_id) is missing in data/context.json'
      );
    }
    return await readOrderRowsFromSheets(cfg);
  }
  return syncReadAllOrderRowsFromFile();
}

async function writeAllOrderRows(rows) {
  const ctx = readContextJson();
  const mode = ordersSourceMode(ctx);
  if (mode === 'google_sheets') {
    const cfg = await resolveOrdersSheetConfig(ctx);
    if (!cfg) throw new Error('orders_sheet config missing');
    await writeOrderRowsToSheets(cfg, rows);
    return;
  }
  if (mode === 'google_apps_script') {
    throw new Error(
      'Full sheet rewrite is not used in google_apps_script mode; use advance/delete via webhook instead.'
    );
  }
  ensureDataDirs();
  const header = ORDER_COLUMNS;
  const lines = [header.map(csvEscapeCell).join(',')];
  for (let j = 0; j < rows.length; j++) {
    const r = rows[j];
    lines.push(
      header
        .map(function (col) {
          return csvEscapeCell(r[col] != null ? String(r[col]) : '');
        })
        .join(',')
    );
  }
  await writeFileResilient(ORDERS_PATH, lines.join('\n') + '\n');
}

function normalizeOrderStatus(s) {
  const x = String(s || '')
    .toLowerCase()
    .trim();
  if (x === 'placed' || x === 'confirmed' || x === 'despatched' || x === 'delivered') return x;
  return 'placed';
}

/** Next status in the chain; `delivered` means remove all rows for that order_id from the file. */
function computeNextOrderStatus(current) {
  const x = normalizeOrderStatus(current);
  if (x === 'placed') return 'confirmed';
  if (x === 'confirmed') return 'despatched';
  if (x === 'despatched') return 'delivered';
  return null;
}

/** True for ids we generate (timestamp-slug, UUID, srv-*, etc.), false for Excel-broken blobs. */
function plausibleOrderId(s) {
  const t = String(s || '').trim();
  if (!t || t.length > 96) return false;
  if (/[\r\n"]/.test(t)) return false;
  if (t.indexOf(',') !== -1) return false;
  if (/^\d{10,}-[a-z0-9]+$/i.test(t)) return true;
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(t)
  ) {
    return true;
  }
  if (/^srv-\d+-[a-f0-9]+$/i.test(t)) return true;
  return /^[a-z0-9._-]+$/i.test(t) && t.length >= 6;
}

/**
 * Some CSV exports put a whole line item into the first column (commas inside one cell).
 * If product columns are empty, try to recover pid/name/qty/prices from that blob.
 */
function tryRecoverGarbledOrderRow(r) {
  const blob = String(r.order_id || '').trim();
  if (plausibleOrderId(blob) || blob.indexOf(',') === -1) return null;
  const hasLine =
    String(r.product_id || '').trim() ||
    String(r.product_name || '').trim();
  if (hasLine) return null;
  const parts = blob.split(',');
  if (parts.length < 8) return null;
  const lt = parseFloat(parts[parts.length - 1]);
  const up = parseFloat(parts[parts.length - 2]);
  const qty = parseInt(parts[parts.length - 3], 10);
  if (!Number.isFinite(qty) || qty < 1 || !Number.isFinite(up) || !Number.isFinite(lt)) return null;
  const pname = (parts[parts.length - 4] || '').trim();
  const pid = (parts[parts.length - 5] || '').trim();
  return Object.assign({}, r, {
    order_id: '',
    product_id: pid,
    product_name: pname,
    qty: String(qty),
    unit_price: String(up),
    line_total: String(lt)
  });
}

/**
 * For each raw CSV row, the effective checkout id (handles broken exports where the next line
 * is a continuation of the previous order).
 */
function effectiveOrderIds(rows) {
  const ids = new Array(rows.length);
  let lastPlausible = null;
  for (let i = 0; i < rows.length; i++) {
    let r = rows[i];
    const rec = tryRecoverGarbledOrderRow(r);
    if (rec) r = rec;
    const id = String(r.order_id || '').trim();
    const hasLine =
      !!(String(r.product_id || '').trim() || String(r.product_name || '').trim());
    if (plausibleOrderId(id)) {
      lastPlausible = id;
      ids[i] = id;
    } else if (lastPlausible && hasLine) {
      ids[i] = lastPlausible;
    } else {
      ids[i] = null;
    }
  }
  return ids;
}

/**
 * Walk rows in file order: attach continuation lines with bad/missing order_id to the previous
 * plausible checkout so the admin shows one block per order (matches how we write CSV).
 */
function normalizeOrdersCsvRows(rows) {
  const eff = effectiveOrderIds(rows);
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    if (eff[i] == null) continue;
    let r = rows[i];
    const rec = tryRecoverGarbledOrderRow(r);
    if (rec) r = rec;
    const id = String(r.order_id || '').trim();
    const hasLine =
      !!(String(r.product_id || '').trim() || String(r.product_name || '').trim());
    if (plausibleOrderId(id)) {
      out.push(r);
    } else if (hasLine) {
      out.push(Object.assign({}, r, { order_id: eff[i] }));
    }
  }
  return out;
}

function aggregateOrdersForApi(rows) {
  rows = normalizeOrdersCsvRows(rows);
  const by = new Map();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const id = String(r.order_id || '').trim();
    if (!id) continue;
    if (!by.has(id)) {
      by.set(id, {
        orderId: id,
        placedAt: r.placed_at || '',
        customerName: r.customer_name || '',
        customerPhone: r.customer_phone || '',
        address: r.address || '',
        city: r.city || '',
        area: r.area || '',
        note: r.note || '',
        payment: r.payment_method || '',
        subtotal: r.order_subtotal || '',
        status: normalizeOrderStatus(r.status),
        lines: []
      });
    }
    const pid = String(r.product_id || '').trim();
    const pname = String(r.product_name || '').trim();
    const qty = String(r.qty || '').trim();
    if (!pid && !pname && !qty) {
      continue;
    }
    by.get(id).lines.push({
      productId: r.product_id || '',
      productName: r.product_name || '',
      qty: r.qty || '',
      unitPrice: r.unit_price || '',
      lineTotal: r.line_total || ''
    });
  }
  return Array.from(by.values()).sort(function (a, b) {
    return String(b.placedAt).localeCompare(String(a.placedAt));
  });
}

async function advanceOrderById(orderIdRaw) {
  const orderId = String(orderIdRaw || '').trim();
  if (!orderId) throw new Error('orderId required');
  const rows = await readAllOrderRowsAsync();
  const eff = effectiveOrderIds(rows);
  if (eff.indexOf(orderId) === -1) throw new Error('Order not found');
  const anchor = rows.find(function (r, i) {
    return eff[i] === orderId && plausibleOrderId(String(r.order_id || '').trim());
  });
  const statSource = anchor || rows.find(function (r, i) {
    return eff[i] === orderId;
  });
  const next = computeNextOrderStatus(statSource.status);
  if (next === null) throw new Error('No next status for this order');
  const ctx = readContextJson();
  if (ordersSourceMode(ctx) === 'google_apps_script') {
    await postOrdersWebhook({ action: 'advance', orderId: orderId, newStatus: next });
    return { newStatus: next };
  }
  let out;
  if (next === 'delivered') {
    out = rows.filter(function (r, i) {
      return eff[i] !== orderId;
    });
  } else {
    out = rows.map(function (r, i) {
      if (eff[i] !== orderId) return r;
      return Object.assign({}, r, { status: next });
    });
  }
  await writeAllOrderRows(out);
  return { newStatus: next };
}

async function deleteOrderById(orderIdRaw) {
  const orderId = String(orderIdRaw || '').trim();
  if (!orderId) throw new Error('orderId required');
  const rows = await readAllOrderRowsAsync();
  const eff = effectiveOrderIds(rows);
  const before = rows.length;
  const out = rows.filter(function (r, i) {
    return eff[i] !== orderId;
  });
  if (out.length === before) throw new Error('Order not found');
  const ctx = readContextJson();
  if (ordersSourceMode(ctx) === 'google_apps_script') {
    await postOrdersWebhook({ action: 'delete', orderId: orderId });
    return;
  }
  await writeAllOrderRows(out);
}

async function appendOrderLedger(csvLines) {
  const ctx = readContextJson();
  const mode = ordersSourceMode(ctx);
  if (mode === 'google_sheets') {
    const cfg = await resolveOrdersSheetConfig(ctx);
    if (!cfg) throw new Error('orders_sheet config missing');
    await appendOrderRowsToSheets(cfg, csvLines);
    return;
  }
  if (mode === 'google_apps_script') {
    return;
  }
  ensureDataDirs();
  ensureOrdersFileSchemaSync();
  const needHeader = !fs.existsSync(ORDERS_PATH) || fs.statSync(ORDERS_PATH).size === 0;
  let chunk = '';
  if (needHeader) chunk += ORDERS_CSV_HEADER + '\n';
  chunk += csvLines.join('\n') + '\n';
  fs.appendFileSync(ORDERS_PATH, chunk, 'utf8');
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const u = new URL(req.url || '/', 'http://127.0.0.1');
  const pathname = u.pathname;

  /* ── Admin API ── */
  if (req.method === 'GET' && pathname === '/api/admin/status') {
    const auth = loadAuth();
    const sess = getSession(req);
    const loggedIn = !!sess;
    return json(res, 200, {
      ok: true,
      loggedIn,
      phoneConfigured: !!(auth.phoneDigits && auth.phoneDigits.length),
      phoneHint: loggedIn ? phoneHint(auth.phoneDigits) : ''
    });
  }

  if (req.method === 'POST' && pathname === '/api/admin/login') {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      const phone = normPhone(body.phone);
      const password = typeof body.password === 'string' ? body.password : '';
      const auth = loadAuth();
      if (!auth.phoneDigits || !auth.phoneDigits.length) {
        return json(res, 403, {
          ok: false,
          error: 'Vendor phone is not set. Use the developer reset (dev key) to set phone and password.'
        });
      }
      if (!phone || phone !== auth.phoneDigits) {
        return json(res, 401, { ok: false, error: 'Invalid phone or password' });
      }
      if (!verifyPassword(password, auth)) {
        return json(res, 401, { ok: false, error: 'Invalid phone or password' });
      }
      setSessionCookie(res, auth.phoneDigits);
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 400, { ok: false, error: String(e && e.message ? e.message : e) });
    }
  }

  if (req.method === 'POST' && pathname === '/api/admin/logout') {
    clearSessionCookie(res);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathname === '/api/admin/change-password') {
    try {
      if (!requireAdmin(req, res)) return;
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      const oldPassword = typeof body.oldPassword === 'string' ? body.oldPassword : '';
      const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
      if (newPassword.length < MIN_PASSWORD_LEN) {
        return json(res, 400, { ok: false, error: 'New password must be at least ' + MIN_PASSWORD_LEN + ' characters' });
      }
      const auth = loadAuth();
      if (!verifyPassword(oldPassword, auth)) {
        return json(res, 401, { ok: false, error: 'Current password is wrong' });
      }
      auth.salt = crypto.randomBytes(16).toString('hex');
      auth.passwordHash = derivePasswordHash(newPassword, auth.salt);
      auth.sessionSecret = crypto.randomBytes(32).toString('hex');
      saveAuth(auth);
      setSessionCookie(res, auth.phoneDigits);
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 400, { ok: false, error: String(e && e.message ? e.message : e) });
    }
  }

  if (req.method === 'POST' && pathname === '/api/admin/dev-reset') {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      const devKey = typeof body.devKey === 'string' ? body.devKey : '';
      if (!devKeyValid(devKey)) {
        return json(res, 401, { ok: false, error: 'Invalid developer key' });
      }
      const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
      if (newPassword.length < MIN_PASSWORD_LEN) {
        return json(res, 400, {
          ok: false,
          error: 'newPassword must be at least ' + MIN_PASSWORD_LEN + ' characters'
        });
      }
      const auth = loadAuth();
      var newPhone = auth.phoneDigits;
      if (body.newPhone != null && String(body.newPhone).trim() !== '') {
        newPhone = normPhone(body.newPhone);
      }
      if (!newPhone || !newPhone.length) {
        return json(res, 400, {
          ok: false,
          error: 'No vendor phone on file. Pass newPhone (digits only) in the JSON body.'
        });
      }
      auth.phoneDigits = newPhone;
      auth.salt = crypto.randomBytes(16).toString('hex');
      auth.passwordHash = derivePasswordHash(newPassword, auth.salt);
      auth.sessionSecret = crypto.randomBytes(32).toString('hex');
      saveAuth(auth);
      clearSessionCookie(res);
      return json(res, 200, { ok: true, message: 'Password (and phone if sent) updated. Log in again.' });
    } catch (e) {
      return json(res, 400, { ok: false, error: String(e && e.message ? e.message : e) });
    }
  }

  /* ── Order log (shop checkout — no auth; file not served as static GET) ── */
  if (req.method === 'POST' && pathname === '/api/log-order') {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      const lines = body.lines;
      if (!Array.isArray(lines) || lines.length === 0) {
        return json(res, 400, { ok: false, error: 'lines array required' });
      }
      const orderId =
        clampInput(body.orderId, 80) ||
        'srv-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
      const placedAt = clampInput(body.placedAt || new Date().toISOString(), 48);
      const cname = clampInput(body.customerName, 200);
      const cphone = clampInput(body.customerPhone, 50);
      const addr = clampInput(body.address, 800);
      const city = clampInput(body.city, 120);
      const area = clampInput(body.area, 200);
      const note = clampInput(body.note, 500);
      const payment = clampInput(body.payment, 40);
      const subNum = Number(body.orderSubtotal);
      const subStr = Number.isFinite(subNum) ? String(subNum) : '';

      const csvRows = [];
      const cleanLines = [];
      for (let i = 0; i < lines.length; i++) {
        const L = lines[i] || {};
        const pid = clampInput(L.productId != null ? L.productId : L.product_id, 24);
        const pname = clampInput(L.productName != null ? L.productName : L.product_name, 400);
        let qty = Number(L.qty);
        if (!Number.isFinite(qty) || qty < 1) qty = 1;
        let up = Number(L.unitPrice != null ? L.unitPrice : L.unit_price);
        let lt = Number(L.lineTotal != null ? L.lineTotal : L.line_total);
        if (!Number.isFinite(up)) up = 0;
        if (!Number.isFinite(lt)) lt = up * qty;
        const row = [
          orderId,
          placedAt,
          cname,
          cphone,
          addr,
          city,
          area,
          note,
          payment,
          subStr,
          pid,
          pname,
          String(Math.floor(qty)),
          String(up),
          String(lt),
          'placed'
        ];
        csvRows.push(row.map(csvEscapeCell).join(','));
        cleanLines.push({
          productId: pid,
          productName: pname,
          qty: String(Math.floor(qty)),
          unitPrice: String(up),
          lineTotal: String(lt)
        });
      }
      const ctx = readContextJson();
      if (ordersSourceMode(ctx) === 'google_apps_script') {
        await postOrdersWebhook({
          orderId: orderId,
          placedAt: placedAt,
          customerName: cname,
          customerPhone: cphone,
          address: addr,
          city: city,
          area: area,
          note: note,
          payment: payment,
          orderSubtotal: subStr,
          lines: cleanLines
        });
      }
      await appendOrderLedger(csvRows);
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 400, { ok: false, error: String(e && e.message ? e.message : e) });
    }
  }

  /* ── Orders (admin — grouped by order_id; status on each line-item row) ── */
  if (req.method === 'GET' && pathname === '/api/admin/orders') {
    if (!requireAdmin(req, res)) return;
    try {
      const ctx = readContextJson();
      const source = ordersSourceMode(ctx);
      const rows = await readAllOrderRowsAsync();
      const orders = aggregateOrdersForApi(rows);
      return json(res, 200, {
        ok: true,
        orders,
        source,
        canMutate: ordersAdminCanMutate(ctx)
      });
    } catch (e) {
      return json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) });
    }
  }

  if (req.method === 'POST' && pathname === '/api/admin/orders/advance') {
    if (!requireAdmin(req, res)) return;
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      const orderId = clampInput(body.orderId, 80);
      const result = await advanceOrderById(orderId);
      return json(res, 200, { ok: true, newStatus: result.newStatus });
    } catch (e) {
      return json(res, 400, { ok: false, error: String(e && e.message ? e.message : e) });
    }
  }

  if (req.method === 'POST' && pathname === '/api/admin/orders/delete') {
    if (!requireAdmin(req, res)) return;
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      const orderId = clampInput(body.orderId, 80);
      await deleteOrderById(orderId);
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 400, { ok: false, error: String(e && e.message ? e.message : e) });
    }
  }

  /* ── Products catalog (admin — local file or Google Sheet CSV per context) ── */
  if (req.method === 'GET' && pathname === '/api/admin/products') {
    if (!requireAdmin(req, res)) return;
    (async () => {
      try {
        const ctx = readContextJson();
        const source = productsSourceMode(ctx);
        const csv = await getProductsCsvForContext(ctx);
        return json(res, 200, { ok: true, source, csv });
      } catch (e) {
        const code = e && e.code;
        const status = code === 'BAD_URL' ? 400 : 500;
        return json(res, status, { ok: false, error: String(e && e.message ? e.message : e) });
      }
    })();
    return;
  }

  /* ── Protected saves ── */
  if (req.method === 'POST' && pathname === '/api/save-context') {
    if (!requireAdmin(req, res)) return;
    try {
      const raw = await readBody(req);
      const obj = JSON.parse(raw);
      await writeFileResilient(CONTEXT_PATH, JSON.stringify(obj, null, 2) + '\n');
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 400, { ok: false, error: String(e && e.message ? e.message : e) });
    }
  }

  if (req.method === 'POST' && pathname === '/api/save-products') {
    if (!requireAdmin(req, res)) return;
    try {
      const ctx = readContextJson();
      if (productsSourceMode(ctx) === 'google_sheets') {
        return json(res, 400, {
          ok: false,
          readOnly: true,
          error:
            'Product catalog is loaded from Google Sheets. Edit the spreadsheet there, then reload this page.'
        });
      }
      const raw = await readBody(req);
      let csvText;
      const ct = (req.headers['content-type'] || '').toLowerCase();
      if (ct.includes('application/json')) {
        const j = JSON.parse(raw);
        csvText = typeof j.csv === 'string' ? j.csv : '';
      } else {
        csvText = raw;
      }
      if (typeof csvText !== 'string') throw new Error('Expected CSV string');
      await writeFileResilient(PRODUCTS_PATH, csvText.replace(/\r?\n$/, '') + '\n');
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 400, { ok: false, error: String(e && e.message ? e.message : e) });
    }
  }

  /* ── Static files ── */
  let filePathname = pathname;
  if (filePathname === '/') filePathname = '/shop.html';

  const filePath = safeFilePath(filePathname);
  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Not found');
      }
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Server error');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

function ipv4LANAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      var v4 = net.family === 'IPv4' || net.family === 4;
      if (v4 && !net.internal) out.push(net.address);
    }
  }
  return out;
}

ensureDataDirs();
loadAuth();

server.listen(PORT, '0.0.0.0', () => {
  const isCloud = process.env.RENDER || process.env.RAILWAY || process.env.FLY_APP_NAME;
  if (isCloud) {
    console.log(`Server running on port ${PORT}`);
    console.log('Shop:  /shop.html   Admin: /admin.html');
  } else {
    console.log(`This PC:  http://127.0.0.1:${PORT}/shop.html`);
    console.log(`Admin:      http://127.0.0.1:${PORT}/admin.html`);
    const ips = ipv4LANAddresses();
    if (ips.length) {
      console.log('Same Wi\u2011Fi / LAN (use from phones & other PCs):');
      ips.forEach(function (ip) {
        console.log(`  http://${ip}:${PORT}/shop.html  |  admin: http://${ip}:${PORT}/admin.html`);
      });
    } else {
      console.log('(No non-local IPv4 found \u2014 check Wi\u2011Fi/Ethernet.)');
    }
  }
  console.log('Dev reset: POST /api/admin/dev-reset  { "devKey", "newPassword", "newPhone" (optional) }');
  if (loadAuthFromEnv()) {
    console.log('Auth: loaded from environment variables.');
  } else {
    console.log('Auth: loaded from admin-auth.json (set ADMIN_* env vars to persist auth across deploys).');
  }
});
