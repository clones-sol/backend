import { createActor } from 'xstate';
import { agentLifecycleMachine } from './agent-machine.ts';
import type { AgentLifecycleEvents } from './agent-machine.ts';
import { IGymAgent } from '../../models/GymAgent.ts';

/**
 * Transitions an agent's status using the state machine.
 * This function ensures that all status changes are valid according to the defined lifecycle.
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
    // Create a state object representing the agent's current state.
    // This resolves the machine to the state value and context without executing actions.
    const resolvedState = agentLifecycleMachine.resolveState({
        value: agent.deployment.status,
        context: { agent },
    });

    // Create an actor and restore it from the resolved state snapshot.
    const actor = createActor(agentLifecycleMachine, {
        snapshot: resolvedState,
    }).start();

    const currentStateSnapshot = actor.getSnapshot();

    // Check if the transition is valid from the current state.
    if (!currentStateSnapshot.can(event)) {
        throw new Error(
            `Invalid transition: Cannot move from status '${String(currentStateSnapshot.value)}' on event '${event.type}'`
        );
    }

    // Send the event to trigger the transition.
    actor.send(event);

    const nextStateSnapshot = actor.getSnapshot();
    const finalAgentFromContext = nextStateSnapshot.context.agent;
    const newStatus = nextStateSnapshot.value as IGymAgent['deployment']['status'];

    // Apply all changes from the machine's context back to the original Mongoose document.
    // Using `.set()` handles Mongoose's change tracking.
    agent.set(finalAgentFromContext);
    agent.deployment.status = newStatus;

    agent.auditLog.push({
        timestamp: new Date(),
        user: 'SYSTEM', // In a real scenario, this might come from the user session.
        action: 'STATUS_TRANSITION',
        details: {
            from: String(currentStateSnapshot.value),
            to: newStatus,
            event: event.type
        } as any
    });

    await agent.save();

    // Stop the actor after use as it's single-use in this function.
    actor.stop();

    return agent;
}; 