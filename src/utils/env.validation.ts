/**
 * Environment variable validation utility
 * Validates required environment variables at startup
 */

export function validateEnvironment() {
  const errors: string[] = []

  // Optional but recommended
  if (!process.env.GROQ_API_KEY) {
    errors.push('GROQ_API_KEY is not set - Pricing Agent will not function')
  }

  // Optional - defaults to 'llama-3.1-70b-versatile'
  const model = process.env.GROQ_MODEL || 'llama-3.1-70b-versatile'
  if (model && typeof model !== 'string') {
    errors.push('GROQ_MODEL must be a string')
  }

  if (errors.length > 0) {
    console.warn('⚠️  Environment Validation Warnings:')
    errors.forEach((error) => console.warn(`  - ${error}`))
    console.warn('  Some features may not work correctly.\n')
  }

  return {
    isValid: errors.length === 0,
    errors,
    config: {
      groqApiKey: process.env.GROQ_API_KEY,
      groqModel: model
    }
  }
}

