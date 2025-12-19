import { CronConfig, Handlers } from 'motia'

export const config: CronConfig = {
  name: 'MarketTicker',
  type: 'cron',
  description: 'Aggregates view events and emits market signals when velocity is high',
  cron: '*/1 * * * *', // Runs every minute
  emits: ['market.signal'],
  flows: ['intelligence']
}

export const handler: Handlers['MarketTicker'] = async ({ logger, emit, state }) => {
  logger.info('MarketTicker tick - aggregating views')

  const now = Date.now()
  const cutoff = now - 60_000 // last 60 seconds

  // 1. Read all view events from the "Aggregator" group
  const events = (await state.getGroup<{ itemId: string; userId?: string | null; ts: string }>('views_events')) || []

  // 2. Count events in last 60s
  const recent = events.filter((e) => {
    const t = Date.parse(e.ts)
    return !Number.isNaN(t) && t >= cutoff
  })

  const count = recent.length
  logger.info('MarketTicker: recent view events', { count })

  // 3. Emit Signal if Threshold met (This wakes the AI)
  if (count > 5) {
    await emit({
      topic: 'market.signal',
      data: {
        type: 'demand_surge',
        value: count, // This becomes the "velocity" in the Pricing Agent
        reason: 'High traffic velocity detected',
        timestamp: new Date().toISOString(),
        source: 'cron'
      }
    })
    logger.info('MarketTicker: emitted demand_surge', { count })
  }

  // 4. Cleanup: Prune old events to prevent memory bloat
  try {
    await state.clear('views_events')
    // Re-add only the recent ones
    for (const ev of recent) {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
      await state.set('views_events', id, ev)
    }
  } catch (err: any) {
    logger.error('MarketTicker: failed to prune events', { error: err?.message })
  }
}