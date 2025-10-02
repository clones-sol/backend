export interface FileIntegrity {
  filename: string
  sha256: string
  size: number
  lastModified: string
}

export interface DemoIntegrity {
  demoHash: string
  submissionId: string
  userAddress: string
  timestamp: number
  files: FileIntegrity[]
  overallHash: string
}

export interface DemoFiles {
  'recording.mp4': Buffer
  'meta.json': Buffer
  'input_log.jsonl': Buffer
  'sft.json': Buffer
}

export interface DemoManifest {
  demonstration_id: string
  user_address: string
  submission_id: string
  created_at: string
  task?: {
    type: string
    description: string
    url?: string
  }
  environment?: {
    os: string
    browser?: string
    screen_resolution?: string
  }
  quality_metrics?: {
    score: number
    completion_rate: number
    efficiency: number
  }
}

export interface DatasetManifest {
  name: string
  version: string
  description: string
  format: string
  license: string
  created: string
  statistics: {
    total_demonstrations: number
    total_size_bytes: number
    duration_seconds?: number
  }
  schema: {
    recording: string
    meta: string
    input_log: string
    sft: string
  }
  integrity: {
    algorithm: string
    verified_at: string
  }
}