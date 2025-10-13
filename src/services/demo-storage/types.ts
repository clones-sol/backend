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

/**
 * Metadata for the input log file.
 * 
 * - `timestamp_type`: Indicates how timestamps in the input log are represented.
 * - `'relative'`: Timestamps are measured relative to the start of the recording(e.g., seconds or milliseconds since recording began).
 * - `'absolute'`: Timestamps are absolute, typically in Unix epoch time or ISO 8601 format.
 * - `created_at`: The date and time when the input log was created, as an ISO 8601 string(e.g., "2023-06-01T12:34:56Z").
 */
export interface InputLogMeta {
  /**
   * Version of the schema used for this input log.
   */
  schema_version: SchemaVersion
  /**
   * Format of the input log file. Currently only 'jsonl' is supported.
   */
  format: 'jsonl'
  /**
   * Number of events recorded in the input log.
   */
  event_count: number
  /**
   * Indicates whether timestamps in the input log are 'relative' or 'absolute'.
   */
  timestamp_type: 'relative' | 'absolute'
  /**
   * ISO 8601 string representing when the input log was created.
   * Example: "2023-06-01T12:34:56Z"
   */
  created_at: string
}

export interface DemoFiles {
  'recording.mp4': Buffer
  'meta.json': Buffer
  'input_log.jsonl': Buffer
  'input_log_meta.json': Buffer
  'sft.json': Buffer
}

/**
 * Represents the semantic versioning contract for demo-related types.
 * 
 * Follows the Semantic Versioning specification (https://semver.org/):
 * - `major`: Incremented for breaking changes that are not backward compatible.
 * - `minor`: Incremented for new features that are backward compatible.
 * - `patch`: Incremented for bug fixes and backward compatible changes.
 * 
 * This interface is used to track the schema version of various demo-related data structures.
 */
export interface SchemaVersion {
  major: number
  minor: number
  patch: number
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