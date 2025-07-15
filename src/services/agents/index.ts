import { createActor } from 'xstate';
import { agentLifecycleMachine } from './agent-machine.ts';
import type { AgentLifecycleEvents } from './agent-machine.ts';
import { IGymAgent } from '../../models/GymAgent.ts';
import { GymAgentModel } from '../../models/Models.ts';
import { sanitizeEventForLogging } from '../../api/forge/agents/helpers.ts';

/**
 * Transitions an agent's status using the state machine.
 * This function ensures that all status changes are valid according to the defined lifecycle.
 * Uses atomic MongoDB operations with distributed locking to prevent race conditions.
 *
 * @param agent The Mongoose document of the agent to transition.
 * @param event The event to send to the state machine (e.g., { type: 'INITIATE_DEPLOYMENT' }).
 * @returns The updated agent document after a successful transition.
 * @throws An error if the transition is invalid.
 */
export const transitionAgentStatus = async (
    agent: IGymAgent,
    event: AgentLifecycleEvents
): Promise<IGymAgent> => {
    const agentId = agent._id;
    const currentStatus = agent.deployment.status;
    const lockKey = `agent_transition_${agentId}`;
    const lockTimeout = 30000; // 30 seconds
    const lockExpiry = new Date(Date.now() + lockTimeout);

    try {
        // Acquire distributed lock to prevent concurrent transitions
        const lockAcquired = await GymAgentModel.findOneAndUpdate(
            {
                _id: agentId,
                $or: [
                    { 'deployment.transitionLock': { $exists: false } },
                    { 'deployment.transitionLock': { $lt: new Date() } }
                ]
            },
            {
                $set: {
                    'deployment.transitionLock': lockExpiry,
                    'deployment.transitionLockBy': process.pid.toString()
                }
            },
            { new: true }
        );

        if (!lockAcquired) {
            throw new Error(`Agent ${agentId} is currently being processed by another operation. Please try again later.`);
        }

        // Refresh agent data to ensure we have the latest state
        const freshAgent = await GymAgentModel.findById(agentId);
        if (!freshAgent) {
            throw new Error(`Agent ${agentId} not found`);
        }

        // Create a state object representing the agent's current state.
        const resolvedState = agentLifecycleMachine.resolveState({
            value: freshAgent.deployment.status,
            context: { agent: freshAgent },
        });

        // Create an actor and restore it from the resolved state snapshot.
        const actor = createActor(agentLifecycleMachine, {
            snapshot: resolvedState,
        }).start();

        const currentStateSnapshot = actor.getSnapshot();

        // Check if the transition is valid from the current state.
        if (!currentStateSnapshot.can(event)) {
            const errorMessage = `Invalid transition: Cannot move from status '${String(currentStateSnapshot.value)}' on event '${event.type}'`;
            console.error(`[AGENT_TRANSITION_ERROR] ${errorMessage}`, {
                agentId,
                currentStatus: freshAgent.deployment.status,
                event: sanitizeEventForLogging(event)
            });
            throw new Error(errorMessage);
        }

        // Send the event to trigger the transition.
        actor.send(event);

        const nextStateSnapshot = actor.getSnapshot();
        const finalAgentFromContext = nextStateSnapshot.context.agent;
        const newStatus = nextStateSnapshot.value as IGymAgent['deployment']['status'];

        // Build atomic update payload
        const updatePayload: { $set: any, $push: any, $unset: any } = {
            $set: {
                'deployment.status': newStatus,
            },
            $push: {
                auditLog: {
                    timestamp: new Date(),
                    user: 'SYSTEM',
                    action: 'STATUS_TRANSITION',
                    details: {
                        from: String(currentStateSnapshot.value),
                        to: newStatus,
                        event: event.type
                    }
                }
            },
            $unset: {
                'deployment.transitionLock': '',
                'deployment.transitionLockBy': ''
            }
        };

        // Apply context changes atomically
        const contextChanges = finalAgentFromContext.toObject ? finalAgentFromContext.toObject() : finalAgentFromContext;

        // Update deployment fields from context
        if (contextChanges.deployment) {
            if (contextChanges.deployment.lastError !== undefined) {
                updatePayload.$set['deployment.lastError'] = contextChanges.deployment.lastError;
            }
            if (contextChanges.deployment.consecutiveFailures !== undefined) {
                updatePayload.$set['deployment.consecutiveFailures'] = contextChanges.deployment.consecutiveFailures;
            }
        }

        // Update blockchain fields from context
        if (contextChanges.blockchain) {
            if (contextChanges.blockchain.tokenAddress) {
                updatePayload.$set['blockchain.tokenAddress'] = contextChanges.blockchain.tokenAddress;
            }
            if (contextChanges.blockchain.tokenCreationDetails) {
                updatePayload.$set['blockchain.tokenCreationDetails'] = contextChanges.blockchain.tokenCreationDetails;
            }
            if (contextChanges.blockchain.poolAddress) {
                updatePayload.$set['blockchain.poolAddress'] = contextChanges.blockchain.poolAddress;
            }
            if (contextChanges.blockchain.poolCreationDetails) {
                updatePayload.$set['blockchain.poolCreationDetails'] = contextChanges.blockchain.poolCreationDetails;
            }
        }

        // Perform atomic update with version check and lock release
        const updatedAgent = await GymAgentModel.findOneAndUpdate(
            {
                _id: agentId,
                'deployment.status': freshAgent.deployment.status,
                'deployment.transitionLock': lockExpiry,
                'deployment.transitionLockBy': process.pid.toString()
            },
            updatePayload,
            { new: true }
        );

        if (!updatedAgent) {
            const errorMessage = `Failed to update agent status: Agent may have been modified by another process, lock expired, or not found`;
            console.error(`[AGENT_UPDATE_ERROR] ${errorMessage}`, {
                agentId,
                currentStatus: freshAgent.deployment.status,
                targetStatus: newStatus,
                event: sanitizeEventForLogging(event)
            });
            throw new Error(errorMessage);
        }

        // Stop the actor after use
        actor.stop();

        console.info(`[AGENT_TRANSITION_SUCCESS] Agent ${agentId} transitioned from ${freshAgent.deployment.status} to ${newStatus}`, {
            agentId,
            event: event.type,
            from: freshAgent.deployment.status,
            to: newStatus
        });

        return updatedAgent;
    } catch (error) {
        // Release lock in case of error
        await GymAgentModel.updateOne(
            { _id: agentId, 'deployment.transitionLock': lockExpiry },
            {
                $unset: {
                    'deployment.transitionLock': '',
                    'deployment.transitionLockBy': ''
                }
            }
        ).catch(releaseError => {
            console.error(`[AGENT_LOCK_RELEASE_ERROR] Failed to release lock for agent ${agentId}:`, releaseError);
        });

        console.error(`[AGENT_TRANSITION_FATAL] Fatal error during agent status transition`, {
            agentId,
            currentStatus,
            event: sanitizeEventForLogging(event),
            error: error instanceof Error ? error.message : String(error)
        });
        throw error;
    }
}; 