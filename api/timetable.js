// GET /api/timetable?class=יא - 1&week=0
import { fetchWeek } from '../lib/shahaf.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
  try {
    const wanted = req.query.class || '';
    const week = parseInt(req.query.week || '0', 10) || 0;
    const data = await fetchWeek(wanted, week);
    if (!data) return res.status(404).json({ error: 'class not found', class: wanted });
    res.status(200).json({ ...data, fetchedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
