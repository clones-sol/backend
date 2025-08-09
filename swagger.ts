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
            - Monitoring
            - Referral system management.`,
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
        path.join(__dirname, './src/api/referral.ts')
    ],
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec; 