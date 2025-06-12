import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outdir: 'build',
  format: 'esm',
  sourcemap: true,
  packages: 'external',
  mainFields: ['module', 'main'],
  external: [
    // Node.js built-in modules
    'crypto',
    'path',
    'fs',
    'util',
    'stream',
    'events',
    'http',
    'https',
    'net',
    'tls',
    'os',
    'buffer',

    // External packages that should not be bundled
    '@toondepauw/node-zstd',
    '@anthropic-ai/sdk',
    '@aws-sdk/client-s3',
    '@solana/spl-token',
    'axios',
    'bs58',
    'dotenv',
    'express',
    'mongoose',
    'node-ssh',
    'openai',
    'random-words',
  ]
});
