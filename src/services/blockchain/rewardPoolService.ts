import { ethers } from 'ethers';
import { ethAddressSentinel } from './tokens.ts';

const REWARD_POOL_ABI = [
    'function recordReward(address farmer, address token, uint256 amount, bytes32 taskId)',
    'function refundFactory(address token, uint256 amount)',
    'function refundFactoryNative(uint256 amount)'
];

class RewardPoolService {
    provider: ethers.JsonRpcProvider;
    rewardPoolAddress: string;

    constructor(rpcUrl: string, rewardPoolAddress: string) {
        if (!rewardPoolAddress) {
            throw new Error('RewardPool contract address is not configured.');
        }
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        this.rewardPoolAddress = rewardPoolAddress;
    }

    /**
     * Records a reward on the RewardPool smart contract.
     * @param farmer The address of the user receiving the reward.
     * @param tokenAddress The address of the ERC-20 token for the reward.
     * @param amount The reward amount in human-readable units (e.g., 1.5 for 1.5 USDC).
     * @param taskId A unique identifier for the task to prevent duplicate rewards.
     * @param factoryPk The private key of the factory wallet that has the FACTORY_ROLE.
     * @returns The transaction hash if successful, otherwise false.
     */
    async recordReward(
        farmer: string,
        tokenAddress: string,
        amount: number,
        taskId: string,
        factoryPk: string
    ): Promise<{ txHash: string } | false> {
        try {
            const factoryWallet = new ethers.Wallet(factoryPk, this.provider);
            const rewardPoolContract = new ethers.Contract(
                this.rewardPoolAddress,
                REWARD_POOL_ABI,
                factoryWallet
            );

            let decimals;
            if (tokenAddress === ethAddressSentinel) {
                decimals = 18; // Native ETH always has 18 decimals
            } else {
                const tokenContract = new ethers.Contract(
                    tokenAddress,
                    ['function decimals() view returns (uint8)'],
                    this.provider
                );
                decimals = await tokenContract.decimals();
            }
            const rawAmount = ethers.parseUnits(amount.toString(), decimals);

            // Validate taskId is a bytes32 string
            if (!ethers.isHexString(taskId, 32)) {
                throw new Error('Invalid taskId: must be a 32-byte hex string.');
            }

            const tx = await rewardPoolContract.recordReward(farmer, tokenAddress, rawAmount, taskId);
            const receipt = await tx.wait();

            console.log('Reward recorded successfully. Tx hash:', receipt.hash);
            return { txHash: receipt.hash };
        } catch (error) {
            console.error('Failed to record reward on-chain:', error);
            // Re-throw to be caught by the calling service
            throw error;
        }
    }

    /**
     * Triggers a refund of unused funds (ERC20 or native ETH) from the RewardPool contract back to the factory wallet.
     * @param tokenAddress The address of the ERC-20 token or the zero address for native ETH.
     * @param amount The amount to refund in human-readable units.
     * @param factoryPk The private key of the factory wallet.
     * @returns The transaction hash if successful.
     */
    async refundFactory(
        tokenAddress: string,
        amount: number,
        factoryPk: string
    ): Promise<{ txHash: string }> {
        try {
            const factoryWallet = new ethers.Wallet(factoryPk, this.provider);
            const rewardPoolContract = new ethers.Contract(
                this.rewardPoolAddress,
                REWARD_POOL_ABI,
                factoryWallet
            );

            // Handle native ETH refund
            if (tokenAddress === ethAddressSentinel) {
                const rawAmount = ethers.parseEther(amount.toString());
                const tx = await rewardPoolContract.refundFactoryNative(rawAmount);
                const receipt = await tx.wait();
                console.log('Native ETH refund successful. Tx hash:', receipt.hash);
                return { txHash: receipt.hash };
            }

            // Handle ERC20 token refund
            const tokenContract = new ethers.Contract(
                tokenAddress,
                ['function decimals() view returns (uint8)'],
                this.provider
            );
            const decimals = await tokenContract.decimals();
            const rawAmount = ethers.parseUnits(amount.toString(), decimals);

            const tx = await rewardPoolContract.refundFactory(tokenAddress, rawAmount);
            const receipt = await tx.wait();

            console.log('ERC20 refund successful. Tx hash:', receipt.hash);
            return { txHash: receipt.hash };
        } catch (error) {
            console.error('Failed to execute refund on-chain:', error);
            throw error;
        }
    }
}

export default RewardPoolService;
