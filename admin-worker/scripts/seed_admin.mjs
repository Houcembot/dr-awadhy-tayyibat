#!/usr/bin/env node
import { hashPassword } from '../src/auth.js';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const pw = process.env.INITIAL_ADMIN_PASSWORD;
if (!pw) {
  console.error('Set INITIAL_ADMIN_PASSWORD env var');
  process.exit(1);
}

const { hash, salt } = await hashPassword(pw);

// Escape single quotes in SQL string literals
const safeHash = hash.replace(/'/g, "''");
const safeSalt = salt.replace(/'/g, "''");

const sql = `INSERT INTO users (email, display_name, password_hash, password_salt, role)
VALUES ('houcemben@gmail.com', 'Houcem', '${safeHash}', '${safeSalt}', 'admin')
ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, password_salt = excluded.password_salt;`;

const tmp = '/tmp/seed_admin.sql';
writeFileSync(tmp, sql);
console.log('Seeding admin via D1 remote...');
execSync(`npx wrangler d1 execute tayyibat-admin-db --remote --file=${tmp}`, { stdio: 'inherit' });
console.log('Admin seeded: houcemben@gmail.com');
