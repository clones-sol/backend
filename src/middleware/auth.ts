import type { NextFunction, Request, Response } from 'express'
import { WalletConnectionModel } from '../models/Models.ts'
import { ApiError } from './types/errors.ts'
import type { AuthenticatedRequest } from './types/request.ts'

// Admin authentication middleware
export function requireAdminAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const adminToken = req.headers['x-admin-token']
    const expectedToken = process.env.ADMIN_TOKEN

    if (!adminToken || typeof adminToken !== 'string') {
      throw ApiError.unauthorized('Admin token is required')
    }

    if (!expectedToken || adminToken !== expectedToken) {
      throw ApiError.unauthorized('Invalid admin token')
    }

    next()
  } catch (e) {
    next(e)
  }
}

// Middleware to resolve connect token to wallet address
export async function requireWalletAddress(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const token = req.headers['x-connect-token']
    if (!token || typeof token !== 'string') {
      if (req.originalUrl.includes('v1')) {
        throw ApiError.unauthorized('Connect token is required')
      } else {
        res.status(401).json({ error: 'Connect token is required' })
        return
      }
    }


    const connection = await WalletConnectionModel.findOne({ token })
    if (!connection) {
      if (req.originalUrl.includes('v1')) {
        throw ApiError.unauthorized('Invalid connect token')
      } else {
        res.status(401).json({ error: 'Invalid connect token' })
        return
      }
    }

    // Add the wallet address to the request object (normalized to lowercase)
    req.walletAddress = connection.address.toLowerCase()
    next()
  } catch (e) {
    next(e)
  }
}
