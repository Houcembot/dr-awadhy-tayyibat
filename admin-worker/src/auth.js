const PBKDF2_ITERATIONS = 600_000;
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
