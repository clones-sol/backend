const router: Router = express.Router()

import express, { type Request, type Response, type Router } from 'express'
import OpenAI from 'openai'
import { errorHandlerAsync } from '../../middleware/errorHandler.ts'
import { successResponse } from '../../middleware/types/errors.ts'
import { validateBody } from '../../middleware/validator.ts'
import { SYSTEM_PROMPT, TASK_SHOT_EXAMPLES } from '../../services/forge/index.ts'

import { chatRequestSchema } from '../schemas/chat.ts'

interface OpenAIToolFunction {
  name: string
  description: string
  parameters: {
    type: 'object'
    required: string[]
    properties: Record<
      string,
      {
        type: string
        description: string
        items?: { type: string }
      }
    >
  }
}

interface OpenAIChatCompletionParams {
  model: string
  messages: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string
  }>
  tools: Array<{
    type: 'function'
    function: OpenAIToolFunction
  }>
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// Sample few-shot conversation history
// Add route to router
router.post(
  '/',
  validateBody(chatRequestSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { messages, task_prompt, apps_used, app } = req.body

    // Support both new multi-app format and legacy single-app format
    const appsToUse = apps_used || (app ? [app] : [])

    // Format context message with multiple apps
    let contextMessage = `Task: ${task_prompt}\n`

    if (appsToUse.length > 1) {
      // Multi-app workflow
      const appsList = appsToUse.map((appItem: any) =>
        `${appItem.name} (${appItem.domain === 'desktop' ? 'desktop app' : `web: ${appItem.domain}`})`
      ).join(', ')
      contextMessage += `Apps: ${appsList}`
    } else if (appsToUse.length === 1) {
      // Single app (legacy format or single-app workflow)
      const appItem = appsToUse[0]
      if (appItem.type) {
        // Legacy format
        contextMessage += `App: ${appItem.name} (${appItem.type}${appItem.type === 'executable' ? `, Path: ${appItem.path}` : `, URL: ${appItem.url}`
          })`
      } else {
        // New format
        contextMessage += `App: ${appItem.name} (${appItem.domain === 'desktop' ? 'desktop app' : `web: ${appItem.domain}`})`
      }
    }

    // Randomly select 3 few-shot examples
    const randomExamples = [...TASK_SHOT_EXAMPLES].sort(() => Math.random() - 0.5).slice(0, 3)

    // Prepare messages for OpenAI API
    const apiMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      // Include all three random examples
      ...randomExamples.flatMap((example) => example.conversation),
      { role: 'user', content: contextMessage },
      ...messages
    ]

    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      // biome-ignore lint/suspicious/noExplicitAny: The `apiMessages` array is dynamically constructed and includes system, user, and few-shot example messages, making its type complex to align perfectly with the OpenAI SDK's expected type.
      messages: apiMessages as any,
      tools: [
        {
          type: 'function',
          function: {
            name: 'validate_task_request',
            description:
              "Validate if the user's task request is appropriate and can be assisted with",
            parameters: {
              type: 'object',
              required: ['title', 'app', 'objectives', 'content'],
              properties: {
                title: {
                  type: 'string',
                  description: 'Brief title for the task'
                },
                app: {
                  type: 'string',
                  description: 'Name of the app being used'
                },
                objectives: {
                  type: 'array',
                  description:
                    `List of around ${appsToUse.length * 2 + 2} objectives to complete this ${appsToUse.length > 1 ? 'multi-app workflow' : 'single-app'} task. For multi-app workflows, include objectives for navigating between applications, data transfer, and context switching. Each app should have at least 2-3 objectives. Wrap app names in <app> tags and wrap app. Stop at checkout for purchases.`,
                  items: {
                    type: 'string'
                  }
                },
                content: {
                  type: 'string',
                  description: "The assistant's message to the user"
                }
              }
            }
          }
        }
      ]
    } satisfies OpenAIChatCompletionParams)

    const assistantMessage = response.choices[0].message

    // Handle tool calls if present
    if (assistantMessage.tool_calls?.[0]?.type === 'function') {
      const toolCall = assistantMessage.tool_calls[0]
      // Add tool call to response
      res.status(200).json(
        successResponse({
          role: 'assistant',
          content: assistantMessage.content,
          tool_calls: [toolCall]
        })
      )
    } else {
      // Return regular message
      res.status(200).json(
        successResponse({
          role: 'assistant',
          content: assistantMessage.content
        })
      )
    }
  })
)

export { router as forgeChatApi }
