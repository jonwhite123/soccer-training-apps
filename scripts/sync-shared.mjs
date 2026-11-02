#!/usr/bin/env node
// Copies shared/* into every HTML file between its SHARED markers, so each app stays one
// self-contained file that runs anywhere. Run after editing anything in shared/.
//   node scripts/sync-shared.mjs          update files in place
//   node scripts/sync-shared.mjs --check  exit 1 if any inlined copy is stale
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const BLOCK = /(\/\* SHARED:([\w.-]+) BEGIN[^*]*\*\/\n)[\s\S]*?(\/\* SHARED:\2 END \*\/)/g;

const htmlFiles = [
  'index.html',
  ...['apps', 'template'].flatMap((dir) =>
    readdirSync(join(root, dir)).filter((f) => f.endsWith('.html')).map((f) => join(dir, f))),
];

const stale = [];
for (const rel of htmlFiles) {
  const path = join(root, rel);
  const before = readFileSync(path, 'utf8');
  const after = before.replace(BLOCK, (_, open, name, close) => {
    const src = join(root, 'shared', name);
    if (!existsSync(src)) throw new Error(`${rel}: no shared/${name}`);
    return open + readFileSync(src, 'utf8').replace(/\n*$/, '\n') + close;
  });
  if (after !== before) {
    stale.push(rel);
    if (!check) writeFileSync(path, after);
  }
}

if (check && stale.length) {
  console.error(`Stale shared code in: ${stale.join(', ')}\nRun: node scripts/sync-shared.mjs`);
  process.exit(1);
}
console.log(stale.length ? `Updated: ${stale.join(', ')}` : 'All files up to date.');
