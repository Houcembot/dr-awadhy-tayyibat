import { handleLogin } from './routes/login.js';
import { handleLogout } from './routes/logout.js';
import { listVideos, addVideo, patchVideo, deleteVideo, getVideo } from './routes/videos.js';
import { listUsers, createUser, patchUser, deleteUser } from './routes/users.js';
import { listPublicVideos } from './routes/public.js';
import { listWhitelist, addWhitelist, deleteWhitelist, listPublicWhitelist, patchWhitelist } from './routes/whitelist.js';
import { handleTrack, handleTrackChat } from './routes/track.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS'
};

function withCors(env, request, response) {
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGIN;
  const h = new Headers(response.headers);
  if (origin && (origin === allowed || origin.startsWith('http://localhost'))) {
    h.set('Access-Control-Allow-Origin', origin);
    for (const [k, v] of Object.entries(CORS_HEADERS)) h.set(k, v);
  }
  return new Response(response.body, { status: response.status, headers: h });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return withCors(env, request, new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    let response;
    try {
      if (request.method === 'POST' && url.pathname === '/api/track') {
        response = await handleTrack(request, env);
      } else if (request.method === 'POST' && url.pathname === '/api/track-chat') {
        response = await handleTrackChat(request, env);
      } else if (request.method === 'GET' && url.pathname === '/api/public/videos') {
        response = await listPublicVideos(request, env);
      } else if (request.method === 'GET' && url.pathname === '/api/public/videos-whitelist') {
        response = await listPublicWhitelist(request, env);
      } else if (request.method === 'GET' && url.pathname === '/api/whitelist') {
        response = await listWhitelist(request, env);
      } else if (request.method === 'POST' && url.pathname === '/api/whitelist') {
        response = await addWhitelist(request, env);
      } else if (url.pathname.match(/^\/api\/whitelist\/([^/]+)$/) && request.method === 'DELETE') {
        const id = decodeURIComponent(url.pathname.split('/')[3]);
        response = await deleteWhitelist(request, env, id);
      } else if (url.pathname.match(/^\/api\/whitelist\/([^/]+)$/) && request.method === 'PATCH') {
        const id = decodeURIComponent(url.pathname.split('/')[3]);
        response = await patchWhitelist(request, env, id);
      } else if (request.method === 'POST' && url.pathname === '/api/login') {
        response = await handleLogin(request, env);
      } else if (request.method === 'POST' && url.pathname === '/api/logout') {
        response = await handleLogout();
      } else if (request.method === 'GET' && url.pathname === '/api/videos') {
        response = await listVideos(request, env);
      } else if (request.method === 'POST' && url.pathname === '/api/videos') {
        response = await addVideo(request, env);
      } else if (url.pathname.match(/^\/api\/videos\/(\d+)$/)) {
        const vid = parseInt(url.pathname.split('/')[3], 10);
        if (request.method === 'GET') response = await getVideo(request, env, vid);
        else if (request.method === 'PATCH') response = await patchVideo(request, env, vid);
        else if (request.method === 'DELETE') response = await deleteVideo(request, env, vid);
        else response = new Response('Method not allowed', { status: 405 });
      } else if (request.method === 'GET' && url.pathname === '/api/users') {
        response = await listUsers(request, env);
      } else if (request.method === 'POST' && url.pathname === '/api/users') {
        response = await createUser(request, env);
      } else if (url.pathname.match(/^\/api\/users\/(\d+)$/)) {
        const uid = parseInt(url.pathname.split('/')[3], 10);
        if (request.method === 'PATCH') response = await patchUser(request, env, uid);
        else if (request.method === 'DELETE') response = await deleteUser(request, env, uid);
        else response = new Response('Method not allowed', { status: 405 });
      } else {
        response = new Response('Not found', { status: 404 });
      }
    } catch (err) {
      console.error('worker_error', err.stack || err.message);
      response = new Response('Internal error', { status: 500 });
    }
    return withCors(env, request, response);
  }
};
