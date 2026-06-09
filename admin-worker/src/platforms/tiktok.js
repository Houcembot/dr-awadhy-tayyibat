const ID_RE = /^[A-Za-z0-9]+$/;

export function parse(url) {
  let u;
  try { u = new URL(url); } catch { return { valid: false }; }
  if (u.protocol !== 'https:') return { valid: false };
  if (u.hostname === 'www.tiktok.com' || u.hostname === 'tiktok.com') {
    const m = u.pathname.match(/^\/@[^/]+\/video\/(\d+)/);
    if (m && ID_RE.test(m[1])) {
      return { valid: true, external_id: m[1], normalized_url: u.href };
    }
  }
  if (u.hostname === 'vm.tiktok.com') {
    const code = u.pathname.replace(/\//g, '');
    if (code && ID_RE.test(code)) {
      return { valid: true, external_id: code, normalized_url: u.href };
    }
  }
  return { valid: false };
}

export async function fetchMetadata(external_id, normalized_url) {
  try {
    const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(normalized_url)}`;
    const r = await fetch(oembedUrl);
    if (!r.ok) throw new Error(`oembed ${r.status}`);
    const data = await r.json();
    return {
      title: data.title || null,
      thumbnail_url: data.thumbnail_url || null,
      duration_seconds: null,
      embed_url: normalized_url
    };
  } catch {
    return { title: null, thumbnail_url: null, duration_seconds: null, embed_url: normalized_url };
  }
}
