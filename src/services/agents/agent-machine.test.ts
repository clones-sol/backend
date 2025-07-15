import { describe, it, expect, vi } from 'vitest';
import { createActor } from 'xstate';
import { agentLifecycleMachine, AgentLifecycleContext } from './agent-machine.ts';
import { IGymAgent } from '../../models/GymAgent.ts';

// Mock Mongoose document methods like .toObject()
const createMockAgent = (
    initialStatus: IGymAgent['deployment']['status'],
    blockchainData: Partial<IGymAgent['blockchain']> = {}
): IGymAgent => {
    const agentData = {
        deployment: {
            status: initialStatus,
            versions: [],
            consecutiveFailures: 0,
        },
        blockchain: {
            tokenAddress: blockchainData.tokenAddress,
            tokenCreationDetails: blockchainData.tokenCreationDetails,
            poolAddress: blockchainData.poolAddress,
            poolCreationDetails: blockchainData.poolCreationDetails,
        },
        toObject: () => JSON.parse(JSON.stringify(agentData)),
    };
    return agentData as unknown as IGymAgent;
};

describe('agentLifecycleMachine', () => {

    it('should initialize in the state provided by the agent context', () => {
        const agent = createMockAgent('DRAFT');
        const actor = createActor(agentLifecycleMachine, { input: { agent } }).start();
        expect(actor.getSnapshot().value).toBe('DRAFT');
    });

    // Test valid transitions
    describe('Valid Transitions', () => {
        it('DRAFT -> PENDING_TOKEN_SIGNATURE on INITIATE_DEPLOYMENT', () => {
            const agent = createMockAgent('DRAFT');
            const actor = createActor(agentLifecycleMachine, { input: { agent } });
            actor.start();
            actor.send({ type: 'INITIATE_DEPLOYMENT' });
            expect(actor.getSnapshot().value).toBe('PENDING_TOKEN_SIGNATURE');
        });

        it('PENDING_TOKEN_SIGNATURE -> PENDING_POOL_SIGNATURE on TOKEN_CREATION_SUCCESS and assigns data', () => {
            const agent = createMockAgent('PENDING_TOKEN_SIGNATURE');
            const actor = createActor(agentLifecycleMachine, { snapshot: agentLifecycleMachine.resolveState({ value: 'PENDING_TOKEN_SIGNATURE', context: { agent } }) });
            actor.start();
            const eventData = { tokenAddress: 'abc', txHash: '123', timestamp: 1, slot: 1 };
            actor.send({ type: 'TOKEN_CREATION_SUCCESS', data: eventData });

            const snapshot = actor.getSnapshot();
            expect(snapshot.value).toBe('PENDING_POOL_SIGNATURE');
            expect(snapshot.context.agent.blockchain.tokenAddress).toBe('abc');
            expect(snapshot.context.agent.blockchain.tokenCreationDetails).toEqual({
                txHash: '123',
                timestamp: 1,
                slot: 1,
            });
        });

        it('PENDING_POOL_SIGNATURE -> DEPLOYED on POOL_CREATION_SUCCESS and assigns data', () => {
            const agent = createMockAgent('PENDING_POOL_SIGNATURE');
            const actor = createActor(agentLifecycleMachine, { snapshot: agentLifecycleMachine.resolveState({ value: 'PENDING_POOL_SIGNATURE', context: { agent } }) });
            actor.start();
            const eventData = { poolAddress: 'def', txHash: '456', timestamp: 2, slot: 2 };
            actor.send({ type: 'POOL_CREATION_SUCCESS', data: eventData });

            const snapshot = actor.getSnapshot();
            expect(snapshot.value).toBe('DEPLOYED');
            expect(snapshot.context.agent.blockchain.poolAddress).toBe('def');
            expect(snapshot.context.agent.blockchain.poolCreationDetails).toEqual({
                txHash: '456',
                timestamp: 2,
                slot: 2,
            });
        });

        it('PENDING_TOKEN_SIGNATURE -> DRAFT on CANCEL', () => {
            const agent = createMockAgent('PENDING_TOKEN_SIGNATURE');
            const actor = createActor(agentLifecycleMachine, { snapshot: agentLifecycleMachine.resolveState({ value: 'PENDING_TOKEN_SIGNATURE', context: { agent } }) });
            actor.start();
            actor.send({ type: 'CANCEL' });
            expect(actor.getSnapshot().value).toBe('DRAFT');
        });

        it('DEPLOYED -> DEACTIVATED on DEACTIVATE', () => {
            const agent = createMockAgent('DEPLOYED');
            const actor = createActor(agentLifecycleMachine, { snapshot: agentLifecycleMachine.resolveState({ value: 'DEPLOYED', context: { agent } }) });
            actor.start();
            actor.send({ type: 'DEACTIVATE' });
            expect(actor.getSnapshot().value).toBe('DEACTIVATED');
        });

        it('DEACTIVATED -> ARCHIVED on ARCHIVE', () => {
            const agent = createMockAgent('DEACTIVATED');
            const actor = createActor(agentLifecycleMachine, { snapshot: agentLifecycleMachine.resolveState({ value: 'DEACTIVATED', context: { agent } }) });
            actor.start();
            actor.send({ type: 'ARCHIVE' });
            expect(actor.getSnapshot().value).toBe('ARCHIVED');
        });
    });

    // Test failure and recovery
    describe('Failure and Retry Logic', () => {
        it('should transition to FAILED on FAIL event and assign an error', () => {
            const agent = createMockAgent('PENDING_TOKEN_SIGNATURE');
            const actor = createActor(agentLifecycleMachine, { snapshot: agentLifecycleMachine.resolveState({ value: 'PENDING_TOKEN_SIGNATURE', context: { agent } }) });
            actor.start();
            actor.send({ type: 'FAIL', error: 'Something went wrong' });

            const snapshot = actor.getSnapshot();
            expect(snapshot.value).toBe('FAILED');
            expect(snapshot.context.agent.deployment.lastError).toBe('Something went wrong');
            expect(snapshot.context.agent.deployment.consecutiveFailures).toBe(1);
        });

        it('FAILED -> PENDING_TOKEN_SIGNATURE on RETRY if no token exists', () => {
            const agent = createMockAgent('FAILED'); // No tokenAddress
            const actor = createActor(agentLifecycleMachine, { snapshot: agentLifecycleMachine.resolveState({ value: 'FAILED', context: { agent } }) });
            actor.start();
            actor.send({ type: 'RETRY' });
            expect(actor.getSnapshot().value).toBe('PENDING_TOKEN_SIGNATURE');
        });

        it('FAILED -> PENDING_POOL_SIGNATURE on RETRY if token exists', () => {
            const agent = createMockAgent('FAILED', { tokenAddress: 'some-token-address' });
            const actor = createActor(agentLifecycleMachine, { snapshot: agentLifecycleMachine.resolveState({ value: 'FAILED', context: { agent } }) });
            actor.start();
            actor.send({ type: 'RETRY' });
            expect(actor.getSnapshot().value).toBe('PENDING_POOL_SIGNATURE');
        });

        it('should transition to FAILED on CANCEL from PENDING_POOL_SIGNATURE and assign specific error', () => {
            const agent = createMockAgent('PENDING_POOL_SIGNATURE');
            const actor = createActor(agentLifecycleMachine, { snapshot: agentLifecycleMachine.resolveState({ value: 'PENDING_POOL_SIGNATURE', context: { agent } }) });
            actor.start();
            actor.send({ type: 'CANCEL' });

            const snapshot = actor.getSnapshot();
            expect(snapshot.value).toBe('FAILED');
            expect(snapshot.context.agent.deployment.lastError).toBe('Deployment cancelled by user after token creation.');
        });
    });

    // Test invalid transitions
    describe('Invalid Transitions', () => {
        it('should not transition from DEPLOYED on INITIATE_DEPLOYMENT', () => {
            const agent = createMockAgent('DEPLOYED');
            const actor = createActor(agentLifecycleMachine, { snapshot: agentLifecycleMachine.resolveState({ value: 'DEPLOYED', context: { agent } }) });
            actor.start();
            const canTransition = actor.getSnapshot().can({ type: 'INITIATE_DEPLOYMENT' });
            expect(canTransition).toBe(false);
        });

        it('should not transition from DRAFT on FAIL', () => {
            const agent = createMockAgent('DRAFT');
            const actor = createActor(agentLifecycleMachine, { input: { agent } }).start();
            const canTransition = actor.getSnapshot().can({ type: 'FAIL', error: 'test' });
            expect(canTransition).toBe(false);
        });
    });
}); 