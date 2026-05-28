import { describe, it, expect } from 'vitest';
import { checkRateLimit } from '../src/ratelimit.js';

function makeMockKV() {
  const store = new Map();
  return {
    async get(key) { return store.get(key) || null; },
    async put(key, value, opts) { store.set(key, value); }
  };
}

describe('checkRateLimit', () => {
  it('allows first request', async () => {
    const kv = makeMockKV();
    expect(await checkRateLimit(kv, '1.2.3.4')).toMatchObject({ allowed: true });
  });
  it('allows up to 8 requests from same IP in the burst window', async () => {
    const kv = makeMockKV();
    for (let i = 0; i < 8; i++) {
      expect(await checkRateLimit(kv, '1.2.3.4')).toMatchObject({ allowed: true });
    }
  });
  it('blocks the 9th request from same IP in the burst window', async () => {
    const kv = makeMockKV();
    for (let i = 0; i < 8; i++) await checkRateLimit(kv, '1.2.3.4');
    expect(await checkRateLimit(kv, '1.2.3.4')).toMatchObject({ allowed: false, reason: 'burst' });
  });
  it('allows different IPs independently', async () => {
    const kv = makeMockKV();
    for (let i = 0; i < 8; i++) await checkRateLimit(kv, '1.2.3.4');
    expect(await checkRateLimit(kv, '5.6.7.8')).toMatchObject({ allowed: true });
  });
});
