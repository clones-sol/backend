#!/usr/bin/env ts-node

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { RewardPoolService } from '../src/services/blockchain/rewardPool';
import * as fs from 'fs';

// Configuration
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = process.env.REWARD_POOL_PROGRAM_ID || 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';
const PLATFORM_TREASURY_ADDRESS = process.env.PLATFORM_TREASURY_ADDRESS;

// Test configuration
const TEST_CONFIG = {
  CLONES_MINT: 'CHmNzad5nJYR9N63SiHjsRz9mZa4iqdH9PjVu2wxHJ3T',
  TEST_FARMER_ADDRESS: 'Gv4X6uNVMouwtYCZ1SW9GpBjmMUNGvEd8gRZkTFpLEqf',
  TEST_TASK_ID: 'test-task-001',
  TEST_POOL_ID: 'test-pool-001',
  TEST_REWARD_AMOUNT: 100000 // 0.1 CLONES
};

async function testRewardPool() {
  console.log('🧪 Testing Reward Pool Smart Contract...');
  console.log(`Network: ${RPC_URL}`);
  console.log(`Program ID: ${PROGRAM_ID}`);

  const connection = new Connection(RPC_URL, 'confirmed');
  const platformAuthorityKeypair = loadPlatformAuthorityKeypair();
  
  console.log(`🔑 Platform Authority: ${platformAuthorityKeypair.publicKey.toString()}`);
  
  const service = new RewardPoolService(
    connection,
    PROGRAM_ID,
    platformAuthorityKeypair,
    PLATFORM_TREASURY_ADDRESS
  );

  try {
    // Test 1: Check platform stats
    console.log('\n🧪 Test 1: Check Platform Stats');
    const stats = await service.getPlatformStats();
    console.log(`✅ Platform stats:`, stats);

    // Test 2: Check farmer account
    console.log('\n🧪 Test 2: Check Farmer Account');
    const farmerAccount = await service.getFarmerAccount(TEST_CONFIG.TEST_FARMER_ADDRESS);
    console.log(`✅ Farmer account:`, farmerAccount);

    // Test 3: Record a task completion
    console.log('\n🧪 Test 3: Record Task Completion');
    const result = await service.recordTaskCompletion(
      TEST_CONFIG.TEST_TASK_ID,
      TEST_CONFIG.TEST_FARMER_ADDRESS,
      TEST_CONFIG.TEST_POOL_ID,
      TEST_CONFIG.TEST_REWARD_AMOUNT,
      TEST_CONFIG.CLONES_MINT
    );
    console.log(`✅ Task recorded:`, result);

    // Test 4: Check pending rewards
    console.log('\n🧪 Test 4: Check Pending Rewards');
    const pendingRewards = await service.getPendingRewards(TEST_CONFIG.TEST_FARMER_ADDRESS);
    console.log(`✅ Pending rewards:`, pendingRewards);

    console.log('\n🎉 Testing Complete!');

  } catch (error) {
    console.error('❌ Testing failed:', error);
  }
}

function loadPlatformAuthorityKeypair(): Keypair {
  const keypairPath = 'C:\\Users\\1\\.config\\solana\\id.json';
  if (fs.existsSync(keypairPath)) {
    try {
      const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
      return Keypair.fromSecretKey(new Uint8Array(keypairData));
    } catch (error) {
      console.error('Failed to load keypair:', error);
    }
  }
  
  console.warn('⚠️  Generating new keypair for testing.');
  return Keypair.generate();
}

testRewardPool().catch(console.error); 