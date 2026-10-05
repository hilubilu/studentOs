// GET /api/classes -> list of class names from the school timetable page
import { listClasses } from '../lib/shahaf.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  try {
    res.status(200).json({ classes: await listClasses() });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
