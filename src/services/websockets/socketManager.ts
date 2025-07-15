import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { randomUUID } from 'crypto';
import { GymAgentModel, TrainingPoolModel } from '../../models/Models.ts';
import { URL } from 'url';
import { redisSubscriber, redisPublisher } from '../redis.ts';

const getWalletAddressFromRequest = (request: http.IncomingMessage): string | null => {
    const url = new URL(request.url || '', `ws://${request.headers.host}`);
    return url.searchParams.get('token');
};

// Map<clientId, Set<topic>> - Tracks which topics a specific client on THIS instance is subscribed to.
const clientTopics = new Map<string, Set<string>>();
// Map<topic, Set<WebSocket>> - Tracks which WebSocket clients on THIS instance are subscribed to a topic.
const localSubscribers = new Map<string, Set<WebSocket>>();
// Map<WebSocket, string> - Stores the wallet address for an authenticated client on THIS instance.
const authenticatedClients = new Map<WebSocket, string>();


export const initializeWebSocketServer = (server: http.Server) => {
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
        const walletAddress = getWalletAddressFromRequest(request);
        if (!walletAddress) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
            authenticatedClients.set(ws, walletAddress);
            wss.emit('connection', ws, request);
        });
    });

    // Redis subscriber listens for messages on all subscribed channels
    redisSubscriber.on('message', (channel: string, message: string) => {
        // When a message is received from Redis, broadcast it to all local clients subscribed to that channel (topic).
        if (localSubscribers.has(channel)) {
            for (const client of localSubscribers.get(channel)!) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(message);
                }
            }
        }
    });

    wss.on('connection', (ws: WebSocket) => {
        const clientId = randomUUID();

        ws.on('message', async (message) => {
            const walletAddress = authenticatedClients.get(ws);
            if (!walletAddress) {
                // Should not happen due to upgrade logic, but as a safeguard.
                ws.close();
                return;
            }

            try {
                const data = JSON.parse(message.toString());

                if (data.type === 'subscribe' && data.topic) {
                    const topic = data.topic;

                    const agent = await GymAgentModel.findById(topic).select('pool_id').lean();
                    if (!agent) return ws.send(JSON.stringify({ error: `Agent ${topic} not found.` }));
                    const pool = await TrainingPoolModel.findById(agent.pool_id).select('ownerAddress').lean();
                    if (pool?.ownerAddress !== walletAddress) return ws.send(JSON.stringify({ error: 'Forbidden' }));

                    // Subscribe the client to the topic locally
                    if (!localSubscribers.has(topic)) localSubscribers.set(topic, new Set());
                    localSubscribers.get(topic)!.add(ws);

                    if (!clientTopics.has(clientId)) clientTopics.set(clientId, new Set());
                    clientTopics.get(clientId)!.add(topic);

                    // If this is the first local subscriber for this topic, subscribe the instance to the Redis channel.
                    if (localSubscribers.get(topic)!.size === 1) {
                        redisSubscriber.subscribe(topic);
                        console.log(`[Redis] Instance subscribed to topic: ${topic}`);
                    }

                    ws.send(JSON.stringify({ success: true, message: `Subscribed to ${topic}` }));

                } else if (data.type === 'unsubscribe' && data.topic) {
                    const topic = data.topic;
                    if (localSubscribers.has(topic)) {
                        localSubscribers.get(topic)!.delete(ws);
                        // If this was the last local subscriber for this topic, unsubscribe the instance from Redis.
                        if (localSubscribers.get(topic)!.size === 0) {
                            localSubscribers.delete(topic);
                            redisSubscriber.unsubscribe(topic);
                            console.log(`[Redis] Instance unsubscribed from topic: ${topic}`);
                        }
                    }
                    if (clientTopics.has(clientId)) {
                        clientTopics.get(clientId)!.delete(topic);
                    }
                }
            } catch (error) {
                console.error('Failed to process WebSocket message:', error);
            }
        });

        ws.on('close', () => {
            if (clientTopics.has(clientId)) {
                for (const topic of clientTopics.get(clientId)!) {
                    if (localSubscribers.has(topic)) {
                        const topicSubscribers = localSubscribers.get(topic)!;
                        topicSubscribers.delete(ws);
                        if (topicSubscribers.size === 0) {
                            localSubscribers.delete(topic);
                            redisSubscriber.unsubscribe(topic);
                            console.log(`[Redis] Instance unsubscribed from topic: ${topic}`);
                        }
                    }
                }
                clientTopics.delete(clientId);
            }
            authenticatedClients.delete(ws);
        });
    });

    console.log('🚀 WebSocket server initialized for multi-instance environment.');
};

/**
 * Broadcasts a message by publishing it to a Redis channel.
 *
 * @param topic The topic to publish to (e.g., an agent's ID).
 * @param message The JSON-serializable message payload to send.
 */
export const broadcastToTopic = (topic: string, message: object) => {
    const serializedMessage = JSON.stringify(message);
    console.log(`[Redis] Publishing to topic ${topic}: ${serializedMessage}`);
    redisPublisher.publish(topic, serializedMessage);
}; 