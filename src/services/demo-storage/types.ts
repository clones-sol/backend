export interface FileIntegrity {
  filename: string
  sha256: string
  size: number
  lastModified: string
}

export interface DemoIntegrity {
  schema_version: SchemaVersion
  demoHash: string
  submissionId: string
  userAddress: string
  timestamp: number
  files: FileIntegrity[]
  overallHash: string
}

export interface InputLogMeta {
  schema_version: SchemaVersion
  format: 'jsonl'
  event_count: number
  timestamp_type: 'relative' | 'absolute'
  created_at: string
}

export interface DemoFiles {
  'recording.mp4': Buffer
  'meta.json': Buffer
  'input_log.jsonl': Buffer
  'input_log_meta.json': Buffer
  'sft.json': Buffer
}

export interface SchemaVersion {
  major: number   // Breaking changes
  minor: number   // New features, backward compatible
  patch: number   // Bug fixes
}

export interface DemoManifest {
  schema_version: SchemaVersion
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
    input_log_meta: string
    sft: string
  }
  integrity: {
    algorithm: string
    verified_at: string
  }
}