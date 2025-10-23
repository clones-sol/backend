import axios from 'axios'
import type {
  TelegramConfig,
  TelegramMessage,
  TelegramResponse,
  FactoryActivationNotification
} from '../types/telegram.js'

class TelegramService {
  private config: TelegramConfig | null = null
  private baseUrl: string | null = null

  constructor() {
    this.initializeConfig()
  }

  private initializeConfig(): void {
    const botToken = process.env.TELEGRAM_BOT_TOKEN
    const channelId = process.env.TELEGRAM_CHANNEL_ID
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET

    if (!botToken || !channelId) {
      console.debug('Telegram configuration not found. Notifications will be skipped.')
      return
    }

    this.config = {
      botToken,
      channelId,
      webhookSecret
    }

    this.baseUrl = `https://api.telegram.org/bot${botToken}`
    console.log('Telegram service initialized successfully')
  }

  private isConfigured(): boolean {
    return this.config !== null && this.baseUrl !== null
  }

  private escapeMarkdown(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&')
  }

  private getRandomActivationMessage(factoryName: string): string {
    const templates = [
      // Option 1 — Style hype/epic
      `🎇 Boom! Factory '${factoryName}' is live!
The Forge has just unlocked a new playground for human expertise. Contributors: dive in, record your skills, and turn your actions into valuable AI training data — and rewards await! 🚀`,

      // Option 2 — Style action/reward
      `💎 Factory '${factoryName}' just opened!
Every click counts. Every workflow you demonstrate builds tradeable, revenue-generating datasets. Start earning $CLONES/$ETH/$USDC while shaping the future of AI! 💥`,

      // Option 3 — Style exclusive/network
      `🔥 ${factoryName} is now active!
Early contributors get the first chance to shape a dataset that will be tokenized and monetized. Don't miss your spot in this next-gen AI economy. 💸✨`,

      // Option 4 — Style storytelling
      `🛠️ A new Factory '${factoryName}' has just come online!
Your skills + your clicks = AI that actually does stuff. Record, earn, and watch your expertise turn into real, liquid value. The Forge is waiting. 🔥`
    ]

    const randomIndex = Math.floor(Math.random() * templates.length)
    return templates[randomIndex]
  }

  private formatFactoryActivationMessage(notification: FactoryActivationNotification): string {
    const factoryName = this.escapeMarkdown(notification.factoryName)
    return this.getRandomActivationMessage(factoryName)
  }

  async sendFactoryActivationNotification(notification: FactoryActivationNotification): Promise<boolean> {
    if (!this.isConfigured()) {
      console.debug('Telegram not configured, skipping factory activation notification')
      return false
    }

    try {
      const message: TelegramMessage = {
        chat_id: this.config!.channelId,
        text: this.formatFactoryActivationMessage(notification),
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true
      }

      const response = await axios.post<TelegramResponse>(
        `${this.baseUrl}/sendMessage`,
        message,
        {
          timeout: 5000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )

      if (response.data.ok) {
        console.log(`Factory activation notification sent successfully for factory: ${notification.factoryName}`)
        return true
      } else {
        console.error('Telegram API error:', response.data.description)
        return false
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('Failed to send Telegram notification:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data
        })
      } else {
        console.error('Unexpected error sending Telegram notification:', error)
      }
      return false
    }
  }

  async testConnection(): Promise<boolean> {
    if (!this.isConfigured()) {
      console.debug('Telegram not configured, cannot test connection')
      return false
    }

    try {
      const response = await axios.get<TelegramResponse>(
        `${this.baseUrl}/getMe`,
        { timeout: 5000 }
      )

      if (response.data.ok) {
        console.log('Telegram bot connection test successful')
        return true
      } else {
        console.error('Telegram bot connection test failed:', response.data.description)
        return false
      }
    } catch (error) {
      console.error('Telegram connection test error:', error)
      return false
    }
  }

  getConfig(): TelegramConfig | null {
    return this.config
  }
}

export const telegramService = new TelegramService()
export default telegramService