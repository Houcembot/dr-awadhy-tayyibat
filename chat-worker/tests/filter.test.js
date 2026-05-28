import { describe, it, expect } from 'vitest';
import { filterVideos, tokenize } from '../src/filter.js';

const SAMPLE_VIDEOS = [
  { id: 'v1', title_original: 'السكري والأنسولين', primary_topic: 'diabete-insuline-glycemie', tags: ['سكر', 'insuline'] },
  { id: 'v2', title_original: 'الصداع وعلاجه', primary_topic: 'sommeil-fatigue-stress', tags: ['صداع', 'ارهاق'] },
  { id: 'v3', title_original: 'الكبد والأيض', primary_topic: 'foie-metabolisme', tags: ['كبد'] },
  { id: 'v4', title_original: 'الصيام المتقطع', primary_topic: 'jeune-rythme-poids', tags: ['صيام', 'وزن'] },
  { id: 'v5', title_original: 'الدكتور ضياء العوضي مباشر', primary_topic: 'systeme-tayyibat', tags: [] },
];

describe('tokenize', () => {
  it('splits Arabic text into tokens', () => {
    expect(tokenize('السكري والأنسولين')).toEqual(['السكري', 'والأنسولين']);
  });
  it('splits French text into tokens', () => {
    expect(tokenize('diabète insuline')).toEqual(['diabète', 'insuline', 'انسولين', 'أنسولين']);
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
    const { videos: results } = filterVideos('diabete', SAMPLE_VIDEOS);
    expect(results[0].id).toBe('v1');
  });
  it('returns videos matching Arabic title', () => {
    const { videos: results } = filterVideos('السكري', SAMPLE_VIDEOS);
    expect(results[0].id).toBe('v1');
  });
  it('returns videos matching tags', () => {
    const { videos: results } = filterVideos('صداع', SAMPLE_VIDEOS);
    expect(results[0].id).toBe('v2');
  });
  it('respects the limit parameter', () => {
    const { videos: results } = filterVideos('ا', SAMPLE_VIDEOS, 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
  it('returns no matches when the question has no searchable tokens', () => {
    const result = filterVideos('ما هو رأي الدكتور ضياء؟', SAMPLE_VIDEOS, 3);
    expect(result).toMatchObject({ videos: [], hasMatches: false });
  });
  it('returns no matches when no video matches the tokens', () => {
    const result = filterVideos('zzz', SAMPLE_VIDEOS, 3);
    expect(result).toMatchObject({ videos: [], hasMatches: false });
  });
  it('does not match only on Dr Dia name tokens for unrelated Arabic questions', () => {
    const result = filterVideos('ما رأي الدكتور ضياء في إصلاح محرك سيارة كهربائية؟', SAMPLE_VIDEOS, 3);
    expect(result).toMatchObject({ videos: [], hasMatches: false });
  });
  it('ranks topic match higher than title match', () => {
    const { videos: results } = filterVideos('insuline', SAMPLE_VIDEOS);
    expect(results[0].id).toBe('v1');
  });
});
