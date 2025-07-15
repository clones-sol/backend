import 'dotenv/config';
const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// It is recommended to use two separate connections for publishing and subscribing.
// The subscriber connection can only perform subscription-related commands.
export const redisPublisher = new Redis(redisUrl, { maxRetriesPerRequest: null });
export const redisSubscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });

redisPublisher.on('connect', () => {
    console.log('[Redis] Publisher connected.');
});

redisSubscriber.on('connect', () => {
    console.log('[Redis] Subscriber connected.');
});

redisPublisher.on('error', (err: Error) => {
    console.error('[Redis] Publisher connection error:', err);
});

redisSubscriber.on('error', (err: Error) => {
    console.error('[Redis] Subscriber connection error:', err);
}); 