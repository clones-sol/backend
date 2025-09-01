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
    const { messages, task_prompt, app } = req.body

    // Format context message
    const contextMessage = `Task: ${task_prompt}\nApp: ${app.name} (${app.type}${
      app.type === 'executable' ? `, Path: ${app.path}` : `, URL: ${app.url}`
    })`

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
                icon_url: {
                  type: 'string',
                  description: "URL for the app's favicon"
                },
                objectives: {
                  type: 'array',
                  description:
                    'List of 4 objectives to complete the task (first objective must be opening/navigating to the app with the app name wrapped in <app> tags, stop at checkout for purchases)',
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
