import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { TrainingPoolModel } from '../models/TrainingPool.ts';
import { encrypt } from '../services/security/crypto.ts';

// Load environment variables from .env file
dotenv.config();

const migrateKeys = async () => {
    if (!process.env.DB_URI) {
        console.error('DB_URI environment variable not set. Aborting.');
        process.exit(1);
    }

    try {
        console.log('Connecting to database...');
        await mongoose.connect(process.env.DB_URI, {
            dbName: process.env.DB_NAME,
            user: process.env.DB_USER,
            pass: process.env.DB_PASSWORD
        });
        console.log('Database connected successfully.');

        const pools = await TrainingPoolModel.find({});
        console.log(`Found ${pools.length} pools to process.`);

        let migratedCount = 0;
        let skippedCount = 0;

        for (const pool of pools) {
            if (pool.depositPrivateKey && !pool.depositPrivateKey.startsWith('v1:')) {
                console.log(`Migrating key for pool: ${pool.name} (${pool._id})`);
                pool.depositPrivateKey = encrypt(pool.depositPrivateKey);
                await pool.save();
                migratedCount++;
            } else {
                console.log(`Skipping already migrated or empty key for pool: ${pool.name} (${pool._id})`);
                skippedCount++;
            }
        }

        console.log('\n--- Migration Summary ---');
        console.log(`✅ Successfully migrated ${migratedCount} private keys.`);
        console.log(`☑️  Skipped ${skippedCount} pools (already migrated or no key).`);
        console.log('-------------------------\n');

    } catch (error) {
        console.error('An error occurred during migration:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Database connection closed.');
    }
};

migrateKeys(); 