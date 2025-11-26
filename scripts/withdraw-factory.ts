#!/usr/bin/env tsx
/**
 * @title Factory Withdrawal CLI Tool
 * @notice Emergency withdrawal tool that bypasses database and interacts directly with blockchain
 * @dev Use this when database issues prevent UI-based withdrawals
 *
 * Usage:
 *   npm run withdraw -- --pool <pool-address> --amount <amount> --private-key <key>
 *   npm run withdraw -- --pool <pool-address> --max --private-key <key>
 *
 * Examples:
 *   # Withdraw specific amount
 *   npm run withdraw -- --pool 0x123... --amount 100 --private-key 0xabc...
 *
 *   # Withdraw maximum safe amount
 *   npm run withdraw -- --pool 0x123... --max --private-key 0xabc...
 *
 *   # Check pool status only (no withdrawal)
 *   npm run withdraw -- --pool 0x123... --status
 */

import { ethers } from 'ethers'
import * as dotenv from 'dotenv'
import { parseArgs } from 'node:util'
import RewardPoolImplementationABI from '../src/contracts/abis/RewardPoolImplementation.json' with { type: 'json' }
import erc20ABI from '../src/contracts/abis/ERC20.json' with { type: 'json' }

// Load environment variables
dotenv.config()

interface PoolInfo {
  address: string
  creator: string
  token: string
  tokenSymbol: string
  tokenDecimals: number
  balance: bigint
  totalPending: bigint
  maxSafeWithdrawal: bigint
  safetyBuffer: bigint
  allocationsCount: number
}

interface WithdrawalResult {
  success: boolean
  txHash?: string
  amount?: string
  error?: string
}

class FactoryWithdrawalCLI {
  private provider: ethers.JsonRpcProvider
  private wallet?: ethers.Wallet

  constructor(rpcUrl: string, privateKey?: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl)

    if (privateKey) {
      this.wallet = new ethers.Wallet(privateKey, this.provider)
    }
  }

  /**
   * Get comprehensive pool information
   */
  async getPoolInfo(poolAddress: string): Promise<PoolInfo> {
    // Validate address format
    if (!ethers.isAddress(poolAddress)) {
      throw new Error(`Invalid pool address: ${poolAddress}`)
    }

    // Check if contract exists
    const code = await this.provider.getCode(poolAddress)
    if (code === '0x') {
      throw new Error(`No contract found at address: ${poolAddress}`)
    }

    const poolContract = new ethers.Contract(
      poolAddress,
      RewardPoolImplementationABI,
      this.provider
    )

    // Get pool data
    const [creator, token] = await Promise.all([
      poolContract.creator(),
      poolContract.token()
    ])

    // Get token info
    const tokenContract = new ethers.Contract(token, erc20ABI, this.provider)
    const [tokenSymbol, tokenDecimals, balance] = await Promise.all([
      tokenContract.symbol(),
      tokenContract.decimals(),
      tokenContract.balanceOf(poolAddress)
    ])

    // For now, we can't calculate pending claims without database access
    // But we can show the current balance
    const totalPending = 0n // This would require database access
    const safetyBuffer = 0n
    const maxSafeWithdrawal = balance // Without pending claims data, all balance is withdrawable

    return {
      address: poolAddress,
      creator,
      token,
      tokenSymbol,
      tokenDecimals: Number(tokenDecimals),
      balance,
      totalPending,
      maxSafeWithdrawal,
      safetyBuffer,
      allocationsCount: 0
    }
  }

  /**
   * Display pool status
   */
  displayPoolInfo(info: PoolInfo): void {
    console.log('\n' + '='.repeat(80))
    console.log('POOL STATUS')
    console.log('='.repeat(80))
    console.log(`Pool Address:        ${info.address}`)
    console.log(`Creator:             ${info.creator}`)
    console.log(`Token:               ${info.token} (${info.tokenSymbol})`)
    console.log(`Current Balance:     ${ethers.formatUnits(info.balance, info.tokenDecimals)} ${info.tokenSymbol}`)

    if (info.totalPending > 0n) {
      console.log(`Pending Claims:      ${ethers.formatUnits(info.totalPending, info.tokenDecimals)} ${info.tokenSymbol}`)
      console.log(`Allocations Count:   ${info.allocationsCount}`)
      console.log(`Safety Buffer:       ${ethers.formatUnits(info.safetyBuffer, info.tokenDecimals)} ${info.tokenSymbol}`)
      console.log(`Max Safe Withdrawal: ${ethers.formatUnits(info.maxSafeWithdrawal, info.tokenDecimals)} ${info.tokenSymbol}`)
    } else {
      console.log(`\n⚠️  WARNING: Cannot calculate pending claims without database access`)
      console.log(`   Assuming all balance is safe to withdraw`)
      console.log(`   Use with caution if there are pending farmer claims!`)
    }
    console.log('='.repeat(80) + '\n')
  }

  /**
   * Execute withdrawal transaction
   */
  async withdraw(
    poolAddress: string,
    amount: bigint,
    info: PoolInfo
  ): Promise<WithdrawalResult> {
    if (!this.wallet) {
      return {
        success: false,
        error: 'No wallet configured (private key required for withdrawal)'
      }
    }

    // Validate user is creator
    const walletAddress = await this.wallet.getAddress()
    if (walletAddress.toLowerCase() !== info.creator.toLowerCase()) {
      return {
        success: false,
        error: `Only the pool creator can withdraw. Creator: ${info.creator}, Your address: ${walletAddress}`
      }
    }

    // Validate amount
    if (amount <= 0n) {
      return {
        success: false,
        error: 'Withdrawal amount must be greater than 0'
      }
    }

    if (amount > info.balance) {
      return {
        success: false,
        error: `Insufficient balance. Requested: ${ethers.formatUnits(amount, info.tokenDecimals)}, Available: ${ethers.formatUnits(info.balance, info.tokenDecimals)}`
      }
    }

    // Warning if withdrawing more than max safe amount
    if (info.totalPending > 0n && amount > info.maxSafeWithdrawal) {
      console.log('\n⚠️  WARNING: This withdrawal exceeds the maximum safe amount!')
      console.log(`   It may leave insufficient funds for ${info.allocationsCount} pending farmer claim(s)`)
      console.log(`   Max safe: ${ethers.formatUnits(info.maxSafeWithdrawal, info.tokenDecimals)} ${info.tokenSymbol}`)
      console.log(`   Requested: ${ethers.formatUnits(amount, info.tokenDecimals)} ${info.tokenSymbol}\n`)
    }

    console.log(`\nPreparing withdrawal transaction...`)
    console.log(`Amount: ${ethers.formatUnits(amount, info.tokenDecimals)} ${info.tokenSymbol}`)

    try {
      const poolContract = new ethers.Contract(
        poolAddress,
        RewardPoolImplementationABI,
        this.wallet
      )

      // Estimate gas
      console.log(`Estimating gas...`)
      const gasEstimate = await poolContract.withdraw.estimateGas(amount)
      const gasPrice = await this.provider.getFeeData()

      console.log(`Estimated gas: ${gasEstimate.toString()}`)
      console.log(`Gas price: ${ethers.formatUnits(gasPrice.gasPrice || 0n, 'gwei')} gwei`)

      // Send transaction
      console.log(`\nSending transaction...`)
      const tx = await poolContract.withdraw(amount, {
        gasLimit: gasEstimate * 120n / 100n // 20% buffer
      })

      console.log(`Transaction sent: ${tx.hash}`)
      console.log(`Waiting for confirmation...`)

      const receipt = await tx.wait()

      if (receipt.status === 1) {
        return {
          success: true,
          txHash: receipt.hash,
          amount: ethers.formatUnits(amount, info.tokenDecimals)
        }
      } else {
        return {
          success: false,
          error: 'Transaction failed'
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
}

// CLI Entry Point
async function main() {
  const { values } = parseArgs({
    options: {
      pool: {
        type: 'string',
        short: 'p'
      },
      amount: {
        type: 'string',
        short: 'a'
      },
      max: {
        type: 'boolean',
        short: 'm',
        default: false
      },
      status: {
        type: 'boolean',
        short: 's',
        default: false
      },
      'private-key': {
        type: 'string',
        short: 'k'
      },
      rpc: {
        type: 'string',
        short: 'r'
      }
    }
  })

  // Validate required arguments
  if (!values.pool) {
    console.error('Error: --pool argument is required')
    console.log('\nUsage:')
    console.log('  npm run withdraw -- --pool <address> --amount <amount> --private-key <key>')
    console.log('  npm run withdraw -- --pool <address> --max --private-key <key>')
    console.log('  npm run withdraw -- --pool <address> --status')
    process.exit(1)
  }

  // Get RPC URL
  const rpcUrl = values.rpc || process.env.RPC_URL || 'https://sepolia.base.org'

  // Initialize CLI tool
  const cli = new FactoryWithdrawalCLI(rpcUrl, values['private-key'])

  try {
    // Get pool information
    console.log(`\nFetching pool information...`)
    const poolInfo = await cli.getPoolInfo(values.pool)
    cli.displayPoolInfo(poolInfo)

    // Status check only
    if (values.status) {
      console.log('✓ Status check complete\n')
      process.exit(0)
    }

    // Validate private key for withdrawal
    if (!values['private-key']) {
      console.error('Error: --private-key is required for withdrawal')
      console.log('Use --status flag to only check pool status without withdrawing')
      process.exit(1)
    }

    // Determine withdrawal amount
    let withdrawAmount: bigint

    if (values.max) {
      withdrawAmount = poolInfo.maxSafeWithdrawal
      if (withdrawAmount === 0n) {
        console.log('No funds available for safe withdrawal\n')
        process.exit(0)
      }
      console.log(`Withdrawing maximum safe amount: ${ethers.formatUnits(withdrawAmount, poolInfo.tokenDecimals)} ${poolInfo.tokenSymbol}`)
    } else if (values.amount) {
      withdrawAmount = ethers.parseUnits(values.amount, poolInfo.tokenDecimals)
    } else {
      console.error('Error: Either --amount or --max must be specified')
      process.exit(1)
    }

    // Execute withdrawal
    const result = await cli.withdraw(values.pool, withdrawAmount, poolInfo)

    if (result.success) {
      console.log('\n' + '='.repeat(80))
      console.log('✓ WITHDRAWAL SUCCESSFUL')
      console.log('='.repeat(80))
      console.log(`Amount:      ${result.amount} ${poolInfo.tokenSymbol}`)
      console.log(`Tx Hash:     ${result.txHash}`)
      console.log(`Explorer:    https://sepolia.basescan.org/tx/${result.txHash}`)
      console.log('='.repeat(80) + '\n')
    } else {
      console.log('\n' + '='.repeat(80))
      console.log('✗ WITHDRAWAL FAILED')
      console.log('='.repeat(80))
      console.log(`Error: ${result.error}`)
      console.log('='.repeat(80) + '\n')
      process.exit(1)
    }
  } catch (error) {
    console.error('\n✗ Error:', error instanceof Error ? error.message : 'Unknown error')
    process.exit(1)
  }
}

// Run CLI
main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})