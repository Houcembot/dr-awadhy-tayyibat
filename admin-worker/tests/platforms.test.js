import { describe, it, expect, vi } from 'vitest';
import * as youtube from '../src/platforms/youtube.js';

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
