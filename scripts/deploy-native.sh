#!/bin/bash

# Native Solana Deployment Script
# This script builds and deploys the reward pool program without Anchor framework

set -e

# Configuration
CLUSTER=${1:-devnet}
PROGRAM_ID="Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"

echo "🚀 Deploying Reward Pool Program to $CLUSTER"
echo "Program ID: $PROGRAM_ID"

# Set Solana cluster
echo "📡 Setting Solana cluster to $CLUSTER..."
solana config set --url $CLUSTER

# Build the program
echo "🔨 Building program..."
./cargo-build-sbf

# Check if build was successful
if [ ! -f "target/deploy/reward_pool.so" ]; then
    echo "❌ Build failed - reward_pool.so not found"
    exit 1
fi

echo "✅ Build successful"

# Deploy the program
echo "📤 Deploying program..."
solana program deploy target/deploy/reward_pool.so

echo "✅ Deployment completed!"
echo ""
echo "📋 Next steps:"
echo "1. Run the TypeScript deployment script to initialize the reward pool:"
echo "   npm run deploy:reward-pool"
echo ""
echo "2. Or run the native deployment script:"
echo "   tsx scripts/deploy-reward-pool.ts"
echo ""
echo "🎉 Program deployed successfully to $CLUSTER!" 