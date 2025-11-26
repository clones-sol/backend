import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'fs';

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

// Copy data seed files to build directory
console.log('Copying data seed files...');
mkdirSync('build/data', { recursive: true });
cpSync('src/data/apps-seed.json', 'build/data/apps-seed.json');
cpSync('src/data/app-relations-seed.json', 'build/data/app-relations-seed.json');
console.log('✓ Data seed files copied to build/data/');
