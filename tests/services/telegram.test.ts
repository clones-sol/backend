import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import axios from 'axios'
import type { FactoryActivationNotification } from '../../src/types/telegram.js'

vi.mock('axios')
const mockedAxios = vi.mocked(axios, true)

describe('Telegram Service', () => {
  let originalEnv: NodeJS.ProcessEnv
  
  beforeEach(() => {
    originalEnv = { ...process.env }
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env = originalEnv
    vi.resetModules()
  })

  describe('Configuration', () => {
    it('should handle missing configuration gracefully', async () => {
      delete process.env.TELEGRAM_BOT_TOKEN
      delete process.env.TELEGRAM_CHANNEL_ID
      
      const { telegramService } = await import('../../src/services/telegram.js')
      
      expect(telegramService.getConfig()).toBeNull()
    })

    it('should initialize when configuration is present', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token'
      process.env.TELEGRAM_CHANNEL_ID = '-1001234567890'
      
      const { telegramService } = await import('../../src/services/telegram.js')
      
      const config = telegramService.getConfig()
      expect(config).not.toBeNull()
      expect(config?.botToken).toBe('test-bot-token')
      expect(config?.channelId).toBe('-1001234567890')
    })

    it('should include webhook secret when provided', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token'
      process.env.TELEGRAM_CHANNEL_ID = '-1001234567890'
      process.env.TELEGRAM_WEBHOOK_SECRET = 'webhook-secret'
      
      const { telegramService } = await import('../../src/services/telegram.js')
      
      const config = telegramService.getConfig()
      expect(config?.webhookSecret).toBe('webhook-secret')
    })
  })

  describe('Factory Activation Notifications', () => {
    const mockNotification: FactoryActivationNotification = {
      factoryId: '507f1f77bcf86cd799439011',
      factoryName: 'Test Factory',
      ownerAddress: '0x1234567890123456789012345678901234567890'
    }

    it('should skip notification when not configured', async () => {
      delete process.env.TELEGRAM_BOT_TOKEN
      delete process.env.TELEGRAM_CHANNEL_ID
      
      const { telegramService } = await import('../../src/services/telegram.js')
      
      const result = await telegramService.sendFactoryActivationNotification(mockNotification)
      
      expect(result).toBe(false)
      expect(mockedAxios.post).not.toHaveBeenCalled()
    })

    it('should send notification successfully when configured', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token'
      process.env.TELEGRAM_CHANNEL_ID = '-1001234567890'
      
      mockedAxios.post.mockResolvedValue({
        data: { ok: true, result: { message_id: 123 } }
      })
      
      const { telegramService } = await import('../../src/services/telegram.js')
      
      const result = await telegramService.sendFactoryActivationNotification(mockNotification)
      
      expect(result).toBe(true)
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest-bot-token/sendMessage',
        expect.objectContaining({
          chat_id: '-1001234567890',
          text: expect.stringContaining('Test Factory'),
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: true
        }),
        expect.objectContaining({
          timeout: 5000,
          headers: { 'Content-Type': 'application/json' }
        })
      )

      // Verify the message is one of the expected templates
      const sentMessage = (mockedAxios.post.mock.calls[0][1] as any).text as string
      const validTemplates = [
        '🎇 Boom! Factory',
        '💎 Factory',
        '🔥 Test Factory',
        '🛠️ A new Factory'
      ]
      const isValidTemplate = validTemplates.some(template => sentMessage.includes(template))
      expect(isValidTemplate).toBe(true)
    })

    it('should escape special characters in factory name', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token'
      process.env.TELEGRAM_CHANNEL_ID = '-1001234567890'
      
      mockedAxios.post.mockResolvedValue({
        data: { ok: true, result: { message_id: 123 } }
      })
      
      const notificationWithSpecialChars: FactoryActivationNotification = {
        factoryId: '507f1f77bcf86cd799439011',
        factoryName: 'Test_Factory-[DEMO]',
        ownerAddress: '0x1234567890123456789012345678901234567890'
      }
      
      const { telegramService } = await import('../../src/services/telegram.js')
      
      await telegramService.sendFactoryActivationNotification(notificationWithSpecialChars)
      
      // Verify special characters are escaped in the message
      const sentMessage = (mockedAxios.post.mock.calls[0][1] as any).text as string
      expect(sentMessage).toContain('Test\\_Factory\\-\\[DEMO\\]')
    })

    it('should handle Telegram API errors gracefully', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token'
      process.env.TELEGRAM_CHANNEL_ID = '-1001234567890'
      
      mockedAxios.post.mockResolvedValue({
        data: { ok: false, description: 'Bot was blocked by the user' }
      })
      
      const { telegramService } = await import('../../src/services/telegram.js')
      
      const result = await telegramService.sendFactoryActivationNotification(mockNotification)
      
      expect(result).toBe(false)
    })

    it('should handle network errors gracefully', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token'
      process.env.TELEGRAM_CHANNEL_ID = '-1001234567890'
      
      mockedAxios.post.mockRejectedValue(new Error('Network error'))
      
      const { telegramService } = await import('../../src/services/telegram.js')
      
      const result = await telegramService.sendFactoryActivationNotification(mockNotification)
      
      expect(result).toBe(false)
    })
  })

  describe('Connection Test', () => {
    it('should return false when not configured', async () => {
      delete process.env.TELEGRAM_BOT_TOKEN
      delete process.env.TELEGRAM_CHANNEL_ID
      
      const { telegramService } = await import('../../src/services/telegram.js')
      
      const result = await telegramService.testConnection()
      
      expect(result).toBe(false)
      expect(mockedAxios.get).not.toHaveBeenCalled()
    })

    it('should test connection successfully', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token'
      process.env.TELEGRAM_CHANNEL_ID = '-1001234567890'
      
      mockedAxios.get.mockResolvedValue({
        data: { ok: true, result: { id: 123456789, is_bot: true, first_name: 'Test Bot' } }
      })
      
      const { telegramService } = await import('../../src/services/telegram.js')
      
      const result = await telegramService.testConnection()
      
      expect(result).toBe(true)
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest-bot-token/getMe',
        { timeout: 5000 }
      )
    })

    it('should handle connection test failures', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'invalid-token'
      process.env.TELEGRAM_CHANNEL_ID = '-1001234567890'
      
      mockedAxios.get.mockRejectedValue(new Error('Unauthorized'))
      
      const { telegramService } = await import('../../src/services/telegram.js')
      
      const result = await telegramService.testConnection()
      
      expect(result).toBe(false)
    })
  })
})