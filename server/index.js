import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
// Load .env explicitly from server/.env BEFORE importing GeminiAgent
dotenv.config({ path: './server/.env' });

import { researchSpecies } from './intelligence/GeminiAgent.js';

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json({ limit: '256kb' }));

// ---------------------------------------------------------------------------
//  Scientific-data gateway (per the platform architecture: Three.js → Node →
//  Python). Node is the single frontend-facing API. All real ocean-data routes
//  are proxied to the Python FastAPI ingestion service, which owns TLS (OS
//  trust store), source adapters and normalization. Node never contacts INCOIS
//  directly and exposes no secrets to the browser. If the ingestion service is
//  unreachable we return an explicit HTTP 502 — we NEVER fabricate data.
// ---------------------------------------------------------------------------
const INGEST_BASE = process.env.INGEST_BASE || 'http://127.0.0.1:8000';

// ---------------------------------------------------------------------------
//  Service health — lets the browser detect whether the full stack is running.
//  If this endpoint returns 200, Vite proxy → Node :3000 → Python :8000 path
//  is available. If unreachable the proxy returns a raw 500 (no body), which
//  the frontend translates to a diagnostic message.
// ---------------------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', backend: 'node', ingestBase: INGEST_BASE, ts: Date.now() });
});

// ---------------------------------------------------------------------------
// Scientific-data proxy — determines which upstream source the route addresses
// (INCOIS ERDDAP for observations, griddap adapters for model data) and labels
// failures accordingly so the browser can show an actionable diagnostic.
// ---------------------------------------------------------------------------
function routeSource(url) {
  if (url.includes('/api/observations')) return 'INCOIS ERDDAP (Argo floats)';
  if (url.includes('/api/model'))        return 'INCOIS ERDDAP (ocean model)';
  return 'Ocean-data ingestion service';
}

async function proxyToIngestion(req, res) {
  const target = INGEST_BASE + req.originalUrl;
  const source = routeSource(req.originalUrl);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const upstream = await fetch(target, {
      method: 'GET',                       // the data API is read-only
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    // Pass through canonical JSON verbatim; tag the source so the browser error
    // message can name INCOIS rather than showing a bare HTTP status.
    const body = await upstream.text();
    res.status(upstream.status);
    res.set('X-Ocean-Source', source);
    res.type(upstream.headers.get('content-type') || 'application/json');
    if (!upstream.ok) {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch {}
      if (parsed && (parsed.status === 'upstream_unavailable' || parsed.httpStatus === 503)) {
        console.warn(`[Proxy] ${source} reported upstream unavailable:`, parsed);
        return res.json(parsed);
      }
      // Wrap a non-2xx upstream response so the browser always gets a JSON body
      // with a `detail` field — never a blank 500 with no context.
      let detail = parsed?.detail || body.slice(0, 400);
      console.error(`[Proxy] ${source} returned HTTP ${upstream.status}: ${detail}`);
      res.json({ error: true, source, status: upstream.status, detail: detail || `HTTP ${upstream.status} from ${source}` });
    } else {
      res.send(body);
    }
  } catch (err) {
    const why = err.name === 'AbortError' ? 'timeout after 60 s' : err.message;
    const detail = `${source} unreachable (${why}). Ensure Python ingestion is running: npm run dev:ingest`;
    console.error(`[Proxy] ${detail}`);
    res.status(502).json({ error: true, source, status: 502, detail });
  } finally {
    clearTimeout(timer);
  }
}

// Data routes owned by the Python ingestion service (observations now; model
// field added in a later phase — the gateway does not change when it is).
app.use('/api/datasets', proxyToIngestion);
app.use('/api/observations', proxyToIngestion);
app.use('/api/model', proxyToIngestion);

// ---------------------------------------------------------------------------
//  DEV-ONLY performance telemetry sink.
//  The in-browser PerformanceProfiler overlay POSTs tagged snapshots here so a
//  headless session can read REAL measured numbers. Appends one JSON object
//  per line to server/perf-samples.ndjson. This is measurement plumbing only.
// ---------------------------------------------------------------------------
const PERF_LOG = path.join(process.cwd(), 'server', 'perf-samples.ndjson');
app.post('/api/perf', (req, res) => {
  try {
    fs.appendFile(PERF_LOG, JSON.stringify(req.body) + '\n', () => {});
  } catch (_) { /* telemetry must never 500 the client */ }
  res.status(204).end();
});
app.post('/api/perf/reset', (req, res) => {
  try { fs.writeFileSync(PERF_LOG, ''); } catch (_) {}
  res.status(204).end();
});

app.post('/api/intelligence/research', async (req, res) => {
  const { assetName } = req.body;
  if (!assetName) {
    return res.status(400).json({ error: "assetName is required" });
  }

  try {
    const { researchSpecies } = await import(`./intelligence/GeminiAgent.js?t=${Date.now()}`);
    const profile = await researchSpecies(assetName);
    res.json(profile);
  } catch (error) {
    console.error(`[Backend] Error researching ${assetName}:`, error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// Local Marine Knowledge Base
// ---------------------------------------------------------------------------
const DB_PATH = path.join(process.cwd(), 'src', 'data', 'marineKnowledge.json');

function readKnowledgeBase() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = fs.readFileSync(DB_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('[Backend] Failed to read knowledge base:', e);
  }
  return [];
}

function writeKnowledgeBase(db) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    console.error('[Backend] Failed to write knowledge base:', e);
  }
}

app.get('/api/knowledge/:identifier', (req, res) => {
  const id = req.params.identifier.toLowerCase();
  const db = readKnowledgeBase();
  
  // Find by AphiaID, scientific name, or common name / asset name alias
  const record = db.find(r => {
    if (r.identity) {
      if (r.identity.aphiaId && String(r.identity.aphiaId) === id) return true;
      if (r.identity.scientificName && r.identity.scientificName.toLowerCase() === id) return true;
      if (r.identity.commonName && r.identity.commonName.toLowerCase() === id) return true;
    }
    // Also check aliases (including assetName) if we want to store it in a generic way
    if (r.aliases && r.aliases.map(a => a.toLowerCase()).includes(id)) return true;
    return false;
  });

  if (record) {
    res.json(record);
  } else {
    res.status(404).json({ error: "Record not found" });
  }
});

app.post('/api/knowledge', (req, res) => {
  const profile = req.body;
  if (!profile || !profile.identity) {
    return res.status(400).json({ error: "Invalid KnowledgeProfile structure" });
  }

  const db = readKnowledgeBase();
  const aphiaId = profile.identity.aphiaId;
  const sciName = profile.identity.scientificName;
  
  // Try to find an existing record to update, else append
  let existingIdx = -1;
  if (aphiaId) {
    existingIdx = db.findIndex(r => r.identity?.aphiaId === aphiaId);
  } else if (sciName) {
    existingIdx = db.findIndex(r => r.identity?.scientificName === sciName);
  } else {
    existingIdx = db.findIndex(r => r.identity?.commonName === profile.identity.commonName);
  }

  if (existingIdx >= 0) {
    // Merge aliases
    const existingAliases = db[existingIdx].aliases || [];
    const newAliases = profile.aliases || [];
    const mergedAliases = Array.from(new Set([...existingAliases, ...newAliases]));
    profile.aliases = mergedAliases;
    db[existingIdx] = profile;
  } else {
    if (!profile.aliases) profile.aliases = [];
    db.push(profile);
  }

  writeKnowledgeBase(db);
  res.json({ success: true, status: existingIdx >= 0 ? "updated" : "inserted" });
});

// Bind explicitly to the IPv4 loopback so the address matches the Vite proxy
// target (http://127.0.0.1:3000). Without a host arg Node's default binding can
// leave the Vite hop resolving 'localhost' → ::1 and refusing intermittently.
app.listen(port, '127.0.0.1', () => {
  console.log(`[Backend] Intelligence server listening on http://127.0.0.1:${port}`);
});
