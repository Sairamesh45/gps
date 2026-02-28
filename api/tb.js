// Vercel Serverless proxy for ThingsBoard API
// Expects environment variables: TB_HOST (optional), TB_USER, TB_PASS

const TB_HOST = process.env.TB_HOST || 'https://thingsboard.cloud';
const TB_USER = process.env.TB_USER;
const TB_PASS = process.env.TB_PASS;

let cached = { token: null, expiry: 0 };

async function login() {
  if (cached.token && Date.now() < cached.expiry - 60000) return cached.token;
  if (!TB_USER || !TB_PASS) throw new Error('Server misconfigured: TB_USER/TB_PASS not set');
  
  try {
    const r = await fetch(`${TB_HOST}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TB_USER, password: TB_PASS })
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      throw new Error(`ThingsBoard auth failed (${r.status}): ${errText || 'Check credentials'}`);
    }
    const d = await r.json();
    cached.token = d.token;
    cached.expiry = Date.now() + 3600 * 1000;
    return cached.token;
  } catch (err) {
    throw new Error(`Login error: ${err.message}`);
  }
}

export default async function handler(req, res) {
  // Enable CORS for testing
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  const { action, deviceId } = req.body || {};
  try {
    if (!action) return res.status(400).json({ error: 'Missing action' });
    if (!TB_USER || !TB_PASS) {
      return res.status(500).json({ error: 'Server misconfigured: TB_USER or TB_PASS not set in environment variables' });
    }

    const token = await login();

    if (action === 'telemetry') {
      const url = `${TB_HOST}/api/plugins/telemetry/DEVICE/${deviceId}/values/timeseries?keys=latitude,longitude&startTs=0&endTs=${Date.now()}&limit=10000&agg=NONE&orderBy=ASC`;
      const r = await fetch(url, { headers: { 'X-Authorization': 'Bearer ' + token } });
      if (!r.ok) return res.status(r.status).json({ error: 'Telemetry fetch failed', status: r.status });
      const data = await r.json();
      return res.status(200).json(data);
    }

    if (action === 'attrs') {
      const url = `${TB_HOST}/api/plugins/telemetry/DEVICE/${deviceId}/values/attributes/SHARED_SCOPE?keys=latitude,longitude`;
      const r = await fetch(url, { headers: { 'X-Authorization': 'Bearer ' + token } });
      if (!r.ok) return res.status(r.status).json({ error: 'Attr fetch failed', status: r.status });
      const arr = await r.json();
      // Transform array into { key: { value, ts } } object the client expects
      const obj = {};
      arr.forEach(x => { obj[x.key] = { value: x.value, ts: x.lastUpdateTs }; });
      return res.status(200).json(obj);
    }

    if (action === 'flush') {
      const url = `${TB_HOST}/api/plugins/telemetry/DEVICE/${deviceId}/timeseries/delete?keys=latitude,longitude&deleteAllDataForKeys=true`;
      const r = await fetch(url, { method: 'DELETE', headers: { 'X-Authorization': 'Bearer ' + token } });
      if (!r.ok) return res.status(r.status).json({ error: 'Flush failed', status: r.status });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
