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
                connectTokenAuth: {
                    type: 'apiKey',
                    in: 'header',
                    name: 'x-connect-token',
                    description: 'Connect token obtained from wallet connection endpoint. Required for authenticated requests.',
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
                connectTokenAuth: [],
            },
        ],
    },
    // Path to the API docs files - use source files since esbuild strips comments
    apis: [
        // On Fly.io, source files are copied to /app/src after build
        // Locally, they're relative to __dirname
        process.env.FLY_APP_NAME
            ? path.join(process.cwd(), 'src/api/**/*.ts')
            : path.join(__dirname, './src/api/**/*.ts'),
    ],
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec; 