// Friends: who is free right now. Pure functions, shared by the server (api/friends.js)
// and by the in-browser demo, so both behave exactly the same.
export const TZ = 'Asia/Jerusalem';

export function israelNow(ms = Date.now()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
    }).formatToParts(new Date(ms)).map(x => [x.type, x.value])
  );
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return { day: `${p.year}-${p.month}-${p.day}`, wd, min: +p.hour * 60 + +p.minute };
}

const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const DUR = { exam: 90, quiz: 45, mock: 180, activity: 60 };
const MIN_WINDOW = 30; // a gap shorter than this is a break, not a window

// A snapshot is {days: {'YYYY-MM-DD': {off?, les:[{s,e,sub,t,r,st}], ev:[{k,s}]}}}
// st: '' | 'cancel' | 'special' | 'exam'
function lessonsOf(day) {
  return (day.les || []).filter(l => l.s).map(l => {
    const a = toMin(l.s), b = l.e ? toMin(l.e) : a + 45;
    return { ...l, a, b: Math.max(b, a + 1) };
  }).sort((x, y) => x.a - y.a);
}

// What is this person doing at time T? hide = show only "in class", without subject, teacher and room.
export function statusNow(snap, T, priv = {}) {
  const d = snap && snap.days && snap.days[T.day];
  if (!d) return { state: 'unknown', text: 'אין מידע עדכני' };
  if (d.off) return { state: 'free', text: 'אין לימודים היום' };
  const les = lessonsOf(d), busy = les.filter(l => l.st !== 'cancel');
  for (const e of d.ev || []) {
    if (!e.s) continue;
    const a = toMin(e.s), b = a + (DUR[e.k] || 60);
    if (T.min >= a && T.min < b) return { state: 'event', text: e.k === 'activity' ? 'בפעילות' : 'במבחן', until: hhmm(b) };
  }
  const cur = les.find(l => T.min >= l.a && T.min < l.b);
  const nextBusy = busy.filter(l => l.a > T.min).sort((x, y) => x.a - y.a)[0];
  if (cur && cur.st === 'cancel') {
    const t = nextBusy ? `חופשי עד ${hhmm(nextBusy.a)}` : 'סיים ללמוד להיום';
    return { state: 'free', text: priv.hide ? t : `שיעור ${cur.sub} בוטל, ${t}`, until: nextBusy ? hhmm(nextBusy.a) : '' };
  }
  if (cur && (cur.st === 'special' || cur.st === 'exam')) {
    return { state: 'event', text: cur.st === 'exam' ? 'במבחן' : 'בפעילות', until: hhmm(cur.b) };
  }
  if (cur) {
    if (priv.hide) return { state: 'class', text: 'בשיעור', until: hhmm(cur.b) };
    const bits = [cur.sub, cur.t, cur.r ? `כיתה ${cur.r}` : ''].filter(Boolean);
    return { state: 'class', text: 'בשיעור: ' + bits.join(', '), until: hhmm(cur.b) };
  }
  if (!les.length) return { state: 'free', text: 'אין שיעורים היום' };
  if (!busy.length) return { state: 'free', text: 'כל השיעורים היום בוטלו' };
  if (T.min < busy[0].a) return { state: 'free', text: `הלימודים מתחילים ב-${hhmm(busy[0].a)}`, until: hhmm(busy[0].a) };
  if (T.min >= Math.max(...busy.map(l => l.b))) return { state: 'free', text: 'סיים ללמוד להיום' };
  const prev = busy.filter(l => l.b <= T.min).sort((x, y) => y.b - x.b)[0];
  const gap = nextBusy.a - (prev ? prev.b : T.min);
  if (gap >= MIN_WINDOW) return { state: 'free', text: `חלון עד ${hhmm(nextBusy.a)}`, until: hhmm(nextBusy.a) };
  return { state: 'class', text: `בהפסקה עד ${hhmm(nextBusy.a)}`, until: hhmm(nextBusy.a) };
}

// Windows: gaps between two lessons that stay in school. Cancelled lessons leave a longer gap.
function gaps(day) {
  if (!day || day.off) return [];
  const out = [];
  let end = null;
  for (const l of lessonsOf(day).filter(x => x.st !== 'cancel')) {
    if (end !== null && l.a - end >= MIN_WINDOW) out.push([end, l.a]);
    end = end === null ? l.b : Math.max(end, l.b);
  }
  return out;
}

// Shared free windows of two people, from fromDay on.
export function overlap(mine, theirs, fromDay) {
  const out = [];
  Object.keys((mine && mine.days) || {}).sort().forEach(k => {
    if (k < fromDay || !theirs || !theirs.days || !theirs.days[k]) return;
    const A = gaps(mine.days[k]), B = gaps(theirs.days[k]);
    A.forEach(([a1, a2]) => B.forEach(([b1, b2]) => {
      const s = Math.max(a1, b1), e = Math.min(a2, b2);
      if (e - s >= MIN_WINDOW) out.push({ d: k, s: hhmm(s), e: hhmm(e) });
    }));
  });
  return out;
}

// ---- friendship rules: one row per pair, {lo, hi, requester, state: pending|accepted|blocked, blocker} ----
export const pair = (a, b) => (a < b ? [a, b] : [b, a]);

export function decideRequest(row, from, to) {
  const [lo, hi] = pair(from, to);
  if (!row) return { action: 'insert', row: { lo, hi, requester: from, state: 'pending', blocker: null }, state: 'pending' };
  if (row.state === 'blocked') return { action: 'none', state: 'pending' }; // a block is never revealed
  if (row.state === 'accepted') return { action: 'none', state: 'accepted' };
  if (row.requester === from) return { action: 'none', state: 'pending' };
  return { action: 'update', row: { ...row, state: 'accepted' }, state: 'accepted' }; // both asked: mutual
}
export function decideRespond(row, me, from, decision) {
  if (!row || row.state !== 'pending' || row.requester !== from) return { action: 'none' };
  if (decision === 'accept') return { action: 'update', row: { ...row, state: 'accepted' } };
  if (decision === 'block') return { action: 'update', row: { ...row, state: 'blocked', blocker: me } };
  return { action: 'delete', row };
}
export function decideBlock(row, me, other) {
  const [lo, hi] = pair(me, other);
  if (!row) return { action: 'insert', row: { lo, hi, requester: me, state: 'blocked', blocker: me } };
  if (row.state === 'blocked' && row.blocker !== me) return { action: 'none' };
  return { action: 'update', row: { ...row, state: 'blocked', blocker: me } };
}
export function decideRemove(row, me) {
  if (!row) return { action: 'none' };
  if (row.state === 'blocked' && row.blocker !== me) return { action: 'none' }; // only the blocker can undo
  return { action: 'delete', row };
}

// Everything the screen needs for one person. Only accepted (mutual) friends are ever shown a status.
export function buildList(fid, profiles, ships, T) {
  const me = profiles[fid];
  const out = { me: { fid, name: me.name || '', ghost: !!me.ghost, hide: !!me.hide }, friends: [], incoming: [], outgoing: [], blocked: [] };
  const nm = id => (profiles[id] && profiles[id].name) || 'חבר';
  ships.filter(s => s.lo === fid || s.hi === fid).forEach(s => {
    const other = s.lo === fid ? s.hi : s.lo, p = profiles[other];
    if (!p) return;
    if (s.state === 'blocked') { if (s.blocker === fid) out.blocked.push({ fid: other, name: nm(other) }); return; }
    if (s.state === 'pending') { (s.requester === fid ? out.outgoing : out.incoming).push({ fid: other, name: nm(other) }); return; }
    const stale = !p.updated_at || Date.now() - Date.parse(p.updated_at) > 4 * 864e5;
    let status, ov = [];
    if (p.ghost) status = { state: 'ghost', text: 'לא זמין' };
    else {
      status = stale ? { state: 'unknown', text: 'אין מידע עדכני' } : statusNow(p.snap, T, { hide: !!p.hide });
      if (!stale && me.snap && p.snap) ov = overlap(me.snap, p.snap, T.day);
    }
    out.friends.push({ fid: other, name: p.name || 'חבר', status, overlap: ov });
  });
  const rank = { free: 0, event: 1, class: 2, ghost: 3, unknown: 3 };
  out.friends.sort((a, b) => rank[a.status.state] - rank[b.status.state] || a.name.localeCompare(b.name, 'he'));
  return out;
}
