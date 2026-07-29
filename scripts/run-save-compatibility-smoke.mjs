import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { rm } from 'node:fs/promises';

const outfile = `/tmp/codmos-save-compatibility-smoke-${process.pid}.mjs`;
try {
  await build({
    entryPoints: ['scripts/save-compatibility-smoke.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    define: {
      'import.meta.env.BASE_URL': JSON.stringify('/'),
    },
  });
  await import(pathToFileURL(outfile).href);
} finally {
  await rm(outfile, { force: true });
}
