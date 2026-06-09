const ID_RE = /^[A-Za-z0-9_-]{5,30}$/;

export function parse(url) {
  let u;
  try { u = new URL(url); } catch { return { valid: false }; }
  if (u.protocol !== 'https:') return { valid: false };
  if (!(u.hostname === 'www.instagram.com' || u.hostname === 'instagram.com')) {
    return { valid: false };
  }
  const m = u.pathname.match(/^\/(reel|p|tv)\/([^/]+)/);
  if (!m || !ID_RE.test(m[2])) return { valid: false };
  return { valid: true, external_id: m[2], normalized_url: u.href };
}

export async function fetchMetadata(external_id, normalized_url) {
  return {
    title: 'Instagram Reel',
    thumbnail_url: null,
    duration_seconds: null,
    embed_url: normalized_url
  };
}
