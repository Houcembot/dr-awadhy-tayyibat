import { parseCookie } from './cookie.js';

const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH_BYTES = 32;
const SALT_LENGTH_BYTES = 16;

function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str);
}

function base64ToBuf(b64) {
  const str = atob(b64);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes.buffer;
}

async function pbkdf2(password, saltBuf) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBuf, iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    KEY_LENGTH_BYTES * 8
  );
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  const hashBuf = await pbkdf2(password, salt.buffer);
  return { hash: bufToBase64(hashBuf), salt: bufToBase64(salt.buffer) };
}

export async function verifyPassword(password, expectedHashB64, saltB64) {
  const saltBuf = base64ToBuf(saltB64);
  const actualBuf = await pbkdf2(password, saltBuf);
  const actualB64 = bufToBase64(actualBuf);
  if (actualB64.length !== expectedHashB64.length) return false;
  let diff = 0;
  for (let i = 0; i < actualB64.length; i++) {
    diff |= actualB64.charCodeAt(i) ^ expectedHashB64.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

function b64urlFromBuf(buf) {
  return bufToBase64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBuf(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  return base64ToBuf(padded);
}

function b64urlEncodeText(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecodeText(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return atob(s);
}

export async function signJWT(payload, secret, ttlSeconds = 28800) {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const header = b64urlEncodeText(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64urlEncodeText(JSON.stringify(fullPayload));
  const data = `${header}.${body}`;
  const key = await hmacKey(secret);
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${b64urlFromBuf(sigBuf)}`;
}

export async function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');
  const [header, body, sig] = parts;
  const data = `${header}.${body}`;
  const key = await hmacKey(secret);
  const sigBuf = b64urlToBuf(sig);
  const valid = await crypto.subtle.verify('HMAC', key, sigBuf, new TextEncoder().encode(data));
  if (!valid) throw new Error('Invalid signature');
  let payload;
  try {
    payload = JSON.parse(b64urlDecodeText(body));
  } catch {
    throw new Error('Malformed JWT payload');
  }
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
  return payload;
}

export async function requireAuth(request, secret, allowedRoles) {
  const cookies = parseCookie(request.headers.get('Cookie'));
  const token = cookies.Auth;
  if (!token) {
    return { error: new Response('Unauthorized', { status: 401 }) };
  }
  let payload;
  try {
    payload = await verifyJWT(token, secret);
  } catch {
    return { error: new Response('Unauthorized', { status: 401 }) };
  }
  if (!allowedRoles.includes(payload.role)) {
    return { error: new Response('Forbidden', { status: 403 }) };
  }
  return { user: payload };
}
