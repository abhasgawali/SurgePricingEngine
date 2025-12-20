import { ApiRouteConfig, Handlers } from 'motia'
import { z } from 'zod'
import { coreMiddleware } from '../../middlewares/core.middleware'

const ForceTickRequestSchema = z.object({ 
  reason: z.string().optional(),
  value: z.number().positive().optional()
})

const SuccessResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  signalId: z.string()
})

const ErrorResponseSchema = z.object({
  error: z.string(),
  data: z.array(z.any()).optional()
})

export const config: ApiRouteConfig = {
  name: 'ForceTick',
  type: 'api',
  path: '/debug/tick',
  method: 'POST',
  description: 'Force a market ticker tick (panic button) for demos',
  emits: ['market.signal'],
  flows: ['debug'],
  bodySchema: ForceTickRequestSchema,
  responseSchema: {
    200: SuccessResponseSchema,
    400: ErrorResponseSchema,
    500: ErrorResponseSchema
  },
  middleware: [coreMiddleware]
}

export const handler: Handlers['ForceTick'] = async (req, { emit, logger }) => {
  try {
    const body = ForceTickRequestSchema.parse(req.body || {})
    const signalValue = body.value ?? 50 // Default to high velocity for testing

    const signalData = {
      type: 'demand_surge' as const,
      value: signalValue,
      timestamp: new Date().toISOString(),
      reason: body.reason ?? 'Manual Debug Trigger',
      source: 'debug_api'
    }

    // Send a "Fake" Surge signal directly to the AI
    await emit({ 
      topic: 'market.signal', 
      data: signalData
    })
    
    logger.info('📢 Force signal emitted', { 
      reason: body.reason,
      value: signalValue,
      timestamp: signalData.timestamp
    })

    return {
      status: 200,
      body: { 
        ok: true, 
        message: 'AI Triggered Immediately',
        signalId: signalData.timestamp
      }
    }
  } catch (error: any) {
    logger.error('Failed to force tick', { 
      error: error.message,
      body: req.body 
    })
    throw error
  }
}