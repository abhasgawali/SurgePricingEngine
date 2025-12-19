import { ApiRouteConfig, Handlers } from 'motia'
import { z } from 'zod'

export const config: ApiRouteConfig = {
  name: 'ForceTick',
  type: 'api',
  path: '/debug/tick',
  method: 'POST',
  description: 'Force a market ticker tick (panic button) for demos',
  emits: ['market.signal'], // CHANGE THIS: Emit what the Agent listens to
  flows: ['debug'],
  bodySchema: z.object({ reason: z.string().optional() })
}

export const handler: Handlers['ForceTick'] = async (req, { emit, logger }) => {
  const body = req.body || {}

  // BYPASS: Send a "Fake" Surge signal directly to the AI
  await emit({ 
    topic: 'market.signal', 
    data: { 
      type: 'demand_surge',
      value: 50, // Fake high velocity
      timestamp: new Date().toISOString(), 
      reason: body.reason ?? 'Manual Debug Trigger',
      source: 'debug_api'
    } 
  })
  
  logger.info('📢 Force signal emitted', { reason: body.reason })

  return {
    status: 200,
    body: { ok: true, message: 'AI Triggered Immediately' }
  }
}