// GET  /api/sync?code=XXXX   -> {data, v}
// POST /api/sync {code, data} -> {v}
// The code is a random 32-char secret that acts as the key to one user's data.
import { sb } from '../lib/sb.js';

const norm = c => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const code = norm(req.query.code);
      if (code.length !== 32) return res.status(400).json({ error: 'bad code' });
      const rows = await (await sb(`profiles?code=eq.${code}&select=data,updated_at`)).json();
      if (!rows.length) return res.status(404).json({ error: 'not found' });
      return res.status(200).json({ data: rows[0].data, v: Date.parse(rows[0].updated_at) });
    }
    if (req.method === 'POST') {
      const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const code = norm(b.code);
      if (code.length !== 32) return res.status(400).json({ error: 'bad code' });
      const data = b.data && typeof b.data === 'object' ? b.data : {};
      if (JSON.stringify(data).length > 400000) return res.status(413).json({ error: 'too large' });
      const now = new Date().toISOString();
      const r = await sb('profiles?on_conflict=code', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ code, data, updated_at: now }),
      });
      if (!r.ok) return res.status(500).json({ error: await r.text() });
      return res.status(200).json({ v: Date.parse(now) });
    }
    res.status(405).end();
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
