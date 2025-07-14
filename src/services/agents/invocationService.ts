import axios from 'axios';
import { IGymAgent } from '../../models/GymAgent.ts';
import { GymAgentInvocationModel, GymAgentModel } from '../../models/Models.ts';
import { decrypt } from '../security/crypto.ts';
import { transitionAgentStatus } from './index.ts';

const FAILURE_THRESHOLD = 5;

/**
 * Invokes an AI agent by calling its external endpoint and records the interaction.
 * It also handles the logic for consecutive failures and automatic deactivation.
 *
 * @param agent - The agent to invoke.
 * @param payload - The data to send to the agent's endpoint.
 * @returns The response from the agent's external endpoint.
 */
export const invokeAgent = async (agent: IGymAgent, payload: any): Promise<any> => {
    const activeVersion = agent.deployment.versions.find(v => v.versionTag === agent.deployment.activeVersionTag);

    if (!activeVersion || !activeVersion.customUrl) {
        throw new Error(`Agent ${agent._id} has no active and configured version to invoke.`);
    }

    const apiKey = activeVersion.encryptedApiKey ? decrypt(activeVersion.encryptedApiKey) : undefined;

    const invocation = new GymAgentInvocationModel({
        agentId: agent._id,
        versionTag: activeVersion.versionTag,
        timestamp: new Date(),
        // Duration and success will be set after the call
    });

    const startTime = Date.now();

    try {
        const headers: { 'Content-Type': string; Authorization?: string } = {
            'Content-Type': 'application/json',
        };

        if (apiKey) {
            headers.Authorization = `Bearer ${apiKey}`;
        }

        const response = await axios.post(activeVersion.customUrl, payload, {
            headers,
            timeout: 30000, // 30-second timeout
        });

        // Record successful invocation
        invocation.durationMs = Date.now() - startTime;
        invocation.isSuccess = true;
        invocation.httpStatus = response.status;
        await invocation.save();

        // Reset consecutive failures on success
        if (agent.deployment.consecutiveFailures && agent.deployment.consecutiveFailures > 0) {
            agent.deployment.consecutiveFailures = 0;
            await agent.save();
        }

        return response.data;

    } catch (error) {
        const durationMs = Date.now() - startTime;
        let httpStatus: number | undefined;

        if (axios.isAxiosError(error)) {
            httpStatus = error.response?.status;
        }

        // Record failed invocation
        invocation.durationMs = durationMs;
        invocation.isSuccess = false;
        invocation.httpStatus = httpStatus;
        await invocation.save();

        // Handle failure logic
        agent.deployment.consecutiveFailures = (agent.deployment.consecutiveFailures || 0) + 1;

        if (agent.deployment.consecutiveFailures >= FAILURE_THRESHOLD) {
            agent.deployment.lastError = `Agent auto-disabled after ${FAILURE_THRESHOLD} consecutive failures.`;
            await transitionAgentStatus(agent, { type: 'DEACTIVATE' });
            // Reset counter after deactivation
            agent.deployment.consecutiveFailures = 0;
        }

        await agent.save();

        // Re-throw the error to be handled by the caller
        throw error;
    }
}; 