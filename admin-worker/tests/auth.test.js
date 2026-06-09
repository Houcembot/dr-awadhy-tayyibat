import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth.js';

describe('PBKDF2 hash/verify', () => {
  it('hashes a password into { hash, salt } base64 strings', async () => {
    const { hash, salt } = await hashPassword('hunter2');
    expect(hash).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(salt).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(salt.length).toBeGreaterThanOrEqual(20);
  });

  it('produces different hashes for same password (different salts)', async () => {
    const a = await hashPassword('hunter2');
    const b = await hashPassword('hunter2');
    expect(a.hash).not.toBe(b.hash);
    expect(a.salt).not.toBe(b.salt);
  });

  it('verifyPassword returns true for correct password', async () => {
    const { hash, salt } = await hashPassword('hunter2');
    expect(await verifyPassword('hunter2', hash, salt)).toBe(true);
  });

  it('verifyPassword returns false for wrong password', async () => {
    const { hash, salt } = await hashPassword('hunter2');
    expect(await verifyPassword('wrong', hash, salt)).toBe(false);
  });
});
