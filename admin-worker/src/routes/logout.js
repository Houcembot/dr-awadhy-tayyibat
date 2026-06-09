import { clearAuthCookie } from '../cookie.js';

export async function handleLogout() {
  return new Response(null, {
    status: 200,
    headers: { 'Set-Cookie': clearAuthCookie() }
  });
}
