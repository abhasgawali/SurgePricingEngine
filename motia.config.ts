import { defineConfig } from '@motiadev/core'
import endpointPlugin from '@motiadev/plugin-endpoint/plugin'
import logsPlugin from '@motiadev/plugin-logs/plugin'
import observabilityPlugin from '@motiadev/plugin-observability/plugin'
import statesPlugin from '@motiadev/plugin-states/plugin'
import bullmqPlugin from '@motiadev/plugin-bullmq/plugin'
import { validateEnvironment } from './src/utils/env.validation.js'

// Validate environment variables at startup
const envValidation = validateEnvironment()
if (!envValidation.isValid) {
  console.warn('⚠️  Environment validation failed. Some features may not work correctly.')
}

export default defineConfig({
  plugins: [observabilityPlugin, statesPlugin, endpointPlugin, logsPlugin, bullmqPlugin],
  app: (app) => {
    // Add health check endpoint
    app.get('/health', (_req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: {
          hasGroqKey: !!process.env.GROQ_API_KEY,
          groqModel: process.env.GROQ_MODEL || 'llama-3.1-70b-versatile'
        }
      })
    })
  }
})
