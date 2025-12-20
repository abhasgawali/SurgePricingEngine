import { ApiRouteConfig, Handlers } from 'motia'
import { z } from 'zod'
import { coreMiddleware } from '../../middlewares/core.middleware'

const DashboardResponseSchema = z.object({
  url: z.string(),
  streamName: z.string(),
  groupId: z.string()
})

const ErrorResponseSchema = z.object({
  error: z.string()
})

export const config: ApiRouteConfig = {
  name: 'ConnectDashboard',
  type: 'api',
  path: '/api/connect-dashboard',
  method: 'GET',
  description: 'Handshake endpoint for dashboard to locate the price stream',
  emits: [],
  flows: ['frontend'],
  responseSchema: {
    200: DashboardResponseSchema,
    500: ErrorResponseSchema
  },
  middleware: [coreMiddleware]
}

export const handler: Handlers['ConnectDashboard'] = async (_req, { logger }) => {
  try {
    logger.debug('Dashboard handshake requested')
    
    const streamUrl = '/api/v1/streams/price_stream?groupId=price:public'
    
    logger.info('Dashboard connection established', { streamUrl })
    
    return {
      status: 200,
      body: { 
        url: streamUrl,
        streamName: 'price_stream',
        groupId: 'price:public'
      } 
    }
  } catch (error: any) {
    logger.error('Failed to establish dashboard connection', { 
      error: error.message 
    })
    throw error
  }
}