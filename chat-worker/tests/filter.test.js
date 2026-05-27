import { describe, it, expect } from 'vitest';
import { filterVideos, tokenize } from '../src/filter.js';

const SAMPLE_VIDEOS = [
  { id: 'v1', title_original: 'السكري والأنسولين', primary_topic: 'diabete-insuline-glycemie', tags: ['سكر', 'insuline'] },
  { id: 'v2', title_original: 'الصداع وعلاجه', primary_topic: 'sommeil-fatigue-stress', tags: ['صداع', 'ارهاق'] },
  { id: 'v3', title_original: 'الكبد والأيض', primary_topic: 'foie-metabolisme', tags: ['كبد'] },
  { id: 'v4', title_original: 'الصيام المتقطع', primary_topic: 'jeune-rythme-poids', tags: ['صيام', 'وزن'] },
];

describe('tokenize', () => {
  it('splits Arabic text into tokens', () => {
    expect(tokenize('السكري والأنسولين')).toEqual(['السكري', 'والأنسولين']);
  });
  it('splits French text into tokens', () => {
    expect(tokenize('diabète insuline')).toEqual(['diabète', 'insuline']);
  });
  it('removes single-character tokens', () => {
    expect(tokenize('a السكر b')).not.toContain('a');
    expect(tokenize('a السكر b')).not.toContain('b');
  });
  it('returns empty array for empty string', () => {
    expect(tokenize('')).toEqual([]);
  });
});

describe('filterVideos', () => {
  it('returns videos matching topic', () => {
    const results = filterVideos('diabete', SAMPLE_VIDEOS);
    expect(results[0].id).toBe('v1');
  });
  it('returns videos matching Arabic title', () => {
    const results = filterVideos('السكري', SAMPLE_VIDEOS);
    expect(results[0].id).toBe('v1');
  });
  it('returns videos matching tags', () => {
    const results = filterVideos('صداع', SAMPLE_VIDEOS);
    expect(results[0].id).toBe('v2');
  });
  it('respects the limit parameter', () => {
    const results = filterVideos('ا', SAMPLE_VIDEOS, 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
  it('returns first N videos when no tokens match', () => {
    const results = filterVideos('zzz', SAMPLE_VIDEOS, 3);
    expect(results.length).toBe(3);
  });
  it('ranks topic match higher than title match', () => {
    const results = filterVideos('insuline', SAMPLE_VIDEOS);
    expect(results[0].id).toBe('v1');
  });
});
