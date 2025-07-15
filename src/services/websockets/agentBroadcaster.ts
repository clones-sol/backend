import { IGymAgent } from '../../models/GymAgent.ts';
import { broadcastToTopic } from './socketManager.ts';

/**
 * Broadcasts an agent's status update to all subscribed clients.
 * The topic used is the agent's ID.
 *
 * @param agent The updated agent document.
 */
export const broadcastAgentUpdate = (agent: IGymAgent) => {
    const agentId = (agent._id as any).toString();
    const payload = {
        agentId: agentId,
        status: agent.deployment.status,
        details: {
            lastError: agent.deployment.lastError,
            tokenAddress: agent.blockchain.tokenAddress,
            tokenCreationDetails: agent.blockchain.tokenCreationDetails,
            poolAddress: agent.blockchain.poolAddress,
            poolCreationDetails: agent.blockchain.poolCreationDetails,
        }
    };
    broadcastToTopic(agentId, { event: 'agentStatusUpdate', data: payload });
};

/**
 * Broadcasts a transaction submission event.
 *
 * @param agentId The ID of the agent.
 * @param status The status of the agent when the transaction was submitted.
 * @param txHash The transaction hash.
 */
export const broadcastTxSubmitted = (agentId: string, status: string, txHash: string) => {
    const payload = { agentId, status, txHash };
    broadcastToTopic(agentId, { event: 'txSubmitted', data: payload });
}; 