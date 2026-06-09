import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { recordLoginFailure, isLoginBlocked, clearLoginFailures } from '../src/rate_limit.js';

describe('rate-limit', () => {
  beforeEach(async () => {
    const keys = await env.RATE_LIMIT_KV.list();
    for (const k of keys.keys) await env.RATE_LIMIT_KV.delete(k.name);
  });

  it('starts unblocked', async () => {
    expect(await isLoginBlocked(env.RATE_LIMIT_KV, 'a@b.c', '1.2.3.4')).toBe(false);
  });

  it('blocks email after 5 failures', async () => {
    for (let i = 0; i < 5; i++) {
      await recordLoginFailure(env.RATE_LIMIT_KV, 'a@b.c', '1.2.3.4');
    }
    expect(await isLoginBlocked(env.RATE_LIMIT_KV, 'a@b.c', '5.6.7.8')).toBe(true);
  });

  it('blocks IP after 20 failures across emails', async () => {
    for (let i = 0; i < 20; i++) {
      await recordLoginFailure(env.RATE_LIMIT_KV, `user${i}@b.c`, '1.2.3.4');
    }
    expect(await isLoginBlocked(env.RATE_LIMIT_KV, 'fresh@b.c', '1.2.3.4')).toBe(true);
  });

  it('clearLoginFailures resets the email counter', async () => {
    for (let i = 0; i < 5; i++) await recordLoginFailure(env.RATE_LIMIT_KV, 'a@b.c', '1.2.3.4');
    await clearLoginFailures(env.RATE_LIMIT_KV, 'a@b.c');
    expect(await isLoginBlocked(env.RATE_LIMIT_KV, 'a@b.c', '5.6.7.8')).toBe(false);
  });
});
