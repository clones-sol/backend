import express from 'express'
import { body, param, query, validationResult } from 'express-validator'
import { FactoryModel } from '../../models/Factory.ts'
import { GraphQLService } from '../../services/blockchain/graphqlService.js'
import { logger } from "../../services/logger.ts"

const router = express.Router()
const _graphqlService = new GraphQLService()

interface ValidationResult {
  valid: boolean
  duplicates?: boolean
  containsSkills?: boolean
  containsRelevantTerms?: boolean
}

function validateSkills(skills: string[]): { result: ValidationResult; warnings: string[] } {
  const result = {
    valid: skills.every((skill: string) => typeof skill === 'string' && skill.length >= 2),
    duplicates: skills.length !== new Set(skills.map((s: string) => s.toLowerCase())).size
  }
  const warnings = result.duplicates ? ['Duplicate skills detected'] : []
  return { result, warnings }
}

function validateName(
  name: string,
  skills?: string[]
): { result: ValidationResult; warnings: string[] } {
  const result = {
    valid: name.length >= 3 && name.length <= 100,
    containsSkills: skills
      ? skills.some((skill: string) => name.toLowerCase().includes(skill.toLowerCase()))
      : false
  }
  const warnings = skills && !result.containsSkills ? ['Name does not contain any skills'] : []
  return { result, warnings }
}

function validateDescription(
  description: string,
  skills?: string[]
): { result: ValidationResult; warnings: string[] } {
  const result = {
    valid: description.length >= 10 && description.length <= 500,
    containsRelevantTerms: [...(skills || [])].some((term: string) =>
      description.toLowerCase().includes(term.toLowerCase())
    )
  }
  const warnings =
    skills && !result.containsRelevantTerms ? ['Description does not contain skills'] : []
  return { result, warnings }
}

function validateMetadataSemantics(
  skills: string[],
  name: string,
  description: string
): {
  validationResults: Record<string, ValidationResult>
  warnings: string[]
} {
  const validationResults: Record<string, ValidationResult> = {}
  const allWarnings: string[] = []

  if (skills) {
    const skillsValidation = validateSkills(skills)
    validationResults.skills = skillsValidation.result
    allWarnings.push(...skillsValidation.warnings)
  }

  if (name) {
    const nameValidation = validateName(name, skills)
    validationResults.name = nameValidation.result
    allWarnings.push(...nameValidation.warnings)
  }

  if (description) {
    const descValidation = validateDescription(description, skills)
    validationResults.description = descValidation.result
    allWarnings.push(...descValidation.warnings)
  }

  return { validationResults, warnings: allWarnings }
}

/**
 * @swagger
 * tags:
 *   name: ForgeMetadata
 *   description: Pool metadata management
 */

/**
 * @swagger
 * /forge/metadata/update:
 *   post:
 *     summary: Update pool metadata
 *     tags: [ForgeMetadata]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               poolAddress:
 *                 type: string
 *                 format: "hex"
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               skills:
 *                 type: array
 *                 items:
 *                   type: string
 *               creator:
 *                 type: string
 *                 format: "hex"
 *     responses:
 *       '200':
 *         description: Metadata uploaded successfully.
 *       '400':
 *         description: Validation failed.
 *       '500':
 *         description: Metadata update failed.
 */
router.post(
  '/update',
  // Validation middleware
  [
    body('poolAddress').isEthereumAddress().withMessage('Invalid pool address'),
    body('name')
      .optional()
      .isLength({ min: 3, max: 100 })
      .withMessage('Name must be 3-100 characters'),
    body('description')
      .optional()
      .isLength({ min: 10, max: 500 })
      .withMessage('Description must be 10-500 characters'),
    body('skills')
      .optional()
      .isArray({ min: 1, max: 10 })
      .withMessage('Skills must be array of 1-10 items'),
    body('skills.*').isLength({ min: 2, max: 50 }).withMessage('Each skill must be 2-50 characters')
  ],
  async (req: express.Request, res: express.Response) => {
    try {
      // Check validation errors
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array()
        })
      }

      const { poolAddress, name, description, skills } = req.body

      // Find the pool to update
      const factory = await FactoryModel.findOne({ poolAddress })
      if (!factory) {
        return res.status(404).json({
          error: 'Factory not found',
          poolAddress
        })
      }

      const generateSearchString = (desc: string, skillsArr: string[]): string => {
        const searchParts: string[] = []
        if (desc) searchParts.push(desc.toLowerCase())
        for (const skill of skillsArr) {
          searchParts.push(skill.toLowerCase())
        }
        return searchParts.join(' ')
      }

      const updateFields: Record<string, unknown> = {}
      if (name !== undefined) updateFields.name = name
      if (description !== undefined) updateFields.description = description
      if (skills !== undefined) updateFields.skillsArray = skills

      if (description !== undefined || skills !== undefined) {
        const finalDescription = description ?? factory.description ?? ''
        const finalSkills = skills ?? factory.skills ?? []

        updateFields.searchString = generateSearchString(finalDescription, finalSkills)
      }

      const updatedPool = await FactoryModel.findOneAndUpdate(
        { poolAddress },
        { $set: updateFields },
        { new: true }
      )

      res.json({
        success: true,
        data: {
          poolAddress,
          name: updatedPool?.name,
          description: updatedPool?.description,
          skills: updatedPool?.skills,
          updatedAt: new Date().toISOString()
        }
      })
    } catch (error) {
      logger.error('Failed to update pool metadata:', error)
      res.status(500).json({
        error: 'Failed to update metadata',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
)

/**
 * @swagger
 * /forge/metadata/pool/{poolAddress}:
 *   get:
 *     summary: Get pool metadata
 *     tags: [ForgeMetadata]
 *     parameters:
 *       - in: path
 *         name: poolAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: The pool address.
 *     responses:
 *       '200':
 *         description: Metadata retrieved successfully.
 *       '404':
 *         description: Factory not found.
 *       '500':
 *         description: Database retrieval failed.
 */
router.get(
  '/pool/:poolAddress',
  [param('poolAddress').isEthereumAddress().withMessage('Invalid pool address format')],
  async (req: express.Request, res: express.Response) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Invalid pool address',
          details: errors.array()
        })
      }

      const { poolAddress } = req.params
      const factory = await FactoryModel.findOne({ poolAddress })

      if (!factory) {
        return res.status(404).json({
          error: 'Factory not found',
          poolAddress
        })
      }

      res.json({
        success: true,
        data: {
          poolAddress: factory.poolAddress,
          name: factory.name,
          description: factory.description,
          skills: factory.skills,
          searchString: factory.searchText,
          createdAt: factory.createdAt,
          updatedAt: factory.updatedAt
        }
      })
    } catch (error) {
      logger.error('Failed to retrieve pool metadata:', error)
      res.status(500).json({
        error: 'Failed to retrieve metadata from database',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
)

/**
 * @swagger
 * /forge/metadata/pools:
 *   get:
 *     summary: Get all pools with metadata
 *     tags: [ForgeMetadata]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           minimum: 1
 *           maximum: 100
 *         description: Number of pools to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *           minimum: 0
 *         description: Number of pools to skip
 *     responses:
 *       '200':
 *         description: Pools retrieved successfully.
 *       '500':
 *         description: Database retrieval failed.
 */
router.get(
  '/pools',
  [
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
    query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative')
  ],
  async (req: express.Request, res: express.Response) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array()
        })
      }

      const limit = parseInt(req.query.limit as string, 10) || 20
      const offset = parseInt(req.query.offset as string, 10) || 0

      const pools = await FactoryModel.find({})
        .select('poolAddress name description skillsArray searchString createdAt updatedAt')
        .skip(offset)
        .limit(limit)
        .sort({ createdAt: -1 })

      const total = await FactoryModel.countDocuments({})

      res.json({
        success: true,
        data: {
          pools: pools.map((pool) => ({
            poolAddress: pool.poolAddress,
            name: pool.name,
            description: pool.description,
            skills: pool.skills,
            createdAt: pool.createdAt,
            updatedAt: pool.updatedAt
          })),
          pagination: {
            total,
            limit,
            offset,
            hasMore: offset + limit < total
          }
        }
      })
    } catch (error) {
      logger.error('Failed to retrieve pools:', error)
      res.status(500).json({
        error: 'Failed to retrieve pools from database',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
)

/**
 * @swagger
 * /forge/metadata/search:
 *   post:
 *     summary: Search pools by metadata criteria
 *     tags: [ForgeMetadata]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               skills:
 *                 type: array
 *                 items:
 *                   type: string
 *               searchTerm:
 *                 type: string
 *     responses:
 *       '200':
 *         description: Search results returned.
 *       '500':
 *         description: Search failed.
 */
router.post(
  '/search',
  [
    body('skills')
      .optional()
      .isArray({ max: 10 })
      .withMessage('Skills must be array of max 10 items'),
    body('searchTerm')
      .optional()
      .isLength({ min: 2, max: 100 })
      .withMessage('Search term must be 2-100 characters'),
    body('category')
      .optional()
      .isLength({ min: 2, max: 50 })
      .withMessage('Category must be 2-50 characters'),
    body('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
    body('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative')
  ],
  async (req: express.Request, res: express.Response) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array()
        })
      }

      const { skills, searchTerm, category, limit = 20, offset = 0 } = req.body

      const query: Record<string, unknown> = {}
      const andConditions = []

      if (skills && skills.length > 0) {
        andConditions.push({ skillsArray: { $in: skills } })
      }

      if (searchTerm) {
        andConditions.push({
          $or: [
            { searchString: { $regex: searchTerm, $options: 'i' } },
            { name: { $regex: searchTerm, $options: 'i' } },
            { description: { $regex: searchTerm, $options: 'i' } }
          ]
        })
      }

      if (andConditions.length > 0) {
        query.$and = andConditions
      }

      const pools = await FactoryModel.find(query)
        .select(
          'poolAddress name description skills tags totalEarned createdAt updatedAt'
        )
        .skip(offset)
        .limit(limit)
        .sort({ createdAt: -1 })

      const total = await FactoryModel.countDocuments(query)

      res.json({
        success: true,
        data: {
          pools: pools.map((pool) => ({
            poolAddress: pool.poolAddress,
            name: pool.name,
            description: pool.description,
            skills: pool.skills,
            totalEarned: pool.totalEarned,
            createdAt: pool.createdAt,
            updatedAt: pool.updatedAt
          })),
          pagination: {
            total,
            limit,
            offset,
            hasMore: offset + limit < total
          },
          filters: {
            skills,
            searchTerm,
            category
          },
          searchedAt: new Date().toISOString()
        }
      })
    } catch (error) {
      logger.error('Failed to search pools by metadata:', error)
      res.status(500).json({
        error: 'Failed to search pools',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
)

/**
 * @swagger
 * /forge/metadata/health:
 *   get:
 *     summary: Check database connection health
 *     tags: [ForgeMetadata]
 *     responses:
 *       '200':
 *         description: Service is healthy.
 *       '500':
 *         description: Service is unhealthy.
 */
router.get('/health', async (_req: express.Request, res: express.Response) => {
  try {
    const poolCount = await FactoryModel.countDocuments({})

    res.status(200).json({
      success: true,
      data: {
        status: 'healthy',
        message: 'MongoDB connection successful',
        poolCount,
        database: 'Database'
      },
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('Health check failed:', error)
    res.status(500).json({
      success: false,
      data: {
        status: 'unhealthy',
        message: `Database connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      },
      timestamp: new Date().toISOString()
    })
  }
})

/**
 * @swagger
 * /forge/metadata/validate:
 *   post:
 *     summary: Validate metadata structure before update
 *     tags: [ForgeMetadata]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               skills:
 *                 type: array
 *                 items:
 *                   type: string
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       '200':
 *         description: Validation result returned.
 *       '400':
 *         description: Basic validation failed.
 *       '500':
 *         description: Internal validation error.
 */
router.post(
  '/validate',
  [
    body('skills')
      .optional()
      .isArray({ min: 1, max: 10 })
      .withMessage('Skills must be array of 1-10 items'),
    body('name')
      .optional()
      .isLength({ min: 3, max: 100 })
      .withMessage('Name must be 3-100 characters'),
    body('description')
      .optional()
      .isLength({ min: 10, max: 500 })
      .withMessage('Description must be 10-500 characters')
  ],
  async (req: express.Request, res: express.Response) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        })
      }

      const { skills, name, description } = req.body
      const { validationResults, warnings } = validateMetadataSemantics(skills, name, description)
      const isValid = Object.values(validationResults).every((result) => result.valid)

      res.json({
        success: true,
        data: {
          valid: isValid,
          validationResults,
          warnings,
          metadata: {
            estimatedCategory: 'general'
          }
        }
      })
    } catch (error) {
      logger.error('Failed to validate metadata:', error)
      res.status(500).json({
        success: false,
        error: 'Validation failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
)

export default router
