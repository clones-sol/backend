declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: 'production' | 'development' | 'test'

    // Database Configuration
    DB_URI: string

    // API Keys
    OPENAI_API_KEY: string
    ANTHROPIC_API_KEY: string

    // Clones Quality Agent path
    CQA_PATH: string

    // Blockchain Configuration
    RPC_URL: string
  }
}
