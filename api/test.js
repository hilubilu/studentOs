// POST /api/test {endpoint} -> sends a test push to that device
import webpush from 'web-push';
import { sb } from '../lib/sb.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    if (!b.endpoint) return res.status(400).json({ error: 'endpoint required' });
    const rows = await (await sb(`subscribers?endpoint=eq.${encodeURIComponent(b.endpoint)}&select=subscription`)).json();
    if (!rows.length) return res.status(404).json({ error: 'not subscribed' });
    webpush.setVapidDetails(
      'mailto:' + (process.env.VAPID_EMAIL || 'studentos@example.com'),
      process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY
    );
    await webpush.sendNotification(rows[0].subscription, JSON.stringify({ title: 'StudentOS', body: 'ההתראות עובדות' }));
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
