import { setup, assign } from 'xstate';
import { IGymAgent } from '../../models/GymAgent.ts';

// Define all possible events and their potential payloads.
export type AgentLifecycleEvents =
    | { type: 'INITIATE_DEPLOYMENT' }
    | { type: 'TOKEN_CREATION_SUCCESS'; data: { tokenAddress: string; txHash: string; timestamp: number; slot: number } }
    | { type: 'INITIATE_POOL_CREATION' }
    | { type: 'POOL_CREATION_SUCCESS'; data: { poolAddress: string; txHash: string; timestamp: number; slot: number } }
    | { type: 'FAIL'; error: string }
    | { type: 'RETRY' }
    | { type: 'CANCEL' }
    | { type: 'DEACTIVATE' }
    | { type: 'ARCHIVE' };

// Define the machine's context, which holds the state of the agent.
export type AgentLifecycleContext = {
    agent: IGymAgent;
};

/**
 * Defines the state machine for the GymAgent deployment lifecycle using XState v5 `setup`.
 * This machine ensures that status transitions are valid, predictable, and strongly typed.
 */
export const agentLifecycleMachine = setup({
    types: {
        context: {} as AgentLifecycleContext,
        events: {} as AgentLifecycleEvents,
    },
    actions: {
        // Action to assign an error message to the context
        assignError: assign({
            agent: ({ context, event }) => {
                if (event.type === 'FAIL') {
                    context.agent.deployment.lastError = event.error;
                    context.agent.deployment.consecutiveFailures = (context.agent.deployment.consecutiveFailures || 0) + 1;
                }
                return context.agent;
            },
        }),
        // Action to assign a specific cancellation error when a deployment is cancelled post-token creation.
        assignCancellationError: assign({
            agent: ({ context }) => {
                context.agent.deployment.lastError = 'Deployment cancelled by user after token creation.';
                return context.agent;
            }
        })
    },
    guards: {
        // Guard to check if a token has been created
        hasToken: ({ context }) => !!context.agent.blockchain.tokenAddress,
        // Guard to check if a token has not yet been created
        hasNoToken: ({ context }) => !context.agent.blockchain.tokenAddress,
    },
}).createMachine({
    id: 'agentLifecycle',
    // The initial state is determined by the agent's status when the machine is started.
    initial: 'DRAFT',
    context: ({ input }) => ({
        agent: (input as AgentLifecycleContext).agent,
    }),
    states: {
        DRAFT: {
            on: {
                INITIATE_DEPLOYMENT: { target: 'PENDING_TOKEN_SIGNATURE' },
                ARCHIVE: { target: 'ARCHIVED' },
            },
        },
        PENDING_TOKEN_SIGNATURE: {
            on: {
                TOKEN_CREATION_SUCCESS: { target: 'TOKEN_CREATED' },
                FAIL: { target: 'FAILED', actions: 'assignError' },
                CANCEL: { target: 'DRAFT' },
            },
        },
        TOKEN_CREATED: {
            on: {
                INITIATE_POOL_CREATION: { target: 'PENDING_POOL_SIGNATURE' },
                CANCEL: { target: 'FAILED', actions: 'assignCancellationError' },
            },
        },
        PENDING_POOL_SIGNATURE: {
            on: {
                POOL_CREATION_SUCCESS: { target: 'DEPLOYED' },
                FAIL: { target: 'FAILED', actions: 'assignError' },
                CANCEL: { target: 'FAILED', actions: 'assignCancellationError' },
            },
        },
        DEPLOYED: {
            on: {
                DEACTIVATE: { target: 'DEACTIVATED' },
            },
        },
        DEACTIVATED: {
            on: {
                ARCHIVE: { target: 'ARCHIVED' },
            },
        },
        FAILED: {
            on: {
                RETRY: [
                    { target: 'PENDING_TOKEN_SIGNATURE', guard: 'hasNoToken' },
                    { target: 'PENDING_POOL_SIGNATURE', guard: 'hasToken' },
                ],
                ARCHIVE: { target: 'ARCHIVED' },
            },
        },
        ARCHIVED: {
            type: 'final',
        },
    },
}); 