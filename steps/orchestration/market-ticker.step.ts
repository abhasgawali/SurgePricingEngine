import { CronConfig, Handlers } from 'motia'

const VIEW_THRESHOLD = 5 // Minimum views in 60s to trigger demand surge
const TIME_WINDOW_MS = 60_000 // 60 seconds

// Significance thresholds (same as pricing agent)
const THRESHOLDS = {
  demand_surge_pct: 0.15,      // 15% delta
  competitor_price_pct: 0.05,  // 5% delta
  stock_drop_pct: 0.20         // 20% drop
}

export const config: CronConfig = {
  name: 'MarketTicker',
  type: 'cron',
  description: 'Evaluates market signals from state and view events. Emits significant signals to trigger pricing agent.',
  cron: '*/1 * * * *', // Runs every minute
  emits: ['market.signal'],
  flows: ['intelligence'],
  virtualSubscribes: ['views.aggregated'] // Document connection from aggregator
}

type MarketSignal = {
  type: 'demand_surge' | 'competitor_price' | 'stock_drop' | 'stock_increase'
  value: number
  reason?: string
  timestamp: string
  source: string
}

export const handler: Handlers['MarketTicker'] = async ({ logger, emit, state }) => {
  try {
    logger.info('MarketTicker tick - evaluating market signals')

    const now = Date.now()
    const cutoff = now - TIME_WINDOW_MS // last 60 seconds
    const signalsToEmit: MarketSignal[] = []

    // 1. Check view events for demand surge
    let events: Array<{ itemId: string; userId?: string | null; ts: string }> = []
    try {
      events = (await state.getGroup<{ itemId: string; userId?: string | null; ts: string }>('views_events')) || []
    } catch (err: any) {
      logger.error('MarketTicker: Failed to read view events', { 
        error: err?.message 
      })
    }

    // Count events in last 60s
    const recent = events.filter((e) => {
      if (!e.ts) return false
      const t = Date.parse(e.ts)
      return !Number.isNaN(t) && t >= cutoff
    })

    const viewCount = recent.length
    logger.info('MarketTicker: view events analysis', { 
      recentCount: viewCount, 
      totalEvents: events.length,
      timeWindow: `${TIME_WINDOW_MS / 1000}s`
    })

    // Check if demand surge is significant
    if (viewCount > VIEW_THRESHOLD) {
      const lastViewCount = (await state.get<number>('signals', 'demand_surge')) ?? 0
      const delta = viewCount - lastViewCount
      const pctChange = lastViewCount === 0 ? 1 : Math.abs(delta / lastViewCount) // 100% change if first time

      if (pctChange >= THRESHOLDS.demand_surge_pct) {
        signalsToEmit.push({
          type: 'demand_surge',
          value: viewCount,
          reason: `High traffic velocity detected: ${viewCount} views in last minute (${(pctChange * 100).toFixed(1)}% change)`,
          timestamp: new Date().toISOString(),
          source: 'cron'
        })
        logger.info('MarketTicker: Significant demand surge detected', {
          count: viewCount,
          lastCount: lastViewCount,
          pctChange: (pctChange * 100).toFixed(1) + '%'
        })
        
        // Update last value after deciding to emit
        await state.set('signals', 'demand_surge', viewCount)
      } else {
        // Still update even if not significant to prevent re-processing
        await state.set('signals', 'demand_surge', viewCount)
      }
    }

    // 2. Check manual signals from state (competitor_price, stock_drop, demand_surge, etc.)
    try {
      // Check each signal type explicitly - don't use getGroup to avoid potential circular reference issues
      const signalTypes: Array<'demand_surge' | 'competitor_price' | 'stock_drop' | 'stock_increase'> = [
        'demand_surge',
        'competitor_price',
        'stock_drop',
        'stock_increase'
      ]

      for (const signalType of signalTypes) {
        try {
          // Get the stored signal by key - use plain object retrieval
          const signalKey = `signal_${signalType}`
          const storedSignalRaw = await state.get('market_signals', signalKey)
          
          // Check if signal exists
          if (!storedSignalRaw || typeof storedSignalRaw !== 'object') {
            logger.debug(`MarketTicker: No stored signal found for ${signalType}`)
            continue
          }
          
          // Create a plain object copy to avoid circular references from Motia's wrapper
          // This prevents stack overflow from recursive wrapping
          const storedSignal: MarketSignal = {
            type: String(storedSignalRaw.type || signalType),
            value: Number(storedSignalRaw.value) || 0,
            reason: storedSignalRaw.reason ? String(storedSignalRaw.reason) : undefined,
            timestamp: String(storedSignalRaw.timestamp || new Date().toISOString()),
            source: String(storedSignalRaw.source || 'unknown')
          }
          
          // Validate the signal has required fields
          if (!storedSignal.type || !storedSignal.value || storedSignal.value <= 0) {
            logger.warn(`MarketTicker: Invalid stored signal for ${signalType}`, {
              signal: storedSignal
            })
            continue
          }

          logger.info(`MarketTicker: Found stored ${signalType} signal`, {
            value: storedSignal.value,
            timestamp: storedSignal.timestamp,
            source: storedSignal.source
          })

          const signalValue = storedSignal.value
          const lastSignalValue = (await state.get<number>('signals', signalType)) ?? null
          const signalTimestamp = storedSignal.timestamp ? new Date(storedSignal.timestamp).getTime() : Date.now()
          const signalAge = Date.now() - signalTimestamp
          const isNewSignal = signalAge < 120_000 // Signal is "new" if stored within last 2 minutes

          // Calculate significance
          let isSignificant = false
          let pctChange = 0

          if (lastSignalValue === null) {
            // First time seeing this signal type - always significant
            isSignificant = true
            pctChange = 1 // 100% change
            logger.info(`MarketTicker: First-time ${signalType} signal - always significant`, {
              value: signalValue
            })
          } else if (isNewSignal && storedSignal.source === 'manual_simulation') {
            // New manual simulation - always process it (user explicitly triggered it)
            isSignificant = true
            const delta = signalValue - lastSignalValue
            pctChange = Math.abs(delta / lastSignalValue)
            logger.info(`MarketTicker: New manual ${signalType} signal - processing (user triggered)`, {
              value: signalValue,
              lastValue: lastSignalValue,
              age: `${Math.round(signalAge / 1000)}s`,
              pctChange: (pctChange * 100).toFixed(2) + '%'
            })
          } else {
            // Existing signal - check if change is significant
            const delta = signalValue - lastSignalValue
            pctChange = Math.abs(delta / lastSignalValue)

            switch (signalType) {
              case 'demand_surge':
                isSignificant = pctChange >= THRESHOLDS.demand_surge_pct
                break
              case 'competitor_price':
                isSignificant = pctChange >= THRESHOLDS.competitor_price_pct
                break
            case 'stock_drop':
              isSignificant = delta < 0 && pctChange >= THRESHOLDS.stock_drop_pct
              break
            case 'stock_increase':
              // Stock increase is significant if it's a large increase (more inventory = can be more competitive)
              isSignificant = delta > 0 && pctChange >= THRESHOLDS.stock_drop_pct
              break
            }

            logger.debug(`MarketTicker: ${signalType} significance check`, {
              currentValue: signalValue,
              lastValue: lastSignalValue,
              delta,
              pctChange: (pctChange * 100).toFixed(2) + '%',
              threshold: signalType === 'demand_surge' ? THRESHOLDS.demand_surge_pct :
                         signalType === 'competitor_price' ? THRESHOLDS.competitor_price_pct :
                         THRESHOLDS.stock_drop_pct,
              isSignificant,
              signalAge: `${Math.round(signalAge / 1000)}s`
            })
          }

          if (isSignificant) {
            signalsToEmit.push({
              type: signalType,
              value: signalValue,
              reason: storedSignal.reason || `Significant ${signalType} change: ${(pctChange * 100).toFixed(1)}%`,
              timestamp: storedSignal.timestamp || new Date().toISOString(),
              source: storedSignal.source || 'cron'
            })
            logger.info(`MarketTicker: ✅ Significant ${signalType} signal - will emit`, {
              value: signalValue,
              lastValue: lastSignalValue,
              pctChange: (pctChange * 100).toFixed(1) + '%'
            })
            
            // Update the last value AFTER we've decided to emit
            // This prevents the same signal from being processed again
            await state.set('signals', signalType, signalValue)
          } else {
            logger.info(`MarketTicker: ⏭️ ${signalType} signal not significant - skipping`, {
              value: signalValue,
              lastValue: lastSignalValue,
              pctChange: (pctChange * 100).toFixed(1) + '%',
              threshold: signalType === 'demand_surge' ? (THRESHOLDS.demand_surge_pct * 100).toFixed(0) + '%' :
                         signalType === 'competitor_price' ? (THRESHOLDS.competitor_price_pct * 100).toFixed(0) + '%' :
                         (THRESHOLDS.stock_drop_pct * 100).toFixed(0) + '%'
            })
            
            // Still update the last value even if not significant
            // This prevents re-processing the same signal
            await state.set('signals', signalType, signalValue)
          }
        } catch (signalErr: any) {
          logger.error(`MarketTicker: Error processing ${signalType} signal`, {
            error: signalErr?.message,
            stack: signalErr?.stack
          })
        }
      }
    } catch (err: any) {
      logger.error('MarketTicker: Failed to read stored signals', {
        error: err?.message,
        stack: err?.stack
      })
    }

    // 3. Emit all significant signals
    for (const signalData of signalsToEmit) {
      try {
        await emit({
          topic: 'market.signal',
          data: signalData
        })
        logger.info('MarketTicker: emitted market signal', {
          type: signalData.type,
          value: signalData.value,
          timestamp: signalData.timestamp
        })
      } catch (emitError: any) {
        logger.error('MarketTicker: Failed to emit market signal', {
          error: emitError?.message,
          signalType: signalData.type
        })
      }
    }

    if (signalsToEmit.length === 0) {
      logger.debug('MarketTicker: No significant signals to emit')
    }

    // 4. Cleanup: Prune old events to prevent memory bloat
    try {
      if (events.length > 0) {
        await state.clear('views_events')
        
        // Re-add only the recent ones (within time window)
        const reAddPromises = recent.map(async (ev) => {
          const id = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
          await state.set('views_events', id, ev)
        })
        
        await Promise.all(reAddPromises)
        
        logger.debug('MarketTicker: Cleanup completed', {
          removed: events.length - recent.length,
          kept: recent.length
        })
      }
    } catch (cleanupError: any) {
      logger.error('MarketTicker: Failed to prune events', { 
        error: cleanupError?.message,
        stack: cleanupError?.stack
      })
    }

    logger.info('MarketTicker tick completed successfully', {
      signalsEmitted: signalsToEmit.length
    })
  } catch (error: any) {
    logger.error('MarketTicker: Unexpected error during tick', {
      error: error.message,
      stack: error.stack
    })
    // Don't throw - cron steps should be resilient
  }
}