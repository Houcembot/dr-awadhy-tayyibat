export function parseCookie(header) {
  if (!header) return {};
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export function formatAuthCookie(jwt) {
  return `Auth=${jwt}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=28800`;
}

export function clearAuthCookie() {
  return `Auth=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0`;
}
