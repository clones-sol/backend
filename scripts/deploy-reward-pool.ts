#!/usr/bin/env ts-node

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { RewardPoolClient } from '../src/solana-client';
import { RewardPoolService } from '../src/services/blockchain/rewardPool';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

// Configuration
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = process.env.REWARD_POOL_PROGRAM_ID || 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';
const PLATFORM_FEE_PERCENTAGE = parseInt(process.env.PLATFORM_FEE_PERCENTAGE || '10');
const PLATFORM_TREASURY_ADDRESS = process.env.PLATFORM_TREASURY_ADDRESS;

// Token mints to support
const SUPPORTED_TOKENS = [
  {
    symbol: 'USDC',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // Devnet USDC
    decimals: 6
  },
  {
    symbol: 'CLONES',
    mint: '11111111111111111111111111111111', // Placeholder - replace with actual CLONES mint
    decimals: 6
  }
];

async function main() {
  console.log('🚀 Starting Reward Pool Deployment...');
  console.log(`Network: ${RPC_URL}`);
  console.log(`Program ID: ${PROGRAM_ID}`);
  console.log(`Platform Fee: ${PLATFORM_FEE_PERCENTAGE}%`);

  // Initialize connection
  const connection = new Connection(RPC_URL, 'confirmed');
  
  // Load platform authority keypair
  const platformAuthorityKeypair = loadPlatformAuthorityKeypair();
  
  // Initialize clients
  const client = new RewardPoolClient(connection);
  const service = new RewardPoolService(
    connection,
    PROGRAM_ID,
    platformAuthorityKeypair,
    PLATFORM_TREASURY_ADDRESS
  );

  try {
    // Step 1: Check if reward pool is already initialized
    console.log('\n📋 Checking if reward pool is already initialized...');
    const existingRewardPool = await client.getRewardPool();
    
    if (existingRewardPool) {
      console.log('✅ Reward pool already initialized');
      console.log(`Platform Authority: ${existingRewardPool.platformAuthority.toString()}`);
      console.log(`Platform Fee: ${existingRewardPool.platformFeePercentage}%`);
      console.log(`Total Rewards Distributed: ${existingRewardPool.totalRewardsDistributed.toString()}`);
      console.log(`Total Platform Fees: ${existingRewardPool.totalPlatformFeesCollected.toString()}`);
      console.log(`Paused: ${existingRewardPool.isPaused}`);
    } else {
      // Step 2: Initialize reward pool
      console.log('\n🔧 Initializing reward pool...');
      const initSignature = await service.initializeRewardPool(PLATFORM_FEE_PERCENTAGE);
      console.log(`✅ Reward pool initialized successfully`);
      console.log(`Transaction: ${initSignature.signature}`);
      console.log(`Slot: ${initSignature.slot}`);
    }

    // Step 3: Create reward vaults for supported tokens
    console.log('\n🏦 Creating reward vaults for supported tokens...');
    for (const token of SUPPORTED_TOKENS) {
      console.log(`Creating vault for ${token.symbol} (${token.mint})...`);
      
      try {
        const vaultSignature = await service.createRewardVault(token.mint);
        console.log(`✅ ${token.symbol} vault created successfully`);
        console.log(`Transaction: ${vaultSignature.signature}`);
        console.log(`Slot: ${vaultSignature.slot}`);
      } catch (error) {
        console.log(`⚠️  ${token.symbol} vault may already exist: ${error.message}`);
      }
    }

    // Step 4: Verify deployment
    console.log('\n🔍 Verifying deployment...');
    const stats = await service.getPlatformStats();
    console.log('Platform Statistics:');
    console.log(`- Total Rewards Distributed: ${stats.totalRewardsDistributed}`);
    console.log(`- Total Platform Fees Collected: ${stats.totalPlatformFeesCollected}`);
    console.log(`- Paused: ${stats.isPaused}`);

    // Step 5: Check vault balances
    console.log('\n💰 Checking vault balances...');
    for (const token of SUPPORTED_TOKENS) {
      const balance = await service.getRewardVaultBalance(token.mint);
      console.log(`${token.symbol} Vault Balance: ${balance} ${token.symbol}`);
    }

    console.log('\n🎉 Reward Pool Deployment Complete!');
    console.log('\n📝 Next Steps:');
    console.log('1. Fund the reward vaults with tokens');
    console.log('2. Update environment variables:');
    console.log(`   - REWARD_POOL_PROGRAM_ID=${PROGRAM_ID}`);
    console.log(`   - PLATFORM_TREASURY_ADDRESS=${PLATFORM_TREASURY_ADDRESS || 'SET_THIS'}`);
    console.log('3. Test the reward distribution system');
    console.log('4. Deploy to mainnet when ready');

  } catch (error) {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  }
}

function loadPlatformAuthorityKeypair(): Keypair {
  // Try to load from environment variable first
  const privateKeyEnv = process.env.PLATFORM_AUTHORITY_PRIVATE_KEY;
  if (privateKeyEnv) {
    try {
      const privateKeyBytes = Buffer.from(privateKeyEnv, 'base64');
      return Keypair.fromSecretKey(privateKeyBytes);
    } catch (error) {
      console.error('Failed to load platform authority from environment variable:', error);
    }
  }

  // Try to load from keypair file
  const keypairPath = process.env.PLATFORM_AUTHORITY_KEYPAIR_PATH || './platform-authority.json';
  if (fs.existsSync(keypairPath)) {
    try {
      const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
      return Keypair.fromSecretKey(new Uint8Array(keypairData));
    } catch (error) {
      console.error('Failed to load platform authority from keypair file:', error);
    }
  }

  // Generate new keypair for testing
  console.warn('⚠️  No platform authority keypair found. Generating new one for testing.');
  console.warn('⚠️  This should only be used for development/testing.');
  
  const newKeypair = Keypair.generate();
  
  // Save the keypair for future use
  const keypairData = Array.from(newKeypair.secretKey);
  fs.writeFileSync('./platform-authority.json', JSON.stringify(keypairData));
  
  console.log('📁 New keypair saved to ./platform-authority.json');
  console.log(`🔑 Public Key: ${newKeypair.publicKey.toString()}`);
  
  return newKeypair;
}

// Run the deployment
main().catch(console.error); 