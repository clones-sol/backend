#!/usr/bin/env ts-node

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

async function buildRewardPool() {
  console.log('🔨 Building Reward Pool Program...');

  try {
    // Check if Cargo is installed
    try {
      execSync('cargo --version', { stdio: 'pipe' });
    } catch (error) {
      console.error('❌ Cargo is not installed. Please install Rust and Cargo first.');
      console.log('Visit: https://rustup.rs/');
      process.exit(1);
    }

    // Check if Solana CLI is installed
    try {
      execSync('solana --version', { stdio: 'pipe' });
    } catch (error) {
      console.error('❌ Solana CLI is not installed. Please install Solana CLI first.');
      console.log('Visit: https://docs.solana.com/cli/install-solana-cli-tools');
      process.exit(1);
    }

    // Change to the reward-pool program directory
    const programDir = path.join(__dirname, '..', 'programs', 'reward-pool');
    process.chdir(programDir);

    console.log('📁 Building in directory:', programDir);

    // Clean previous builds
    console.log('🧹 Cleaning previous builds...');
    execSync('cargo clean', { stdio: 'inherit' });

    // Build the program
    console.log('🔨 Building program...');
    execSync('cargo build-sbf', { stdio: 'inherit' });

    // Get the program ID from the build
    console.log('🔍 Extracting program ID...');
    const programIdOutput = execSync('solana address -k target/deploy/reward_pool-keypair.json', { 
      encoding: 'utf8' 
    }).trim();

    console.log(`✅ Program built successfully!`);
    console.log(`📋 Program ID: ${programIdOutput}`);
    console.log(`📁 Binary location: target/deploy/reward_pool.so`);

    // Save build info
    const buildInfo = {
      programId: programIdOutput,
      buildTime: new Date().toISOString(),
      version: '1.0.0',
      target: 'sbf',
      binaryPath: 'target/deploy/reward_pool.so',
      keypairPath: 'target/deploy/reward_pool-keypair.json'
    };

    fs.writeFileSync(
      path.join(programDir, 'build-info.json'),
      JSON.stringify(buildInfo, null, 2)
    );

    console.log('📄 Build info saved to: build-info.json');

    // Instructions for deployment
    console.log('\n📝 Next Steps:');
    console.log('1. Update your .env file with the new program ID:');
    console.log(`   REWARD_POOL_PROGRAM_ID=${programIdOutput}`);
    console.log('2. Deploy to devnet:');
    console.log('   npm run deploy:devnet');
    console.log('3. Deploy to mainnet:');
    console.log('   npm run deploy:mainnet');

    return buildInfo;

  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

// Run the build
if (require.main === module) {
  buildRewardPool().catch(console.error);
}

export { buildRewardPool }; 