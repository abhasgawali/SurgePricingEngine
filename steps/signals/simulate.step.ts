import { ApiRouteConfig, Handlers } from 'motia'
import { z } from 'zod'
import { coreMiddleware } from '../../middlewares/core.middleware'

const SimulateSignalSchema = z.object({
  type: z.enum(['demand_surge', 'competitor_price', 'stock_drop', 'stock_increase']),
  value: z.number().positive('Value must be positive'),
  reason: z.string().optional()
})

const SuccessResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  signalId: z.string().optional()
})

const ErrorResponseSchema = z.object({
  error: z.string(),
  data: z.array(z.any()).optional()
})

// Configuration: Defines the API route - only updates state, doesn't trigger LLM
export const config: ApiRouteConfig = {
  name: 'SimulateSignal',
  type: 'api',
  path: '/simulate',      
  method: 'POST',
  emits: [], // No direct emits - only updates state, cron will check and trigger
  description: 'Manually inject market signals (demand, competitor prices) - updates state only. Cron job will evaluate and trigger LLM if needed.',
  flows: ['simulator'],
  virtualSubscribes: [],
  bodySchema: SimulateSignalSchema,
  responseSchema: {
    200: SuccessResponseSchema,
    400: ErrorResponseSchema,
    500: ErrorResponseSchema
  },
  middleware: [coreMiddleware]
}

// Handler: Only updates state - cron will read and decide whether to call LLM
export const handler: Handlers['SimulateSignal'] = async (req, { logger, state }) => {
  try {
    // Validate input (middleware handles ZodError, but we validate here for type safety)
    const signal = SimulateSignalSchema.parse(req.body)

    logger.info('🔌 Manual Signal Stored', { 
      type: signal.type, 
      value: signal.value,
      reason: signal.reason 
    })

    const signalData = {
      ...signal,
      timestamp: new Date().toISOString(),
      source: 'manual_simulation'
    }

    // Store signal in state - cron will read this and evaluate
    // Store with a key that includes type for easy retrieval
    const signalKey = `signal_${signal.type}`
    await state.set('market_signals', signalKey, signalData)

    // NOTE: We do NOT update the 'signals' group here
    // The cron will update it AFTER evaluating and emitting
    // This ensures the cron can properly detect the change

    logger.info('✅ Signal stored in state', { 
      type: signal.type,
      value: signal.value,
      timestamp: signalData.timestamp,
      note: 'Cron job will evaluate this signal on next tick'
    })

    return {
      status: 200,
      body: { 
        ok: true, 
        message: 'Signal stored successfully. Cron job will evaluate on next tick.',
        signalId: signalData.timestamp
      }
    }
  } catch (error: any) {
    // This should be caught by middleware, but we log here for safety
    logger.error('Failed to store signal', { 
      error: error.message,
      body: req.body 
    })
    throw error
  }
}