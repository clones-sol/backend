import { ApiError } from './types/errors.ts';
import { NextFunction, Request, Response } from 'express';
import { WalletConnectionModel } from '../models/Models.ts';

// Admin authentication middleware
export function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const adminToken = req.headers['x-admin-token'];
    const expectedToken = process.env.ADMIN_TOKEN;
    
    if (!adminToken || typeof adminToken !== 'string') {
      throw ApiError.unauthorized('Admin token is required');
    }
    
    if (!expectedToken || adminToken !== expectedToken) {
      throw ApiError.unauthorized('Invalid admin token');
    }
    
    next();
  } catch (e) {
    next(e);
  }
}

// Middleware to resolve connect token to wallet address
export async function requireWalletAddress(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.headers['x-connect-token'];
    if (!token || typeof token !== 'string') {
      if (req.originalUrl.includes('v1')) {
        throw ApiError.unauthorized('Connect token is required');
      } else {
        res.status(401).json({ error: 'Connect token is required' });
        return;
      }
    }

    const connection = await WalletConnectionModel.findOne({ token });
    if (!connection) {
      if (req.originalUrl.includes('v1')) {
        throw ApiError.unauthorized('Invalid connect token');
      } else {
        res.status(401).json({ error: 'Invalid connect token' });
        return;
      }
    }

    // Add the wallet address to the request object
    // @ts-ignore - Add walletAddress to the request object
    req.walletAddress = connection.address;
    next();
  } catch (e) {
    next(e);
  }
}
