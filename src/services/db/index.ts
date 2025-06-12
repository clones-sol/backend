import EventEmitter from 'node:events';
import {
  ChatModel,
  ChallengeModel,
  PagesModel,
  RaceSessionModel,
  RaceModel,
  GymSessionModel,
  chatSchema,
} from '../../models/Models.ts';
import { TrainingEventModel } from '../../models/TrainingEvent.ts';
import dotenv from 'dotenv';
import { InferSchemaType, QueryOptions, SortOrder, UpdateWriteOpResult } from 'mongoose';
import { GymVpsModel } from '../../models/GymVPS.ts';
import {
  VPSRegion,
  DBChallenge,
  DBChat,
  DBPage,
  DBRace,
  DBGymVps,
  DBGymSession,
  DBRaceSession
} from '../../types/index.ts';

dotenv.config();

class DataBaseService extends EventEmitter {
  constructor() {
    // Constructor remains empty as we don't need initialization logic
    super();
  }

  async getChallengeByName(name: string, projection = {}): Promise<DBChallenge | false> {
    const nameReg = { $regex: name, $options: 'i' };
    try {
      return (await ChallengeModel.findOne({ name: nameReg }, projection)) || false;
    } catch (error) {
      console.error('Database Service Error:', error);
      return false;
    }
  }

  async getChatCount(query: QueryOptions): Promise<number | false> {
    try {
      return await ChatModel.countDocuments(query);
    } catch (error) {
      console.error('Database Service Error:', error);
      return false;
    }
  }

  async findOneChat(query: QueryOptions): Promise<DBChat | false> {
    try {
      return (await ChatModel.findOne(query)) || false;
    } catch (error) {
      console.error('Database Service Error:', error);
      return false;
    }
  }
  async getPages(query: QueryOptions): Promise<DBPage[] | undefined> {
    try {
      return await PagesModel.find(query);
    } catch (error) {
      console.error('Database Service Error:', error);
    }
  }
  // Settings-related methods
  async getSettings(): Promise<DBChallenge[] | undefined> {
    try {
      const challenge = await ChallengeModel.find(
        {},
        {
          _id: 0,
          id: '$_id',
          name: 1,
          title: 1,
          image: 1,
          label: 1,
          level: 1,
          status: 1,
          pfp: 1,
          entryFee: 1,
          expiry: 1,
          winning_prize: 1,
          developer_fee: 1,
          start_date: 1,
          winning_address: 1,
          winning_txn: 1
        }
      );

      return challenge;
    } catch (error) {
      console.error('Database Service Error:', error);
    }
  }

  // Race session methods
  async createRaceSession(sessionData: DBRaceSession): Promise<DBRaceSession | false> {
    try {
      return await RaceSessionModel.create(sessionData);
    } catch (error) {
      console.error('Database Service Error:', error);
      return false;
    }
  }

  async getRaceSession(id: string): Promise<DBRaceSession | null> {
    try {
      return await RaceSessionModel.findById(id);
    } catch (error) {
      console.error('Database Service Error:', error);
      return null;
    }
  }

  async updateRaceSession(
    id: string,
    updateData: Partial<DBRaceSession>
  ): Promise<DBRaceSession | null> {
    try {
      return await RaceSessionModel.findByIdAndUpdate(id, updateData, { new: true });
    } catch (error) {
      console.error('Database Service Error:', error);
      return null;
    }
  }

  async getRaceById(id: string, projection = {}): Promise<DBRace | null> {
    try {
      return await RaceModel.findOne({ id: id }, projection);
    } catch (error) {
      console.error('Database Service Error:', error);
      return null;
    }
  }

  async getRaces(): Promise<DBRace[] | false> {
    try {
      return await RaceModel.find(
        {},
        {
          id: 1,
          title: 1,
          description: 1,
          category: 1,
          icon: 1,
          colorScheme: 1,
          prompt: 1,
          reward: 1,
          buttonText: 1,
          stakeRequired: 1
        }
      );
    } catch (error) {
      console.error('Database Service Error:', error);
      return false;
    }
  }

  async getRaceSessions(filter?: { address?: string }): Promise<DBRaceSession[] | false> {
    try {
      return await RaceSessionModel.find(filter || {}, {
        // id: "$_id",
        _id: 1,
        status: 1,
        challenge: 1,
        category: 1,
        video_path: 1,
        created_at: 1,
        transaction_signature: 1,
        preview: 1
      }).sort({ created_at: -1 });
    } catch (error) {
      console.error('Database Service Error:', error);
      return false;
    }
  }

  async getRaceSessionsByIds(ids: string[]): Promise<DBRaceSession[] | false> {
    try {
      console.log('Getting race sessions for IDs:', ids);
      const mongoose = await import('mongoose');
      const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));
      console.log('Converted to ObjectIds:', objectIds);
      return await RaceSessionModel.find(
        { _id: { $in: objectIds } },
        {
          _id: 1,
          status: 1,
          challenge: 1,
          category: 1,
          video_path: 1,
          created_at: 1,
          transaction_signature: 1,
          preview: 1
        }
      ).sort({ created_at: -1 });

      // console.log('Getting race sessions for IDs:', ids);
      // const allSessions = await this.getRaceSessions();
      // if (!allSessions) return false;

      // // Filter sessions by ID
      // const filteredSessions = allSessions.filter(session => {
      //   const sessionDoc = session as any;
      //   return ids.includes(sessionDoc._id?.toString());
      // });

      // console.log(`Found ${filteredSessions.length} matching sessions`);
      // return filteredSessions;
    } catch (error) {
      console.error('Database Service Error:', error);
      return false;
    }
  }

  async getRaceSessionByStream(streamId: string): Promise<DBRaceSession | null> {
    try {
      return await RaceSessionModel.findOne({ stream_id: streamId });
    } catch (error) {
      console.error('Database Service Error:', error);
      return null;
    }
  }

  // Training event methods
  async createTrainingEvent(eventData: any): Promise<any> {
    try {
      return await TrainingEventModel.create(eventData);
    } catch (error) {
      console.error('Database Service Error:', error);
      return false;
    }
  }

  // gym VPS stuff
  async removeGymVPSUser(ip: string, username: string): Promise<void> {
    try {
      await GymVpsModel.updateOne({ ip }, { $pull: { users: { username } } });
    } catch (error) {
      console.error('Database Service Error:', error);
    }
  }

  async addGymVPSUser(ip: string, username: string, password: string): Promise<void> {
    try {
      const exists = await GymVpsModel.findOne({
        ip: ip,
        'users.username': username
      });
      // don't add a new user if we are already connected to the rdp
      if (!exists)
        await GymVpsModel.updateOne({ ip }, { $addToSet: { users: { username, password } } });
    } catch (error) {
      console.error('Database Service Error:', error);
    }
  }

  async getGymVPS(region: VPSRegion): Promise<DBGymVps> {
    const vps = await GymVpsModel.findOne({ region });
    if (!vps) throw Error('Could not find a VPS for region ' + region);
    return vps;
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
