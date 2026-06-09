import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, signJWT, verifyJWT } from '../src/auth.js';

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

describe('JWT HS256', () => {
  const secret = 'test-secret-32-bytes-fixed-string';

  it('signs and verifies a valid token', async () => {
    const token = await signJWT({ uid: 1, role: 'admin' }, secret, 60);
    const payload = await verifyJWT(token, secret);
    expect(payload.uid).toBe(1);
    expect(payload.role).toBe('admin');
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects token with wrong secret', async () => {
    const token = await signJWT({ uid: 1, role: 'admin' }, secret, 60);
    await expect(verifyJWT(token, 'other-secret')).rejects.toThrow(/signature/i);
  });

  it('rejects expired token', async () => {
    const token = await signJWT({ uid: 1, role: 'admin' }, secret, -10);
    await expect(verifyJWT(token, secret)).rejects.toThrow(/expired/i);
  });

  it('rejects malformed token', async () => {
    await expect(verifyJWT('not.a.jwt', secret)).rejects.toThrow();
  });
});
