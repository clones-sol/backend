#!/usr/bin/env node

import 'dotenv/config';
import mongoose from 'mongoose';
import { GymAgentModel } from '../models/GymAgent.ts';
import { GymAgentInvocationModel } from '../models/GymAgentInvocation.ts';
import { connectToDatabase } from '../services/database.ts';

const REQUIRED_INDEXES = {
    gym_agents: [
        'pool_id_1',
        'deployment.status_1',
        'name_text_description_text',
        'auditLog.timestamp_-1',
        'blockchain.tokenAddress_1',
        'blockchain.poolAddress_1',
        'deployment.pendingTransaction.idempotencyKey_1',
        'deployment.pendingTransaction.status_1',
        'deployment.activeVersionTag_1',
        'deployment.consecutiveFailures_1',
        'deployment.transitionLock_1', // New distributed lock index
        'createdAt_-1',
        'deployment.status_1_createdAt_-1'
    ],
    gym_agent_invocations: [
        'agentId_1',
        'versionTag_1',
        'timestamp_1',
        'createdAt_1',
        'agentId_1_timestamp_-1',
        'agentId_1_versionTag_1_timestamp_-1',
        'agentId_1_isSuccess_1_timestamp_-1',
        'timestamp_-1_isSuccess_1'
    ]
};

/**
 * Validates that all required database indexes are present
 */
async function validateIndexes(): Promise<void> {
    try {
        console.log('🔍 Validating database indexes...');

        // Connect to MongoDB using the centralized service
        await connectToDatabase();

        // Check GymAgent indexes
        const gymAgentIndexes = await GymAgentModel.collection.listIndexes().toArray();
        const gymAgentIndexNames = gymAgentIndexes.map(idx => idx.name);

        console.log('\n📊 GymAgent Collection Indexes:');
        gymAgentIndexNames.forEach(name => console.log(`  ✓ ${name}`));

        // Check GymAgentInvocation indexes
        const invocationIndexes = await GymAgentInvocationModel.collection.listIndexes().toArray();
        const invocationIndexNames = invocationIndexes.map(idx => idx.name);

        console.log('\n📊 GymAgentInvocation Collection Indexes:');
        invocationIndexNames.forEach(name => console.log(`  ✓ ${name}`));

        // Validate required indexes
        let missingIndexes = 0;

        console.log('\n🔍 Checking required indexes...');

        // Check gym_agents indexes
        for (const requiredIndex of REQUIRED_INDEXES.gym_agents) {
            if (!gymAgentIndexNames.includes(requiredIndex)) {
                console.error(`  ❌ Missing index on gym_agents: ${requiredIndex}`);
                missingIndexes++;
            } else {
                console.log(`  ✅ ${requiredIndex}`);
            }
        }

        // Check gym_agent_invocations indexes
        for (const requiredIndex of REQUIRED_INDEXES.gym_agent_invocations) {
            if (!invocationIndexNames.includes(requiredIndex)) {
                console.error(`  ❌ Missing index on gym_agent_invocations: ${requiredIndex}`);
                missingIndexes++;
            } else {
                console.log(`  ✅ ${requiredIndex}`);
            }
        }

        // Check TTL indexes specifically
        console.log('\n🕐 Checking TTL indexes...');

        const invocationTTLIndex = invocationIndexes.find(idx =>
            idx.name === 'createdAt_1' && idx.expireAfterSeconds !== undefined
        );

        if (!invocationTTLIndex) {
            console.error('  ❌ Missing TTL index on gym_agent_invocations.createdAt');
            missingIndexes++;
        } else {
            console.log(`  ✅ TTL index on gym_agent_invocations.createdAt (expires after ${invocationTTLIndex.expireAfterSeconds}s)`);
        }

        // Check for transition lock cleanup (should have TTL or manual cleanup)
        const transitionLockIndex = gymAgentIndexes.find(idx =>
            idx.name === 'deployment.transitionLock_1'
        );

        if (transitionLockIndex) {
            console.log('  ✅ Transition lock index found - ensure proper cleanup mechanism');
        } else {
            console.warn('  ⚠️ No specific index for transition locks - may impact cleanup performance');
        }

        if (missingIndexes === 0) {
            console.log('\n🎉 All required indexes are present!');
        } else {
            console.error(`\n❌ ${missingIndexes} required indexes are missing!`);
            console.log('\n💡 To create missing indexes, ensure your models are properly defined and restart the application.');
            process.exit(1);
        }

    } catch (error) {
        console.error('❌ Error validating indexes:', error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
    }
}

// Run validation if script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    validateIndexes().catch(console.error);
}

export { validateIndexes }; 