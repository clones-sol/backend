import { ValidationRules, type ValidationSchema } from '../../middleware/validator.ts'

export const updateFactoryAppsSchema: ValidationSchema = {
  apps: {
    required: true,
    rules: [
      ValidationRules.isArray(),
      ValidationRules.arrayMinLength(1),
      ValidationRules.customValidator(
        (value) => {
          if (!Array.isArray(value)) return false
          return value.every((app) => {
            // Required fields
            if (typeof app !== 'object' || app === null) return false
            if (typeof app.name !== 'string' || app.name.length < 1 || app.name.length > 100) return false
            if (typeof app.domain !== 'string' || app.domain.length < 1 || app.domain.length > 200) return false
            if (!Array.isArray(app.categories)) return false
            if (!app.categories.every((cat: any) => typeof cat === 'string')) return false
            if (!Array.isArray(app.tasks) || app.tasks.length < 1) return false

            // Optional fields
            if (app.description !== undefined && (typeof app.description !== 'string' || app.description.length > 1000)) return false

            // Validate tasks
            return app.tasks.every((task: any) => {
              if (typeof task !== 'object' || task === null) return false
              if (typeof task.prompt !== 'string' || task.prompt.length < 1 || task.prompt.length > 2000) return false
              if (task.uploadLimit !== undefined && task.uploadLimit !== null && (typeof task.uploadLimit !== 'number' || task.uploadLimit < 1)) return false
              if (task.rewardLimit !== undefined && task.rewardLimit !== null && (typeof task.rewardLimit !== 'number' || task.rewardLimit <= 0)) return false
              return true
            })
          })
        },
        'Invalid app structure: check required fields (name, domain, categories, tasks) and data types'
      )
    ]
  }
}

// Schema for updating factory workflow tasks
export const updateFactoryWorkflowsSchema: ValidationSchema = {
  tasks: {
    required: true,
    rules: [
      ValidationRules.isArray(),
      ValidationRules.arrayMinLength(1),
      ValidationRules.customValidator(
        (value) => {
          if (!Array.isArray(value)) return false
          return value.every((task) => {
            // Required fields
            if (typeof task !== 'object' || task === null) return false
            if (typeof task.prompt !== 'string' || task.prompt.length < 1 || task.prompt.length > 2000) return false
            if (!Array.isArray(task.categories)) return false
            if (!task.categories.every((cat: any) => typeof cat === 'string')) return false
            if (!Array.isArray(task.apps_used) || task.apps_used.length < 1) return false
            if (typeof task.task_name !== 'string' || task.task_name.length < 1 || task.task_name.length > 100) return false

            // Optional fields
            if (task.uploadLimit !== undefined && task.uploadLimit !== null && (typeof task.uploadLimit !== 'number' || task.uploadLimit < 1)) return false
            if (task.rewardLimit !== undefined && task.rewardLimit !== null && (typeof task.rewardLimit !== 'number' || task.rewardLimit <= 0)) return false

            // Validate apps_used
            return task.apps_used.every((app: any) => {
              if (typeof app !== 'object' || app === null) return false
              if (typeof app.name !== 'string' || app.name.length < 1 || app.name.length > 100) return false
              if (typeof app.domain !== 'string' || app.domain.length < 1 || app.domain.length > 200) return false
              if (typeof app.description !== 'string' || app.description.length > 500) return false
              return true
            })
          })
        },
        'Invalid task structure: check required fields (prompt, categories, apps_used, task_name) and data types'
      )
    ]
  }
}

export const factoryIdParamSchema: ValidationSchema = {
  id: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  }
}