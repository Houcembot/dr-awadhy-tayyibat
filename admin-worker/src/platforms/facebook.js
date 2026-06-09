const ID_RE = /^[A-Za-z0-9_-]+$/;

export function parse(url) {
  let u;
  try { u = new URL(url); } catch { return { valid: false }; }
  if (u.protocol !== 'https:') return { valid: false };
  if (u.hostname === 'www.facebook.com' || u.hostname === 'facebook.com' || u.hostname === 'm.facebook.com') {
    if (u.pathname.startsWith('/watch')) {
      const v = u.searchParams.get('v');
      if (v && ID_RE.test(v)) return { valid: true, external_id: v, normalized_url: u.href };
    }
    const m = u.pathname.match(/\/videos\/(\d+)/);
    if (m) return { valid: true, external_id: m[1], normalized_url: u.href };
  }
  if (u.hostname === 'fb.watch') {
    const code = u.pathname.replace(/\//g, '');
    if (code && ID_RE.test(code)) return { valid: true, external_id: code, normalized_url: u.href };
  }
  return { valid: false };
}

export async function fetchMetadata(external_id, normalized_url) {
  return {
    title: 'Facebook Video',
    thumbnail_url: null,
    duration_seconds: null,
    embed_url: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(normalized_url)}`
  };
}
