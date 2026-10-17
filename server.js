// ============================================
// AnimeSaku Pro — All-in-One Proxy (Render.com / Node.js Version)
// Converted from Cloudflare Workers — all endpoints preserved
// ============================================

import express from 'express';
import { Readable } from 'stream';

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// CONFIG
// ============================================
const API_BASE = 'https://animeinweb.com/api/proxy/3/2/';
const SITE_URL = 'https://animeinweb.com';
const PROXY_SECRET = 'animein-secure-proxy-key-123';
const VALID_DAYS = ['SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU', 'MINGGU'];

// ============================================
// CORS & RESPONSE HELPERS
// ============================================
function corsHeaders(extra) {
  return Object.assign({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range, Authorization',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, Content-Disposition',
    'Access-Control-Max-Age': '86400',
  }, extra || {});
}

function jsonRes(res, data, status) {
  return res.status(status || 200)
    .set(corsHeaders({ 'Content-Type': 'application/json; charset=utf-8' }))
    .send(JSON.stringify(data, null, 2));
}

function errRes(res, msg, status) {
  return jsonRes(res, { success: false, error: msg }, status || 400);
}

function plainRes(res, text, status) {
  return res.status(status || 200)
    .set(corsHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }))
    .send(text);
}

async function streamRes(res, webBody, status, headers) {
  res.status(status || 200).set(corsHeaders(headers));
  if (!webBody) {
    res.end();
    return;
  }
  // Convert Web ReadableStream (from fetch) to Node Readable stream
  const nodeStream = Readable.fromWeb(webBody);
  nodeStream.pipe(res);
  // Handle client disconnect → cancel upstream
  res.on('close', () => {
    nodeStream.destroy();
  });
}

// ============================================
// HEADER UNTUK TARGET
// ============================================
function apiHeaders() {
  return {
    'x-proxy-secret': PROXY_SECRET,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
    'Referer': SITE_URL + '/',
    'Origin': SITE_URL,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  };
}

function mediaHeaders(mediaUrl, request) {
  const isVideo = /\.(mp4|m3u8|mkv|ts|webm)(\?|$)/i.test(mediaUrl || '');

  // Forward UA dari user (Render IP non-CF, ga kena bot detection)
  const ua = (request && request.headers['user-agent']) ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  const al = (request && request.headers['accept-language']) || 'en-US,en;q=0.9,id;q=0.8';

  return {
    'Accept': isVideo ? '*/*' : 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Accept-Language': al,
    'Accept-Encoding': 'identity',
    'Referer': SITE_URL + '/',
    'Origin': SITE_URL,
    'Sec-Fetch-Dest': isVideo ? 'video' : 'image',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': 'same-site',
    'User-Agent': ua,
  };
}

// ============================================
// FETCH HELPER
// ============================================
async function fetchAPI(path, params) {
  const url = new URL(path, API_BASE);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });
  }
  const resp = await fetch(url.toString(), {
    method: 'GET',
    headers: apiHeaders(),
    redirect: 'follow',
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`API ${resp.status}: ${t.slice(0, 300)}`);
  }
  return resp.json();
}

// ============================================
// FILENAME BUILDER
// ============================================
function buildFilename(params, fallbackUrl) {
  const title = (params.get('title') || '').trim();
  const ep = (params.get('ep') || '').trim();
  const q = (params.get('q') || '').trim();

  let ext = '.mp4';
  try {
    const last = new URL(fallbackUrl).pathname.split('/').pop() || '';
    const dot = last.lastIndexOf('.');
    if (dot > 0) ext = last.substring(dot);
  } catch (e) {}

  let name = '';
  if (title && ep) name = `${title} Episode ${ep}`;
  else if (title) name = title;
  else {
    try { name = decodeURIComponent(new URL(fallbackUrl).pathname.split('/').pop() || 'video'); }
    catch (e) { name = 'video'; }
  }
  if (q) name += ` [${q}]`;
  name += ext;
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s{2,}/g, ' ').trim();
}

// ============================================
// ROUTES
// ============================================
async function handleHome(req, res) {
  const day = (req.query.day || 'RABU').toUpperCase();
  const limit = req.query.limit || '16';
  if (!VALID_DAYS.includes(day)) return errRes(res, 'Hari tidak valid.');
  const n = parseInt(limit, 10);
  if (isNaN(n) || n < 1 || n > 100) return errRes(res, 'Limit harus angka 1-100');
  try {
    const data = await fetchAPI('home/data', { day, limit });
    return jsonRes(res, { success: true, data });
  } catch (e) {
    return errRes(res, `Gagal ambil data: ${e.message}`, 502);
  }
}

async function handleSchedule(req, res) {
  const limit = req.query.limit || '16';
  const n = parseInt(limit, 10);
  if (isNaN(n) || n < 1 || n > 100) return errRes(res, 'Limit harus angka 1-100');
  try {
    const results = await Promise.allSettled(
      VALID_DAYS.map(day => fetchAPI('home/data', { day, limit }))
    );
    const schedule = {};
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') schedule[VALID_DAYS[i]] = r.value;
      else schedule[VALID_DAYS[i]] = { error: r.reason?.message };
    });
    return jsonRes(res, { success: true, schedule });
  } catch (e) {
    return errRes(res, `Gagal ambil jadwal: ${e.message}`, 502);
  }
}

async function handleMovieDetail(req, res) {
  const id = req.params.id;
  if (!/^\d+$/.test(id)) return errRes(res, 'Format: /movie/{id}', 404);
  try {
    const data = await fetchAPI(`movie/detail/${id}`);
    return jsonRes(res, { success: true, data });
  } catch (e) {
    return errRes(res, `Gagal ambil detail: ${e.message}`, 502);
  }
}

async function handleGenericAPI(req, res) {
  const path = req.query.path || '';
  if (!path) return errRes(res, 'Parameter "path" wajib.');
  const params = {};
  Object.entries(req.query).forEach(([k, v]) => { if (k !== 'path') params[k] = v; });
  try {
    const fullUrl = new URL(path, API_BASE);
    Object.entries(params).forEach(([k, v]) => fullUrl.searchParams.set(k, v));
    const resp = await fetch(fullUrl.toString(), { headers: apiHeaders(), redirect: 'follow' });
    const body = await resp.text();
    return res.status(resp.status).set(corsHeaders({
      'Content-Type': resp.headers.get('Content-Type') || 'application/json'
    })).send(body);
  } catch (e) {
    return errRes(res, `Proxy gagal: ${e.message}`, 502);
  }
}

async function handleDownload(req, res) {
  const mediaUrl = req.query.url || '';
  if (!mediaUrl) return errRes(res, 'Parameter "url" wajib.');
  const isStream = req.query.stream === '1';

  // Build params object from query
  const params = new URLSearchParams();
  Object.entries(req.query).forEach(([k, v]) => params.set(k, v));
  const filename = buildFilename(params, mediaUrl);

  try {
    const reqH = Object.assign({}, mediaHeaders(mediaUrl, req));
    const range = req.headers['range'];
    if (range) reqH['Range'] = range;

    const resp = await fetch(mediaUrl, { headers: reqH });
    const h = {
      'Content-Type': resp.headers.get('Content-Type') || 'video/mp4',
      'Accept-Ranges': 'bytes',
    };
    if (!isStream) h['Content-Disposition'] = `attachment; filename="${filename}"`;
    if (resp.headers.get('Content-Range')) h['Content-Range'] = resp.headers.get('Content-Range');
    if (resp.headers.get('Content-Length')) h['Content-Length'] = resp.headers.get('Content-Length');

    return streamRes(res, resp.body, resp.status, h);
  } catch (e) {
    return errRes(res, `Download gagal: ${e.message}`, 502);
  }
}

async function handleMedia(req, res) {
  const mediaUrl = req.query.url || '';
  if (!mediaUrl) return errRes(res, 'Parameter "url" wajib.');

  try {
    const reqH = Object.assign({}, mediaHeaders(mediaUrl, req));
    const range = req.headers['range'];
    if (range) reqH['Range'] = range;

    const resp = await fetch(mediaUrl, { headers: reqH });
    const h = {
      'Content-Type': resp.headers.get('Content-Type') || 'video/mp4',
      'Accept-Ranges': 'bytes',
    };
    if (resp.headers.get('Content-Range')) h['Content-Range'] = resp.headers.get('Content-Range');
    if (resp.headers.get('Content-Length')) h['Content-Length'] = resp.headers.get('Content-Length');

    return streamRes(res, resp.body, resp.status, h);
  } catch (e) {
    return errRes(res, `Media proxy gagal: ${e.message}`, 502);
  }
}

function handleInfo(req, res) {
  return jsonRes(res, {
    success: true,
    worker: 'animesaku-proxy-render',
    message: 'Worker berjalan dengan baik di Render.com!',
    timestamp: new Date().toISOString(),
  });
}

async function handleHead(req, res) {
  const mediaUrl = req.query.url || '';
  if (!mediaUrl) return res.status(400).set(corsHeaders()).end();

  try {
    const resp = await fetch(mediaUrl, { method: 'HEAD', headers: mediaHeaders(mediaUrl, req) });
    const h = { 'Content-Type': resp.headers.get('Content-Type') || 'video/mp4' };
    if (resp.headers.get('Content-Length')) h['Content-Length'] = resp.headers.get('Content-Length');
    if (resp.headers.get('Accept-Ranges')) h['Accept-Ranges'] = resp.headers.get('Accept-Ranges');
    return res.status(resp.status).set(corsHeaders(h)).end();
  } catch (e) {
    return res.status(500).set(corsHeaders()).end();
  }
}

// ============================================
// MIDDLEWARE: CORS preflight
// ============================================
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    return res.status(204).set(corsHeaders()).end();
  }
  next();
});

// ============================================
// ROUTE DEFINITIONS
// ============================================

// Info / health
app.get(['/', '/info'], handleInfo);

// Home
app.get('/home', handleHome);

// Schedule
app.get('/schedule', handleSchedule);

// Movie detail
app.get('/movie/:id', handleMovieDetail);

// Generic API proxy
app.get('/api', handleGenericAPI);

// Download
app.get('/dl', handleDownload);

// Media stream
app.get('/media', handleMedia);

// HEAD requests for media/download
app.head(['/dl', '/media'], handleHead);

// 404 handler
app.use((req, res) => {
  errRes(res, `Endpoint "${req.path}" tidak ditemukan.`, 404);
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  errRes(res, `Internal error: ${err.message}`, 500);
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`AnimeSaku Proxy running on port ${PORT}`);
  console.log(`Endpoints: /info, /home, /schedule, /movie/:id, /api, /dl, /media`);
});
