const ID_RE = /^[A-Za-z0-9_-]{6,20}$/;

export function parse(url) {
  let u;
  try { u = new URL(url); } catch { return { valid: false }; }
  if (u.protocol !== 'https:') return { valid: false };
  let id = null;
  if (u.hostname === 'youtu.be') {
    id = u.pathname.slice(1).split('/')[0];
  } else if (u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com' || u.hostname === 'm.youtube.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else if (u.pathname.startsWith('/shorts/')) id = u.pathname.split('/')[2];
    else if (u.pathname.startsWith('/embed/')) id = u.pathname.split('/')[2];
  }
  if (!id || !ID_RE.test(id)) return { valid: false };
  return {
    valid: true,
    external_id: id,
    normalized_url: `https://www.youtube.com/watch?v=${id}`
  };
}

export async function fetchMetadata(external_id) {
  const embed_url = `https://www.youtube.com/embed/${external_id}`;
  const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${external_id}&format=json`;
  try {
    const r = await fetch(oembedUrl);
    if (!r.ok) throw new Error(`oembed ${r.status}`);
    const data = await r.json();
    return {
      title: data.title || null,
      thumbnail_url: data.thumbnail_url || `https://i.ytimg.com/vi/${external_id}/mqdefault.jpg`,
      duration_seconds: null,
      embed_url
    };
  } catch {
    return {
      title: null,
      thumbnail_url: `https://i.ytimg.com/vi/${external_id}/mqdefault.jpg`,
      duration_seconds: null,
      embed_url
    };
  }
}
