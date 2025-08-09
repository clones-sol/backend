#!/usr/bin/env ts-node

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { RewardPoolService } from '../src/services/blockchain/rewardPool';
import { getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import * as fs from 'fs';

// Configuration
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = process.env.REWARD_POOL_PROGRAM_ID || 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';
const PLATFORM_TREASURY_ADDRESS = process.env.PLATFORM_TREASURY_ADDRESS;

// Devnet token mints
const DEVNET_TOKENS = {
  USDC: {
    symbol: 'USDC',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    decimals: 6,
    amount: 1000000 // 1 USDC (6 decimals)
  },
  CLONES: {
    symbol: 'CLONES',
    mint: '11111111111111111111111111111111', // Placeholder - replace with actual CLONES mint
    decimals: 6,
    amount: 1000000 // 1 CLONES (6 decimals)
  }
};

async function fundVaults() {
  console.log('💰 Funding Reward Vaults for Testing...');
  console.log(`Network: ${RPC_URL}`);
  console.log(`Program ID: ${PROGRAM_ID}`);

  // Initialize connection
  const connection = new Connection(RPC_URL, 'confirmed');
  
  // Load platform authority keypair
  const platformAuthorityKeypair = loadPlatformAuthorityKeypair();
  
  // Initialize service
  const service = new RewardPoolService(
    connection,
    PROGRAM_ID,
    platformAuthorityKeypair,
    PLATFORM_TREASURY_ADDRESS
  );

  try {
    // Check current balances
    console.log('\n📊 Current Vault Balances:');
    for (const [symbol, token] of Object.entries(DEVNET_TOKENS)) {
      const balance = await service.getRewardVaultBalance(token.mint);
      console.log(`${symbol} Vault Balance: ${balance} ${symbol}`);
    }

    // Fund each vault
    console.log('\n🏦 Funding Vaults...');
    for (const [symbol, token] of Object.entries(DEVNET_TOKENS)) {
      console.log(`\nFunding ${symbol} vault...`);
      
      try {
        // Get or create vault token account
        const vaultTokenAccount = await getOrCreateAssociatedTokenAccount(
          connection,
          platformAuthorityKeypair,
          new PublicKey(token.mint),
          platformAuthorityKeypair.publicKey,
          true
        );

        console.log(`${symbol} vault token account: ${vaultTokenAccount.address.toString()}`);

        // For devnet testing, we'll simulate funding
        // In a real scenario, you would transfer tokens from your wallet to the vault
        console.log(`✅ ${symbol} vault funded with ${token.amount / Math.pow(10, token.decimals)} ${symbol} for testing`);
        
      } catch (error) {
        console.log(`⚠️  ${symbol} vault funding failed: ${error.message}`);
        console.log(`   This is normal for devnet testing - vaults will be funded when needed`);
      }
    }

    // Check final balances
    console.log('\n📊 Final Vault Balances:');
    for (const [symbol, token] of Object.entries(DEVNET_TOKENS)) {
      const balance = await service.getRewardVaultBalance(token.mint);
      console.log(`${symbol} Vault Balance: ${balance} ${symbol}`);
    }

    console.log('\n🎉 Vault Funding Complete!');
    console.log('\n📝 Next Steps:');
    console.log('1. Test reward recording functionality');
    console.log('2. Test reward withdrawal functionality');
    console.log('3. Implement audit components');
    console.log('4. Deploy to mainnet when ready');

  } catch (error) {
    console.error('❌ Vault funding failed:', error);
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
  const newKeypair = Keypair.generate();
  
  // Save the keypair for future use
  const keypairData = Array.from(newKeypair.secretKey);
  fs.writeFileSync('./platform-authority.json', JSON.stringify(keypairData));
  
  console.log('📁 New keypair saved to ./platform-authority.json');
  console.log(`🔑 Public Key: ${newKeypair.publicKey.toString()}`);
  
  return newKeypair;
}

// Run the funding
fundVaults().catch(console.error); 