import EventEmitter from 'node:events';
import { GymSessionModel } from '../../models/Models.ts';
import dotenv from 'dotenv';
import { DBGymSession } from '../../types/index.ts';

dotenv.config();

class DataBaseService extends EventEmitter {
  constructor() {
    // Constructor remains empty as we don't need initialization logic
    super();
  }

  // Gym session methods
  async getGymSession(address: string): Promise<DBGymSession | null> {
    try {
      return await GymSessionModel.findOne({ address, status: 'active' });
    } catch (error) {
      console.error('Database Service Error:', error);
      return null;
    }
  }

  async createGymSession(sessionData: DBGymSession): Promise<DBGymSession | false> {
    try {
      return await GymSessionModel.create(sessionData);
    } catch (error) {
      console.error('Database Service Error:', error);
      return false;
    }
  }

  async updateGymSession(
    id: string,
    updateData: Partial<DBGymSession>
  ): Promise<DBGymSession | null> {
    try {
      return await GymSessionModel.findByIdAndUpdate(id, updateData, { new: true });
    } catch (error) {
      console.error('Database Service Error:', error);
      return null;
    }
  }
}

export default new DataBaseService();
