// POST   /api/subscribe  {subscription, cls, mine, cfg, tasks}  -> save/update this device
// DELETE /api/subscribe  {endpoint}                             -> remove this device
import { sb } from '../lib/sb.js';

export default async function handler(req, res) {
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    if (req.method === 'DELETE') {
      if (!b.endpoint) return res.status(400).json({ error: 'endpoint required' });
      await sb(`subscribers?endpoint=eq.${encodeURIComponent(b.endpoint)}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }
    if (req.method !== 'POST') return res.status(405).end();
    const s = b.subscription;
    if (!s || !s.endpoint) return res.status(400).json({ error: 'subscription required' });
    const row = {
      endpoint: s.endpoint,
      subscription: s,
      cls: String(b.cls || '').slice(0, 20),
      mine: Array.isArray(b.mine) ? b.mine.slice(0, 200) : [],
      cfg: b.cfg || {},
      tasks: Array.isArray(b.tasks) ? b.tasks.slice(0, 200) : [],
      updated_at: new Date().toISOString(),
    };
    const r = await sb('subscribers?on_conflict=endpoint', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(row),
    });
    if (!r.ok) return res.status(500).json({ error: await r.text() });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
