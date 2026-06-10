import { describe, it, expect } from 'vitest';
import { isBot } from '../src/bot_filter.js';

describe('isBot', () => {
  it('returns false for a real Chrome UA', () => {
    expect(isBot('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36')).toBe(false);
  });
  it('returns false for null/empty', () => {
    expect(isBot(null)).toBe(false);
    expect(isBot('')).toBe(false);
  });
  it('returns true for Googlebot', () => {
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
  });
  it('returns true for Bingbot', () => {
    expect(isBot('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)')).toBe(true);
  });
  it('returns true for AhrefsBot, SemrushBot, MJ12bot, DotBot, PetalBot, Bytespider, GPTBot, ClaudeBot', () => {
    for (const name of ['AhrefsBot', 'SemrushBot', 'MJ12bot', 'DotBot', 'PetalBot', 'Bytespider', 'GPTBot', 'ClaudeBot']) {
      expect(isBot(`Mozilla/5.0 (compatible; ${name}/1.0)`)).toBe(true);
    }
  });
  it('is case-insensitive', () => {
    expect(isBot('Mozilla/5.0 GOOGLEBOT/2.1')).toBe(true);
  });
});
