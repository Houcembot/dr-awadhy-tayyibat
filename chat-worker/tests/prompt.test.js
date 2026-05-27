import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../src/prompt.js';

const SAMPLE_VIDEOS = [
  { id: 'v1', title_original: 'السكري والأنسولين', primary_topic: 'diabete-insuline-glycemie', duration_label: '12:34' },
  { id: 'v2', title_original: 'الصيام المتقطع', primary_topic: 'jeune-rythme-poids', duration_label: '8:20' },
];

describe('buildPrompt', () => {
  it('returns an object with system and user keys', () => {
    const result = buildPrompt('ما علاج السكري؟', SAMPLE_VIDEOS);
    expect(result).toHaveProperty('system');
    expect(result).toHaveProperty('user');
  });
  it('includes the question in the user field', () => {
    const result = buildPrompt('ما علاج السكري؟', SAMPLE_VIDEOS);
    expect(result.user).toBe('ما علاج السكري؟');
  });
  it('includes video IDs in the system prompt', () => {
    const result = buildPrompt('السكري', SAMPLE_VIDEOS);
    expect(result.system).toContain('v1');
    expect(result.system).toContain('v2');
  });
  it('includes video titles in the system prompt', () => {
    const result = buildPrompt('السكري', SAMPLE_VIDEOS);
    expect(result.system).toContain('السكري والأنسولين');
  });
  it('includes JSON output instruction in system prompt', () => {
    const result = buildPrompt('test', SAMPLE_VIDEOS);
    expect(result.system).toContain('video_ids');
    expect(result.system).toContain('answer');
  });
  it('handles empty video list', () => {
    const result = buildPrompt('test', []);
    expect(result.system).toBeDefined();
    expect(result.user).toBe('test');
  });
  it('includes French language instruction when lang=fr', () => {
    const result = buildPrompt('test', SAMPLE_VIDEOS, 'fr');
    expect(result.system).toContain('français');
  });
  it('includes English language instruction when lang=en', () => {
    const result = buildPrompt('test', SAMPLE_VIDEOS, 'en');
    expect(result.system).toContain('English');
  });
  it('defaults to Arabic when lang is not provided', () => {
    const result = buildPrompt('test', SAMPLE_VIDEOS);
    expect(result.system).toContain('العربية');
  });
});
