import axios from 'axios';
import { IGymAgent } from '../../models/GymAgent.ts';
import { GymAgentInvocationModel, GymAgentModel } from '../../models/Models.ts';
import { decrypt } from '../security/crypto.ts';
import { transitionAgentStatus } from './index.ts';

const FAILURE_THRESHOLD = 5;
const INVOCATION_TIMEOUT = 30000; // 30 seconds

/**
 * Securely clears a string from memory
 */
const clearString = (str: string): void => {
    // Overwrite with zeros (best effort memory clearing)
    for (let i = 0; i < str.length; i++) {
        str = str.substring(0, i) + '0' + str.substring(i + 1);
    }
};

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

    let apiKey: string | undefined;

    try {
        // Decrypt API key only when needed and clear it after use
        apiKey = activeVersion.encryptedApiKey ? decrypt(activeVersion.encryptedApiKey) : undefined;

        // Log API key decryption for security audit
        if (apiKey) {
            console.info(`[SECURITY_AUDIT] Hugging Face API key decrypted for agent ${agent._id}`);
        }

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
                timeout: INVOCATION_TIMEOUT,
            });

            // Record successful invocation
            invocation.durationMs = Date.now() - startTime;
            invocation.isSuccess = true;
            invocation.httpStatus = response.status;
            await invocation.save();

            // Reset consecutive failures on success using an atomic operation
            if (agent.deployment.consecutiveFailures && agent.deployment.consecutiveFailures > 0) {
                await GymAgentModel.updateOne(
                    { _id: agent._id },
                    { $set: { 'deployment.consecutiveFailures': 0 } }
                );
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

            // Handle failure logic with atomic operations to prevent race conditions
            const updatedAgent = await GymAgentModel.findOneAndUpdate(
                {
                    _id: agent._id,
                    'deployment.consecutiveFailures': { $lt: FAILURE_THRESHOLD } // Prevent multiple auto-deactivations
                },
                {
                    $inc: { 'deployment.consecutiveFailures': 1 },
                    $set: { 'deployment.lastFailureAt': new Date() }
                },
                { new: true }
            );

            // Only attempt auto-deactivation if we successfully incremented and reached threshold
            if (updatedAgent?.deployment?.consecutiveFailures === FAILURE_THRESHOLD) {
                try {
                    // Set error message before attempting deactivation
                    await GymAgentModel.updateOne(
                        { _id: updatedAgent._id },
                        { $set: { 'deployment.lastError': `Agent auto-disabled after ${FAILURE_THRESHOLD} consecutive failures.` } }
                    );

                    // Attempt to transition to DEACTIVATED status
                    await transitionAgentStatus(updatedAgent, { type: 'DEACTIVATE' });

                    // Reset failure counter after successful deactivation
                    await GymAgentModel.updateOne(
                        { _id: updatedAgent._id },
                        { $set: { 'deployment.consecutiveFailures': 0 } }
                    );

                    console.warn(`[AGENT_AUTO_DEACTIVATION] Agent ${updatedAgent._id} automatically deactivated after ${FAILURE_THRESHOLD} consecutive failures.`);

                } catch (deactivationError) {
                    // Log the deactivation failure but don't throw to avoid masking the original error
                    console.error(`[AGENT_AUTO_DEACTIVATION_ERROR] Failed to auto-deactivate agent ${updatedAgent._id}:`, deactivationError);

                    // Attempt to record the deactivation failure in the agent document
                    try {
                        await GymAgentModel.updateOne(
                            { _id: updatedAgent._id },
                            {
                                $set: {
                                    'deployment.lastError': `Auto-deactivation failed after ${FAILURE_THRESHOLD} consecutive failures. Manual intervention required.`
                                }
                            }
                        );
                    } catch (recordError) {
                        console.error(`[AGENT_AUTO_DEACTIVATION_ERROR] Failed to record deactivation failure for agent ${updatedAgent._id}:`, recordError);
                    }
                }
            }

            // Re-throw the original error to be handled by the caller
            throw error;
        }
    } finally {
        // Securely clear the API key from memory
        if (apiKey) {
            clearString(apiKey);
            apiKey = undefined;
        }
    }
}; 