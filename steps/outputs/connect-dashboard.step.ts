import { ApiRouteConfig, Handlers } from 'motia'

export const config: ApiRouteConfig = {
  name: 'ConnectDashboard',
  type: 'api',
  path: '/api/connect-dashboard',
  method: 'GET',
  description: 'Handshake endpoint for dashboard to locate the price stream',
  emits: [],
  flows: ['frontend']
}

export const handler: Handlers['ConnectDashboard'] = async (_req, { logger }) => {
  logger.debug('Dashboard handshake requested')
  return {
    status: 200,
    // FIX: Add the standard /api/v1 prefix. 
    // Your existing '/api' proxy rule will handle this automatically.
    body: { url: '/api/v1/streams/price_stream?groupId=price:public' } 
  }
}