# CQA Grading Service

This service provides a unified interface for running Clones Quality Agent (CQA) grading across different environments.

## Features

- **Auto-detection of CQA**: Automatically detects whether to use local TypeScript source (with bun) or compiled binary
- **Environment-agnostic**: Works in development (macOS), Docker, and production
- **Consistent configuration**: Shares environment variables and configuration with the rest of the backend
- **Proper logging**: Uses the backend's logger for consistent log formatting
- **Error handling**: Comprehensive error handling with cleanup options

## Usage

### Basic Grading

```typescript
import { runCQAGrading } from '../services/grading/cqaGradingService'

const { gradeResult, gradingMetrics } = await runCQAGrading('/path/to/demo/directory', {
  useVideoGrading: true,
  model: 'gemini-2.0-flash',
  cleanupOnSuccess: false,
  cleanupOnError: true
})

console.log(`Score: ${gradeResult.score}`)
```

### Preparing Demo for Grading

```typescript
import { prepareDemoForGrading } from '../services/grading/cqaGradingService'
import { DemoStorageService } from '../demo-storage'

const storage = new DemoStorageService(objectStorage)
await prepareDemoForGrading(demoHash, '/tmp/grading/demo', storage)
```

## Environment Variables

The service respects the following environment variables:

- `CQA_PATH`: Explicit path to CQA binary or source file (optional, auto-detected if not set)
- `CQA_MODEL`: Model to use for grading (e.g., 'gemini-2.0-flash', 'gpt-4o')
- `USE_VIDEO_GRADING`: Enable/disable video-based grading (default: true)
- `OPENAI_API_KEY`: OpenAI API key for GPT models
- `GEMINI_API_KEY`: Google Gemini API key
- `ANTHROPIC_API_KEY`: Anthropic API key for Claude models

## CQA Path Detection

The service automatically detects the CQA path in the following order:

1. **Explicit override**: `process.env.CQA_PATH` if set
2. **Local development**: `../clones-quality-agent/src/index.ts` (runs with bun)
3. **Docker/production**: `/app/clones-quality-agent` (compiled binary)

This allows the same code to work seamlessly across:
- Local macOS development (using bun + TypeScript source)
- Docker development (using compiled binary)
- Production deployment (using compiled binary)

## Integration

This service is used by:

- **Upload processing** (`src/services/forge/processing.ts`): Grades demonstrations on upload
- **Migration scripts** (`scripts/migrate-grade-demos.ts`): Grades legacy demonstrations
- Any other service that needs to grade demonstrations

## Benefits

✅ **DRY**: Single source of truth for CQA grading logic  
✅ **Maintainable**: Changes to grading logic only need to be made once  
✅ **Consistent**: Same behavior across all use cases  
✅ **Testable**: Easy to test and mock  
✅ **Flexible**: Supports different environments and configurations

