// Shared scraper for the school's Shahaf timetable page.
export const BASE = 'https://alliance.shahaf.site/timetable/A866398';
const norm = s => String(s || '').replace(/[^א-תa-zA-Z0-9]/g, '');
const clean = s => decode(String(s || '').replace(/\s+/g, ' ').trim());

function decode(s) {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function findClassValue(html, wanted) {
  const re = /<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (norm(decode(m[2])) === norm(wanted)) return m[1];
  }
  return null;
}

function parseCell(html) {
  const t = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(b|strong)[^>]*>/gi, '«')
    .replace(/<\/(b|strong)>/gi, '»')
    .replace(/<[^>]+>/g, ' ');
  const lessons = [], notes = [];
  const pre = t.split('«')[0];
  if (clean(pre)) notes.push(clean(pre));
  const re = /«([^»]*)»\s*(?:\(([^)]*)\))?([^«]*)/g;
  let m;
  while ((m = re.exec(t))) {
    lessons.push({ subject: clean(m[1]), room: clean(m[2] || ''), teacher: clean(m[3]) });
  }
  return { lessons, notes };
}

// Returns {class, week, days, lessons, notes} or null if the class was not found.
export async function fetchWeek(wanted, week = 0) {
  const home = await (await fetch(BASE)).text();
  const cls = findClassValue(home, wanted);
  if (!cls) return null;
  const url = `${BASE}?cls=${encodeURIComponent(cls)}&tab=changestable&week=${week}`;
  const html = await (await fetch(url)).text();
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const lessons = [], notes = [], days = [];
  rows.forEach((row, ri) => {
    const cells = row.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || [];
    if (cells.length < 2) return;
    const texts = cells.map(c => clean(c.replace(/<[^>]+>/g, ' ')));
    if (ri === 0 || /^יום/.test(texts[1] || '')) {
      texts.slice(1).forEach((t, i) => {
        const d = t.match(/(\d{2}\.\d{2})/);
        days[i] = { label: t, date: d ? d[1] : '' };
      });
      return;
    }
    const head = texts[0].match(/^(\d+)\s+(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})/);
    if (!head) return;
    const [, n, start, end] = head;
    cells.slice(1).forEach((c, day) => {
      const inner = c.replace(/^<t[hd][^>]*>/i, '').replace(/<\/t[hd]>$/i, '');
      const p = parseCell(inner);
      p.lessons.forEach(l => lessons.push({ day, n: +n, start, end, ...l }));
      p.notes.forEach(text => notes.push({ day, n: +n, text }));
    });
  });
  return { class: wanted, week, days, lessons, notes };
}
