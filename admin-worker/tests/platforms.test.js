import { describe, it, expect, vi } from 'vitest';
import * as youtube from '../src/platforms/youtube.js';
import * as tiktok from '../src/platforms/tiktok.js';
import * as instagram from '../src/platforms/instagram.js';
import * as facebook from '../src/platforms/facebook.js';

describe('youtube.parse', () => {
  it('parses youtube.com/watch?v=ID', () => {
    expect(youtube.parse('https://www.youtube.com/watch?v=cZ3GxPO4cXo')).toEqual({
      valid: true, external_id: 'cZ3GxPO4cXo', normalized_url: 'https://www.youtube.com/watch?v=cZ3GxPO4cXo'
    });
  });

  it('parses youtu.be/ID', () => {
    expect(youtube.parse('https://youtu.be/cZ3GxPO4cXo')).toMatchObject({ valid: true, external_id: 'cZ3GxPO4cXo' });
  });

  it('parses youtube.com/shorts/ID', () => {
    expect(youtube.parse('https://www.youtube.com/shorts/cZ3GxPO4cXo')).toMatchObject({ valid: true, external_id: 'cZ3GxPO4cXo' });
  });

  it('rejects non-YouTube URL', () => {
    expect(youtube.parse('https://vimeo.com/123').valid).toBe(false);
  });

  it('rejects non-https schema', () => {
    expect(youtube.parse('http://youtube.com/watch?v=abc').valid).toBe(false);
  });
});

describe('youtube.fetchMetadata', () => {
  it('returns metadata from oEmbed', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      title: 'Test Video', thumbnail_url: 'https://i.ytimg.com/x.jpg'
    })));
    const meta = await youtube.fetchMetadata('cZ3GxPO4cXo');
    expect(meta.title).toBe('Test Video');
    expect(meta.thumbnail_url).toBe('https://i.ytimg.com/x.jpg');
    expect(meta.embed_url).toBe('https://www.youtube.com/embed/cZ3GxPO4cXo');
  });

  it('falls back gracefully when oEmbed fails', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));
    const meta = await youtube.fetchMetadata('badid');
    expect(meta.title).toBe(null);
    expect(meta.embed_url).toBe('https://www.youtube.com/embed/badid');
  });
});

describe('tiktok.parse', () => {
  it('parses tiktok.com/@user/video/ID', () => {
    expect(tiktok.parse('https://www.tiktok.com/@user/video/7012345678901234567')).toMatchObject({
      valid: true, external_id: '7012345678901234567'
    });
  });

  it('parses vm.tiktok.com/SHORTCODE/', () => {
    expect(tiktok.parse('https://vm.tiktok.com/abc123/')).toMatchObject({ valid: true, external_id: 'abc123' });
  });

  it('rejects non-TikTok', () => {
    expect(tiktok.parse('https://youtube.com/watch?v=x').valid).toBe(false);
  });
});

describe('tiktok.fetchMetadata', () => {
  it('returns oEmbed metadata when available', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      title: 'TikTok video', thumbnail_url: 'https://p.tiktok.com/x.jpg'
    })));
    const meta = await tiktok.fetchMetadata('7012345678901234567', 'https://www.tiktok.com/@u/video/7012345678901234567');
    expect(meta.title).toBe('TikTok video');
    expect(meta.embed_url).toBe('https://www.tiktok.com/@u/video/7012345678901234567');
  });
});

describe('instagram.parse', () => {
  it('parses /reel/ID', () => {
    expect(instagram.parse('https://www.instagram.com/reel/Cabc123/')).toMatchObject({
      valid: true, external_id: 'Cabc123'
    });
  });
  it('parses /p/ID', () => {
    expect(instagram.parse('https://www.instagram.com/p/Cabc123/')).toMatchObject({ valid: true });
  });
  it('rejects other hosts', () => {
    expect(instagram.parse('https://www.facebook.com/').valid).toBe(false);
  });
});

describe('instagram.fetchMetadata (MVP)', () => {
  it('returns placeholder metadata', async () => {
    const meta = await instagram.fetchMetadata('Cabc123', 'https://www.instagram.com/reel/Cabc123/');
    expect(meta.title).toBe('Instagram Reel');
    expect(meta.embed_url).toContain('instagram.com');
  });
});

describe('facebook.parse', () => {
  it('parses facebook.com/watch?v=ID', () => {
    expect(facebook.parse('https://www.facebook.com/watch/?v=123456789')).toMatchObject({
      valid: true, external_id: '123456789'
    });
  });
  it('parses fb.watch/SHORTCODE', () => {
    expect(facebook.parse('https://fb.watch/abc123/')).toMatchObject({ valid: true });
  });
});

describe('facebook.fetchMetadata (MVP)', () => {
  it('returns placeholder metadata', async () => {
    const meta = await facebook.fetchMetadata('123', 'https://www.facebook.com/watch/?v=123');
    expect(meta.title).toBe('Facebook Video');
    expect(meta.embed_url).toContain('facebook.com/plugins/video.php');
  });
});
