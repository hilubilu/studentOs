// GET /api/cron?key=SECRET  -> call every minute (cron-job.org). Sends due push notifications.
import webpush from 'web-push';
import { fetchWeek } from '../lib/shahaf.js';
import { sb } from '../lib/sb.js';

const lk = l => l.subject + '|' + l.teacher;
const TZ = 'Asia/Jerusalem';

function israelNow() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
    }).formatToParts(new Date()).map(x => [x.type, x.value])
  );
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  const localUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return {
    day: `${p.year}-${p.month}-${p.day}`, wd, min: +p.hour * 60 + +p.minute,
    off: localUTC - Math.floor(Date.now() / 60000) * 60000,
  };
}

function eventsFor(s, week, T) {
  const cfg = Object.assign({ morning: '07:30', lesson: 10, dl: 24 }, s.cfg || {});
  const mine = new Set(s.mine || []);
  const out = [];
  const todays = (week ? week.lessons : []).filter(l => l.day === T.wd && mine.has(lk(l)));
  const open = (s.tasks || []).map(t => {
    const hrs = (Date.parse(t.due + ':00Z') - T.off - Date.now()) / 36e5;
    return { ...t, hrs, u: (t.est / 60 + 12) / (Math.max(hrs, 0.25) + 1) };
  });

  // morning summary
  const [mh, mm] = String(cfg.morning).split(':').map(Number);
  const mMin = mh * 60 + mm;
  if (T.min >= mMin && T.min < mMin + 180) {
    const starts = new Set(todays.map(l => l.start));
    const top = open.filter(t => t.hrs > 0).sort((a, b) => b.u - a.u).slice(0, 3).map(t => t.name);
    out.push({
      key: 'm' + T.day, title: 'בוקר טוב',
      body: [starts.size ? `${starts.size} שיעורים היום` : 'אין שיעורים היום', top.length ? 'בוער: ' + top.join(', ') : ''].filter(Boolean).join(' · '),
    });
  }
  // before lessons
  todays.forEach(l => {
    const [h, m] = l.start.split(':').map(Number);
    const diff = h * 60 + m - T.min;
    if (diff > 0 && diff <= cfg.lesson) out.push({ key: 'l' + T.day + l.start, title: l.subject, body: `מתחיל בעוד ${diff} דקות` + (l.room ? ` · ${l.room}` : '') });
  });
  // deadlines
  open.filter(t => t.hrs > 0 && t.hrs <= cfg.dl + t.est / 60).forEach(t => {
    const left = t.hrs < 1 ? Math.round(t.hrs * 60) + ' דקות' : Math.round(t.hrs) + ' שעות';
    out.push({ key: 'd' + t.id, title: t.name, body: `ההגשה בעוד ${left}. צפוי לקחת ${t.est} דקות` });
  });
  // school changes relevant to this student
  const toks = [...mine].flatMap(k => k.split('|')).filter(x => x.length > 2);
  const notes = (week ? week.notes : []).filter(n => toks.some(k => n.text.includes(k) || k.includes(n.text)));
  const noteEvents = notes.map(n => ({ key: `n${n.day}|${n.n}|${n.text}`, title: 'שינוי במערכת', body: n.text, note: true }));
  return { out, noteEvents };
}

export default async function handler(req, res) {
  if (req.query.key !== process.env.CRON_SECRET) return res.status(401).json({ error: 'unauthorized' });
  try {
    webpush.setVapidDetails(
      'mailto:' + (process.env.VAPID_EMAIL || 'studentos@example.com'),
      process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY
    );
    const subs = await (await sb('subscribers?select=*')).json();
    const T = israelNow();
    const weeks = {};
    let sent = 0, removed = 0;

    for (const s of subs) {
      if (!(s.cls in weeks)) weeks[s.cls] = await fetchWeek(s.cls).catch(() => null);
      const { out, noteEvents } = eventsFor(s, weeks[s.cls], T);
      let fired = s.fired || {};
      const cutoff = Date.now() - 6 * 864e5;
      Object.keys(fired).forEach(k => { if (fired[k] < cutoff) delete fired[k]; });

      if (!s.inited) { // first run: remember existing changes, don't announce them
        noteEvents.forEach(e => { fired[e.key] = Date.now(); });
        await sb(`subscribers?id=eq.${s.id}`, { method: 'PATCH', body: JSON.stringify({ fired, inited: true }) });
        continue;
      }
      let dirty = false, gone = false;
      for (const e of [...out, ...noteEvents]) {
        if (fired[e.key]) continue;
        try {
          await webpush.sendNotification(s.subscription, JSON.stringify({ title: e.title, body: e.body }));
          fired[e.key] = Date.now(); dirty = true; sent++;
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            await sb(`subscribers?id=eq.${s.id}`, { method: 'DELETE' });
            gone = true; removed++; break;
          }
        }
      }
      if (dirty && !gone) await sb(`subscribers?id=eq.${s.id}`, { method: 'PATCH', body: JSON.stringify({ fired }) });
    }
    res.status(200).json({ subscribers: subs.length, sent, removed });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
