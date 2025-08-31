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
            title: 'Clones AI API',
            version: '1.0.0',
            description: `API for Clones`,
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
        path.join(__dirname, './src/api/referral.ts'),
        path.join(__dirname, './src/api/wallet.ts'),
        path.join(__dirname, './src/api/forge/apps.ts'),
        path.join(__dirname, './src/api/forge/factories.ts'),
        path.join(__dirname, './src/api/forge/gas.ts'),
        path.join(__dirname, './src/api/forge/metadata.ts'),
        path.join(__dirname, './src/api/forge/search.ts'),
        path.join(__dirname, './src/api/forge/submissions.ts'),
        path.join(__dirname, './src/api/forge/upload.ts'),
        path.join(__dirname, './src/api/transaction.ts'),
    ],
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec; 