import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          d1Databases: ['ADMIN_DB'],
          kvNamespaces: ['RATE_LIMIT_KV'],
          bindings: {
            JWT_SECRET: 'test-secret-32-bytes-fixed-string',
            TRACKING_KEY: 'test-tracking-key',
            ALLOWED_ORIGIN: 'https://tayyibat.pages.dev'
          }
        }
      }
    }
  }
});
