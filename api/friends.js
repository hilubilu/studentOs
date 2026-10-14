// POST /api/friends {action, fid, secret, ...}
// Actions: register, me, request, respond, block, remove, list, drop.
// Access to a friend's schedule exists only between two people who both agreed (mutual approval).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { sb } from '../lib/sb.js';
import { israelNow, buildList, decideRequest, decideRespond, decideBlock, decideRemove, pair } from '../lib/avail.js';

const FID = /^[A-HJ-NP-Z2-9]{8}$/;
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const hash = s => createHash('sha256').update(String(s)).digest('hex');
const newFid = () => [...randomBytes(8)].map(b => ALPHA[b % ALPHA.length]).join('');
const bad = (res, code, error) => res.status(code).json({ error });

async function one(path) { const r = await sb(path); const j = await r.json(); return Array.isArray(j) ? j[0] : null; }
async function auth(b) {
  if (!FID.test(String(b.fid || ''))) return null;
  const p = await one(`fprofiles?fid=eq.${b.fid}&select=fid,secret_hash`);
  if (!p) return null;
  const a = Buffer.from(p.secret_hash, 'hex'), c = Buffer.from(hash(b.secret || ''), 'hex');
  return a.length === c.length && timingSafeEqual(a, c) ? p : null;
}
const getShip = (a, b) => { const [lo, hi] = pair(a, b); return one(`fships?lo=eq.${lo}&hi=eq.${hi}&select=*`); };
async function applyShip(d) {
  if (d.action === 'insert') return sb('fships', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ...d.row, updated_at: new Date().toISOString() }) });
  if (d.action === 'update') return sb(`fships?lo=eq.${d.row.lo}&hi=eq.${d.row.hi}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ state: d.row.state, blocker: d.row.blocker || null, updated_at: new Date().toISOString() }) });
  if (d.action === 'delete') return sb(`fships?lo=eq.${d.row.lo}&hi=eq.${d.row.hi}`, { method: 'DELETE' });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    if (b.action === 'register') {
      const name = String(b.name || '').trim().slice(0, 20);
      const secret = randomBytes(24).toString('base64url');
      for (let i = 0; i < 6; i++) {
        const fid = newFid();
        const r = await sb('fprofiles', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ fid, secret_hash: hash(secret), name }) });
        if (r.ok) return res.status(200).json({ fid, secret });
        if (r.status !== 409) return bad(res, 500, 'db');
      }
      return bad(res, 500, 'busy');
    }
    const me = await auth(b);
    if (!me) return bad(res, 401, 'auth');
    const other = String(b.to || b.from || b.other || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (b.action === 'me') {
      const patch = {};
      if (typeof b.name === 'string') patch.name = b.name.trim().slice(0, 20);
      if (typeof b.ghost === 'boolean') patch.ghost = b.ghost;
      if (typeof b.hide === 'boolean') patch.hide = b.hide;
      if (b.snap && typeof b.snap === 'object') {
        if (JSON.stringify(b.snap).length > 60000) return bad(res, 413, 'too large');
        patch.snap = b.snap; patch.updated_at = new Date().toISOString();
      }
      const r = await sb(`fprofiles?fid=eq.${me.fid}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
      return r.ok ? res.status(200).json({ ok: true }) : bad(res, 500, 'db');
    }
    if (b.action === 'list') {
      const T = israelNow();
      const ships = await (await sb(`fships?or=(lo.eq.${me.fid},hi.eq.${me.fid})&select=*`)).json();
      const ids = [...new Set([me.fid, ...ships.flatMap(s => [s.lo, s.hi])])];
      const rows = await (await sb(`fprofiles?fid=in.(${ids.join(',')})&select=fid,name,ghost,hide,snap,updated_at`)).json();
      const profiles = Object.fromEntries(rows.map(p => [p.fid, p]));
      return res.status(200).json(buildList(me.fid, profiles, ships, T));
    }
    if (b.action === 'drop') {
      await sb(`fships?or=(lo.eq.${me.fid},hi.eq.${me.fid})`, { method: 'DELETE' });
      await sb(`fprofiles?fid=eq.${me.fid}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }
    if (!FID.test(other)) return bad(res, 400, 'bad code');
    if (other === me.fid) return bad(res, 400, 'self');
    if (b.action === 'request') {
      if (!(await one(`fprofiles?fid=eq.${other}&select=fid`))) return bad(res, 404, 'not_found');
      const d = decideRequest(await getShip(me.fid, other), me.fid, other);
      if (d.action !== 'none') await applyShip(d);
      return res.status(200).json({ state: d.state });
    }
    const row = await getShip(me.fid, other);
    if (b.action === 'respond') { const d = decideRespond(row, me.fid, other, b.decision); if (d.action !== 'none') await applyShip(d); return res.status(200).json({ ok: true }); }
    if (b.action === 'block') { const d = decideBlock(row, me.fid, other); if (d.action !== 'none') await applyShip(d); return res.status(200).json({ ok: true }); }
    if (b.action === 'remove') { const d = decideRemove(row, me.fid); if (d.action !== 'none') await applyShip(d); return res.status(200).json({ ok: true }); }
    return bad(res, 400, 'bad action');
  } catch (e) {
    return bad(res, 500, 'server');
  }
}
