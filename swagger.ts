import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';

const options: swaggerJsdoc.Options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Clones AI Agent Forge API',
            version: '1.0.0',
            description: 'API for creating, managing, and deploying AI Agents on the Solana blockchain. This documentation provides details on all available endpoints for agent lifecycle management, on-chain orchestration, versioning, and monitoring.',
            contact: {
                name: 'Clones Support',
                url: 'https://clones.ai',
                email: 'support@clones.ai',
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
        },
        security: [
            {
                walletAuth: [],
            },
        ],
    },
    // Path to the API docs files
    apis: [path.join(__dirname, './src/api/forge/agents/*.ts')],
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec; 