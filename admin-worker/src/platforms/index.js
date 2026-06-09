import * as youtube from './youtube.js';
import * as tiktok from './tiktok.js';
import * as instagram from './instagram.js';
import * as facebook from './facebook.js';

const MODULES = { youtube, tiktok, instagram, facebook };

export function detectPlatform(url) {
  let h;
  try { h = new URL(url).hostname; } catch { return null; }
  if (/(^|\.)youtube\.com$/.test(h) || h === 'youtu.be') return 'youtube';
  if (/(^|\.)tiktok\.com$/.test(h)) return 'tiktok';
  if (/(^|\.)instagram\.com$/.test(h)) return 'instagram';
  if (/(^|\.)facebook\.com$/.test(h) || h === 'fb.watch') return 'facebook';
  return null;
}

export function parseUrl(url) {
  const platform = detectPlatform(url);
  if (!platform) return null;
  const parsed = MODULES[platform].parse(url);
  if (!parsed.valid) return null;
  return { platform, parsed };
}

export async function fetchMeta(platform, external_id, normalized_url) {
  return MODULES[platform].fetchMetadata(external_id, normalized_url);
}
