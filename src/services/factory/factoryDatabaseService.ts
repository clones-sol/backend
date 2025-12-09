import { randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import { FactoryModel } from '../../models/Factory.ts'
import type { FactoryApp, TaskApp, WorkflowTask } from '../../types/factory.ts'
import { APP_TASK_GENERATION_PROMPT, SYSTEM_PROMPT, TASK_SHOT_EXAMPLES } from '../forge/index.ts'
import { logger } from "../logger.ts"

// Configure OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// Track active generations to prevent duplicates
const activeGenerations = new Map<string, Promise<void>>()

/**
 * Generate objectives for a specific task using OpenAI
 */
export async function generateObjectivesForTask(
  taskPrompt: string,
  appsUsed: TaskApp[]
): Promise<string[]> {
  try {
    let contextMessage = `Task: ${taskPrompt}\n`

    if (appsUsed.length > 1) {
      const appsList = appsUsed
        .map((app) => `${app.name} (${app.domain === 'desktop' ? 'desktop app' : `web: ${app.domain}`})`)
        .join(', ')
      contextMessage += `Apps: ${appsList}`
    } else if (appsUsed.length === 1) {
      const app = appsUsed[0]
      contextMessage += `App: ${app.name} (${app.domain === 'desktop' ? 'desktop app' : `web: ${app.domain}`})`
    }

    const randomExamples = [...TASK_SHOT_EXAMPLES].sort(() => Math.random() - 0.5).slice(0, 3)

    const apiMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...randomExamples.flatMap((example) => example.conversation),
      { role: 'user', content: contextMessage }
    ]

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: apiMessages as any,
      tools: [
        {
          type: 'function',
          function: {
            name: 'validate_task_request',
            description: "Validate if the user's task request is appropriate and can be assisted with",
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
                  description: `List of around ${appsUsed.length * 2 + 2} objectives to complete this ${appsUsed.length > 1 ? 'multi-app workflow' : 'single-app'} task. For multi-app workflows, include objectives for navigating between applications, data transfer, and context switching. Each app should have at least 2-3 objectives. Wrap app names in <app> tags. Stop at checkout for purchases.`,
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
    })

    const assistantMessage = response.choices[0].message

    if (assistantMessage.tool_calls?.[0]?.type === 'function') {
      const toolCall = assistantMessage.tool_calls[0]
      const args = JSON.parse(toolCall.function.arguments)
      return args.objectives || []
    }

    return []
  } catch (error) {
    logger.error('Error generating objectives:', error)
    return []
  }
}

/**
 * Generate apps for a factory using OpenAI
 */
export async function generateAppsForFactory(factoryId: string, skills: string[]): Promise<void> {
  // Cancel existing generation
  const existingPromise = activeGenerations.get(factoryId)
  if (existingPromise) {
    logger.info(`Canceling existing app generation for factory ${factoryId}`)
    activeGenerations.delete(factoryId)
  }

  // Start new generation
  const generationPromise = executeGeneration(factoryId, skills)
  activeGenerations.set(factoryId, generationPromise)

  return generationPromise
}

async function executeGeneration(factoryId: string, skills: string[]): Promise<void> {
  try {
    const factory = await FactoryModel.findById(factoryId)
    if (!factory) {
      throw new Error(`Factory ${factoryId} not found`)
    }

    // Generate apps using OpenAI
    const skillsText = skills.join(', ')
    const prompt = APP_TASK_GENERATION_PROMPT.replace('{skill list}', skillsText)

    const response = await openai.chat.completions.create({
      model: 'o3-mini',
      reasoning_effort: 'medium',
      messages: [{ role: 'user', content: prompt }]
    } as any)

    const content = response.choices[0].message.content
    if (!content) {
      throw new Error('Empty response from OpenAI')
    }

    // Parse and process response
    const generatedContent = JSON.parse(content)

    // Create apps from generated content
    const apps: FactoryApp[] = (generatedContent.apps || []).map((app: any) => ({
      id: app.id || randomUUID(),
      name: app.name || 'Untitled App',
      domain: app.domain || 'general',
      description: app.description,
      categories: app.categories || [],
      tasks: (app.tasks || []).map((task: any) => ({
        id: task.id || randomUUID(),
        prompt: task.prompt || 'Complete the task',
        uploadLimit: task.uploadLimit,
        rewardLimit: task.rewardLimit
      }))
    }))

    // Update factory with generated apps
    const updatedFactory = await FactoryModel.findByIdAndUpdate(
      factoryId,
      {
        $set: {
          apps: apps,
          updatedAt: new Date()
        }
      },
      { new: true }
    )

    if (!updatedFactory) {
      throw new Error(`Failed to update factory ${factoryId}`)
    }
  } catch (error) {
    const err = error as Error
    logger.error('Error generating apps:', err)
    throw err
  } finally {
    // Clean up
    activeGenerations.delete(factoryId)
  }
}

/**
 * Create factory
 */
export async function createFactory(
  poolAddress: string,
  creatorAddress: string,
  name: string,
  skills: string[],
  tasks: any[],
  token: any,
  referrerAddress?: string
): Promise<any> {
  const factoryId = `factory_${poolAddress}`

  const tasksWithIdsAndObjectives = await Promise.all(
    tasks.map(async (task) => {
      const objectives = await generateObjectivesForTask(task.prompt, task.apps_used || [])
      return {
        ...task,
        id: randomUUID(),
        objectives
      }
    })
  )

  const factory = new FactoryModel({
    _id: factoryId,
    poolAddress,
    name,
    description: `Factory for ${name}`,
    ownerAddress: creatorAddress,
    referrerAddress,
    status: 'paused',
    skills,
    token,
    tasks: tasksWithIdsAndObjectives,
    createdAt: new Date(),
    updatedAt: new Date()
  })

  await factory.save()

  return factory
}
