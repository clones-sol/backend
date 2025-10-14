import { randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import { FactoryModel } from '../../models/Factory.ts'
import type { FactoryApp } from '../../types/factory.ts'
import { APP_TASK_GENERATION_PROMPT } from '../forge/index.ts'

// Configure OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// Track active generations to prevent duplicates
const activeGenerations = new Map<string, Promise<void>>()

/**
 * Generate apps for a factory using OpenAI
 */
export async function generateAppsForFactory(factoryId: string, skills: string[]): Promise<void> {
  // Cancel existing generation
  const existingPromise = activeGenerations.get(factoryId)
  if (existingPromise) {
    console.log(`Canceling existing app generation for factory ${factoryId}`)
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
    console.error('Error generating apps:', err)
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
  apps: FactoryApp[],
  token: any,
  pricePerDemo: number
): Promise<any> {
  // Create factory document
  const factoryId = `factory_${poolAddress}`

  // Generate IDs for apps and their tasks
  const appsWithIds = apps.map(app => ({
    ...app,
    id: randomUUID(),
    tasks: (app.tasks || []).map(task => ({
      ...task,
      id: randomUUID()
    }))
  }))

  const factory = new FactoryModel({
    _id: factoryId,
    poolAddress,
    name,
    description: `Factory for ${name}`,
    ownerAddress: creatorAddress,
    status: 'paused',
    skills,
    token,
    pricePerDemo,
    apps: appsWithIds,
    createdAt: new Date(),
    updatedAt: new Date()
  })

  await factory.save()

  return factory
}
