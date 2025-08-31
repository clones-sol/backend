import { GraphQLClient } from 'graphql-request';

interface SubgraphConfig {
  endpoint: string;
  timeout: number;
  retries: number;
}

interface PoolSearchCriteria {
  skills?: string[];
  searchTerm?: string;
  category?: string;
  creator?: string;
  token?: string;
  minFunding?: string;
  maxFunding?: string;
  isActive?: boolean;
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'totalFunded' | 'totalClaimed' | 'totalUsers';
  orderDirection?: 'asc' | 'desc';
}

interface PoolSearchResult {
  id: string;
  creator: string;
  token: {
    symbol: string;
    name: string;
    id: string;
  };
  totalFunded: string;
  totalClaimed: string;
  totalUsers: string;
  totalClaims: string;
  isActive: boolean;
  skillsHash?: string;
  taskTypeHash?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

interface FactoryAnalytics {
  totalPools: string;
  totalVolume: string;
  totalUsers: string;
  totalClaims: string;
  averagePoolSize: string;
  updatedAt: string;
}

interface UserActivity {
  id: string;
  totalClaimed: string;
  uniquePools: string;
  totalClaims: string;
  claims: Array<{
    id: string;
    pool: {
      id: string;
      token: { symbol: string };
    };
    grossAmount: string;
    timestamp: string;
  }>;
}

export class GraphQLService {
  private client: GraphQLClient;
  private config: SubgraphConfig;

  constructor() {
    this.config = {
      endpoint: process.env.GRAPH_ENDPOINT || 'https://api.studio.thegraph.com/query/119491/clones-factory-base-sepolia/version/latest',
      timeout: 30000,
      retries: 3
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (process.env.GRAPH_API_KEY) {
      headers['Authorization'] = `Bearer ${process.env.GRAPH_API_KEY}`;
    }

    this.client = new GraphQLClient(this.config.endpoint, {
      headers
    });
  }

  /**
   * Search pools by criteria from The Graph
   */
  async searchPools(criteria: PoolSearchCriteria): Promise<{
    pools: PoolSearchResult[];
    total: number;
    hasMore: boolean;
  }> {
    try {
      const query = this.buildPoolSearchQuery(criteria);
      const variables = this.buildPoolSearchVariables(criteria);

      console.log('Executing pool search query:', { query: query.substring(0, 200) + '...', variables });

      const data = await this.client.request<{
        pools: PoolSearchResult[];
        poolsTotal: Array<{ id: string }>;
      }>(query, variables);

      console.log('Received GraphQL data:', JSON.stringify(data, null, 2));

      if (!data || !data.pools) {
        console.error('GraphQL query returned no pools or an error response.', data);
        return {
          pools: [],
          total: 0,
          hasMore: false,
        };
      }

      // Return raw subgraph data
      const total = data.poolsTotal ? data.poolsTotal.length : data.pools.length;
      const hasMore = (criteria.offset || 0) + (criteria.limit || 20) < total;

      return {
        pools: data.pools,
        total,
        hasMore
      };

    } catch (error) {
      console.error('Failed to search pools via GraphQL:', error);
      throw new Error(`Pool search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get factory-wide analytics
   */
  async getFactoryAnalytics(): Promise<FactoryAnalytics | null> {
    const query = `
      query GetFactoryAnalytics {
        factoryStats(id: "factory-stats") {
          totalPools
          totalVolume
          totalUsers
          totalClaims
          averagePoolSize
          updatedAt
        }
      }
    `;

    try {
      const data = await this.client.request<{ factoryStats: FactoryAnalytics }>(query);
      return data.factoryStats;
    } catch (error) {
      console.error('Failed to fetch factory analytics:', error);
      return null;
    }
  }

  /**
   * Get daily statistics for analytics dashboard
   */
  async getDailyStats(dates: string[]): Promise<Array<{
    date: string;
    poolsCreated: string;
    volume: string;
    uniqueUsers: string;
    totalClaims: string;
    batchClaims: string;
  }>> {
    const query = `
      query GetDailyStats($dates: [String!]!) {
        dailyStats(where: { id_in: $dates }) {
          id
          date
          poolsCreated
          volume
          uniqueUsers
          totalClaims
          batchClaims
        }
      }
    `;

    try {
      const data = await this.client.request<{
        dailyStats: Array<{
          id: string;
          date: string;
          poolsCreated: string;
          volume: string;
          uniqueUsers: string;
          totalClaims: string;
          batchClaims: string;
        }>
      }>(query, { dates });

      return data.dailyStats;
    } catch (error) {
      console.error('Failed to fetch daily stats:', error);
      return [];
    }
  }

  /**
   * Get user activity and claim history
   */
  async getUserActivity(userAddress: string): Promise<UserActivity | null> {
    const query = `
      query GetUserActivity($userAddress: Bytes!) {
        user(id: $userAddress) {
          id
          totalClaimed
          uniquePools
          totalClaims
          claims(
            orderBy: timestamp
            orderDirection: desc
            first: 100
          ) {
            id
            pool {
              id
              token {
                symbol
              }
            }
            grossAmount
            timestamp
          }
        }
      }
    `;

    try {
      const data = await this.client.request<{ user: UserActivity }>(query, {
        userAddress: userAddress.toLowerCase()
      });

      return data.user;
    } catch (error) {
      console.error('Failed to fetch user activity:', error);
      return null;
    }
  }

  /**
   * Get batch claim analytics for gas optimization insights
   */
  async getBatchClaimAnalytics(limit: number = 100): Promise<Array<{
    id: string;
    caller: string;
    successful: string;
    failed: string;
    totalGross: string;
    timestamp: string;
    successes: Array<{
      vault: string;
      account: string;
      gross: string;
      fee: string;
    }>;
    failures: Array<{
      vault: string;
      account: string;
      reason: string;
    }>;
  }>> {
    const query = `
      query GetBatchClaimAnalytics($limit: Int!) {
        batchClaims(
          orderBy: timestamp
          orderDirection: desc
          first: $limit
        ) {
          id
          caller
          successful
          failed
          totalGross
          timestamp
          successes(first: 20) {
            vault
            account
            gross
            fee
          }
          failures(first: 20) {
            vault
            account
            reason
          }
        }
      }
    `;

    try {
      const data = await this.client.request<{
        batchClaims: Array<{
          id: string;
          caller: string;
          successful: string;
          failed: string;
          totalGross: string;
          timestamp: string;
          successes: Array<{
            vault: string;
            account: string;
            gross: string;
            fee: string;
          }>;
          failures: Array<{
            vault: string;
            account: string;
            reason: string;
          }>;
        }>
      }>(query, { limit });

      return data.batchClaims;
    } catch (error) {
      console.error('Failed to fetch batch claim analytics:', error);
      return [];
    }
  }

  /**
   * Get pools by creator address
   */
  async getPoolsByCreator(
    creator: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<PoolSearchResult[]> {
    const query = `
      query GetPoolsByCreator($creator: Bytes!, $limit: Int!, $offset: Int!) {
        pools(
          where: { creator: $creator }
          orderBy: createdAt
          orderDirection: desc
          first: $limit
          skip: $offset
        ) {
          id
          creator
          token {
            symbol
            name
            id
          }
          totalFunded
          totalClaimed
          totalUsers
          totalClaims
          isActive
          skillsHash
          taskTypeHash
          description
          createdAt
          updatedAt
        }
      }
    `;

    try {
      const data = await this.client.request<{ pools: PoolSearchResult[] }>(query, {
        creator: creator.toLowerCase(),
        limit,
        offset
      });

      return data.pools;
    } catch (error) {
      console.error('Failed to fetch pools by creator:', error);
      return [];
    }
  }

  /**
   * Build dynamic GraphQL query for pool search
   */
  private buildPoolSearchQuery(criteria: PoolSearchCriteria): string {
    const whereConditions: string[] = [];

    if (criteria.creator) {
      whereConditions.push(`creator: "${criteria.creator.toLowerCase()}"`);
    }

    if (criteria.token) {
      whereConditions.push(`token: "${criteria.token.toLowerCase()}"`);
    }

    if (criteria.isActive !== undefined) {
      whereConditions.push(`isActive: ${criteria.isActive}`);
    }

    if (criteria.minFunding) {
      whereConditions.push(`totalFunded_gte: "${criteria.minFunding}"`);
    }

    if (criteria.maxFunding) {
      whereConditions.push(`totalFunded_lte: "${criteria.maxFunding}"`);
    }

    if (criteria.skills && criteria.skills.length > 0) {
      const skillConditions = criteria.skills.map(skill => `"${skill.toLowerCase()}"`).join(', ');
      whereConditions.push(`skills_contains: [${skillConditions}]`);
    }

    // Build search term condition
    if (criteria.searchTerm) {
      whereConditions.push(`description_contains_nocase: "${criteria.searchTerm}"`);
    }

    const whereClause = whereConditions.length > 0 ? `where: { ${whereConditions.join(', ')} }` : '';
    const orderBy = criteria.orderBy || 'createdAt';
    const orderDirection = criteria.orderDirection || 'desc';
    const first = criteria.limit || 20;
    const skip = criteria.offset || 0;

    return `
      query SearchPools {
        pools(
          ${whereClause ? `${whereClause},` : ''}
          orderBy: ${orderBy}
          orderDirection: ${orderDirection}
          first: ${first}
          skip: ${skip}
        ) {
          id
          creator
          token {
            symbol
            name
            id
          }
          totalFunded
          totalClaimed
          totalUsers
          totalClaims
          isActive
          skillsHash
          taskTypeHash
          description
          createdAt
          updatedAt
        }
        
        poolsTotal: pools${whereClause ? `(${whereClause})` : ''} {
          id
        }
      }
    `;
  }

  /**
   * Build variables for GraphQL query
   */
  private buildPoolSearchVariables(criteria: PoolSearchCriteria): Record<string, any> {
    const variables: Record<string, any> = {};

    if (criteria.creator) variables.creator = criteria.creator.toLowerCase();
    if (criteria.token) variables.token = criteria.token.toLowerCase();
    if (criteria.searchTerm) variables.searchTerm = criteria.searchTerm;
    if (criteria.skills) variables.skills = criteria.skills.map(s => s.toLowerCase());
    if (criteria.minFunding) variables.minFunding = criteria.minFunding;
    if (criteria.maxFunding) variables.maxFunding = criteria.maxFunding;

    return variables;
  }

  /**
   * Health check for GraphQL endpoint
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; message: string; latency?: number }> {
    const startTime = Date.now();

    try {
      const query = `
        query HealthCheck {
          factoryStats(id: "factory-stats") {
            totalPools
          }
        }
      `;

      await this.client.request(query);
      const latency = Date.now() - startTime;

      return {
        status: 'healthy',
        message: 'GraphQL endpoint responding',
        latency
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `GraphQL endpoint unreachable: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
}

export default GraphQLService;