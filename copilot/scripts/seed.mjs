#!/usr/bin/env node
/**
 * Loads the fictional demo dataset by calling the running app's own endpoint
 * (POST /api/demo/seed). One source of truth for demo content, and it proves
 * the API works end to end.
 *
 * Usage:  node scripts/seed.mjs [base_url] [--reset]
 *   npm run seed            → http://localhost:3000
 *   npm run seed -- --reset → wipe existing chat data first
 */
const base = (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:3000').replace(/\/$/, '');
const reset = process.argv.includes('--reset');

try {
  const res = await fetch(`${base}/api/demo/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reset }),
  });
  const data = await res.json();

  if (!res.ok || !data.ok) {
    console.error(`✖ Seeding failed (HTTP ${res.status}): ${data.error ?? 'unknown error'}`);
    process.exit(1);
  }

  console.log(`✔ Demo data loaded${reset ? ' (reset)' : ''}`);
  console.log(`  ${data.contacts} contacts · ${data.conversations} conversations · ${data.messages} messages · ${data.memories} memory items`);
  if (!reset && data.messages === 0) {
    console.log('\n  ℹ Demo data was already present, so nothing was duplicated.');
    console.log('    To reload it from scratch:  npm run seed:reset');
  }
  console.log(`  Open ${base}/chat to start drafting.`);
} catch (err) {
  console.error(`✖ Could not reach the app at ${base}.\n  ${err.message}`);
  console.log('\n  Start it first:\n    npm run dev        # then re-run: npm run seed\n');
  console.log('  Or skip the CLI entirely and click "Load demo data" on the dashboard.');
  process.exit(1);
}
