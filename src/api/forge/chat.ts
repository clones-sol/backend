const router: Router = express.Router()

import express, { type Request, type Response, type Router } from 'express'
import OpenAI from 'openai'
import { errorHandlerAsync } from '../../middleware/errorHandler.ts'
import { ApiError, successResponse } from '../../middleware/types/errors.ts'
import { validateBody } from '../../middleware/validator.ts'
import { SYSTEM_PROMPT, TASK_SHOT_EXAMPLES } from '../../services/forge/index.ts'
import { FactoryModel } from '../../models/Factory.ts'

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

router.post(
  '/',
  validateBody(chatRequestSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { messages, task_prompt, apps_used, app, factory_id, task_id } = req.body

    const appsToUse = apps_used || (app ? [app] : [])

    let existingObjectives: string[] | null = null

    if (factory_id && task_id) {
      const factory = await FactoryModel.findById(factory_id)
      if (!factory) {
        throw ApiError.notFound('Factory not found')
      }

      const task = factory.tasks.find((t) => t.id === task_id)
      if (!task) {
        throw ApiError.notFound('Task not found in factory')
      }

      if (task.objectives && task.objectives.length > 0) {
        existingObjectives = task.objectives
      }
    }

    let contextMessage = `Task: ${task_prompt}\n`

    if (appsToUse.length > 1) {
      const appsList = appsToUse.map((appItem: any) =>
        `${appItem.name} (${appItem.domain === 'desktop' ? 'desktop app' : `web: ${appItem.domain}`})`
      ).join(', ')
      contextMessage += `Apps: ${appsList}`
    } else if (appsToUse.length === 1) {
      const appItem = appsToUse[0]
      if (appItem.type) {
        contextMessage += `App: ${appItem.name} (${appItem.type}${appItem.type === 'executable' ? `, Path: ${appItem.path}` : `, URL: ${appItem.url}`
          })`
      } else {
        contextMessage += `App: ${appItem.name} (${appItem.domain === 'desktop' ? 'desktop app' : `web: ${appItem.domain}`})`
      }
    }

    if (existingObjectives) {
      const appName = appsToUse.length > 0 ? appsToUse.map((a: any) => a.name).join(', ') : 'the app'

      const toolCall = {
        id: 'call_cached',
        type: 'function' as const,
        function: {
          name: 'validate_task_request',
          arguments: JSON.stringify({
            title: task_prompt,
            app: appName,
            objectives: existingObjectives,
            content: `Hi! I need help with: ${task_prompt}`
          })
        }
      }

      res.status(200).json(
        successResponse({
          role: 'assistant',
          content: null,
          tool_calls: [toolCall]
        })
      )
      return
    }

    const randomExamples = [...TASK_SHOT_EXAMPLES].sort(() => Math.random() - 0.5).slice(0, 3)

    const apiMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...randomExamples.flatMap((example) => example.conversation),
      { role: 'user', content: contextMessage },
      ...messages
    ]

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
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
                    `List of around ${appsToUse.length * 2 + 2} objectives to complete this ${appsToUse.length > 1 ? 'multi-app workflow' : 'single-app'} task. For multi-app workflows, include objectives for navigating between applications, data transfer, and context switching. Each app should have at least 2-3 objectives. Wrap app names in <app> tags. Stop at checkout for purchases.`,
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

    if (assistantMessage.tool_calls?.[0]?.type === 'function') {
      const toolCall = assistantMessage.tool_calls[0]
      res.status(200).json(
        successResponse({
          role: 'assistant',
          content: assistantMessage.content,
          tool_calls: [toolCall]
        })
      )
    } else {
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
