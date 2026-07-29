import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { rm } from 'node:fs/promises';

const outfile = `/tmp/codmos-level-up-smoke-${process.pid}.mjs`;
try {
  await build({
    entryPoints: ['scripts/level-up-smoke.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
  });
  await import(pathToFileURL(outfile).href);
} finally {
  await rm(outfile, { force: true });
}
