declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: 'production' | 'development';

    // Database Configuration
    DB_URI: string;
    DB_NAME: string;
    DB_USER: string;
    DB_PASSWORD: string;
    DB_REPLICASET: string;

    // API Keys
    OPENAI_API_KEY: string;
    ANTHROPIC_API_KEY: string;

    // Files path
    PIPELINE_PATH: string;

    // Blockchain Configuration
    RPC_URL: string;
    IPC_SECRET: string;

    // GYM Configuration
    GYM_FORGE_WEBHOOK: string;

    // Authentication & Security
    VIRAL_TOKEN: string;
    AX_PARSER_SECRET: string;

    // AWS Configuration
    AWS_ACCESS_KEY: string;
    AWS_SECRET_KEY: string;
    AWS_REGION: string;
  }
}
