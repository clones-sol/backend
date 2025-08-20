import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/server.ts'],
  outdir: 'build',
  platform: 'node',
  target: 'node18',
  format: 'esm',
  bundle: true,
  sourcemap: true,
  packages: 'external',
  mainFields: ['module', 'main'],
});
