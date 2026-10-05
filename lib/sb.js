// Minimal Supabase REST helper (service key, server-side only)
export const sb = (path, opt = {}) =>
  fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...opt,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opt.headers || {}),
    },
  });
