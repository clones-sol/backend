import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const options: swaggerJsdoc.Options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Clones AI Agent Forge API',
            version: '1.0.0',
            description: `API for creating, managing, and deploying AI Agents on the Solana blockchain. 
            This documentation provides details on all available endpoints for:
            - Agent lifecycle management
            - On-chain orchestration
            - Versioning
            - Smart contract monitoring and alerting
            - Referral system management.
            
            ## Smart Contract Monitoring & Alerting System
            
            The monitoring system provides comprehensive real-time monitoring of smart contract events on the Solana blockchain, including:
            
            - **Event Detection**: Monitors transactions and detects specific smart contract events
            - **Alert Management**: Configurable alert rules with multiple notification channels
            - **Health Monitoring**: System health checks and performance metrics
            - **Dashboard**: Real-time dashboard with analytics and insights
            - **Multi-Channel Alerts**: Support for Discord, Slack, Email, Webhooks, SMS, and Telegram
            
            ### Key Features:
            - Real-time blockchain monitoring
            - Configurable alert rules and conditions
            - Multiple notification channels
            - Health status monitoring
            - Performance metrics and analytics
            - Event filtering and pagination
            - RESTful API for integration`,
            contact: {
                name: 'Clones Support'
            },
        },
        servers: [
            {
                url: '/api/v1',
                description: 'Main API Base Path',
            },
        ],
        components: {
            securitySchemes: {
                walletAuth: {
                    type: 'apiKey',
                    in: 'header',
                    name: 'X-Wallet-Address',
                    description: 'The wallet address of the authenticated user. This is a placeholder for a more robust authentication mechanism like JWT in the future.',
                },
            },
            schemas: {
                Error: {
                    type: 'object',
                    properties: {
                        success: {
                            type: 'boolean',
                            example: false
                        },
                        error: {
                            type: 'object',
                            properties: {
                                message: {
                                    type: 'string',
                                    example: 'Error message'
                                },
                                code: {
                                    type: 'string',
                                    example: 'BAD_REQUEST'
                                },
                                statusCode: {
                                    type: 'number',
                                    example: 400
                                }
                            }
                        }
                    }
                },
                SuccessResponse: {
                    type: 'object',
                    properties: {
                        success: {
                            type: 'boolean',
                            example: true
                        },
                        data: {
                            type: 'object',
                            description: 'Response data'
                        }
                    }
                }
            }
        },
        security: [
            {
                walletAuth: [],
            },
        ],
    },
    // Path to the API docs files
    apis: [
        path.join(__dirname, './src/api/forge/agents/*.ts'),
        path.join(__dirname, './src/api/forge/*.ts'),
        path.join(__dirname, './src/api/forge/pools.ts'),
        path.join(__dirname, './src/api/referral.ts'),
        path.join(__dirname, './src/api/monitoring/*.ts')
    ],
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec; 