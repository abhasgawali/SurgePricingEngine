import { EventConfig, Handlers } from 'motia'
import { z } from 'zod'
import { ConfigError } from '../../src/errors/config.error'

export const config: EventConfig = {
  name: 'PricingAgent',
  type: 'event',
  description: 'AI-powered pricing agent - uses LLM to determine optimal pricing based on significant market signals. Only triggered by cron job.',
  subscribes: ['market.signal'],
  input: z.object({
    type: z.enum(['demand_surge', 'competitor_price', 'stock_drop', 'stock_increase']),
    value: z.number().positive('Value must be positive'),
    reason: z.string().optional(),
    timestamp: z.string().datetime('Timestamp must be a valid ISO datetime'),
    source: z.string()
  }),
  emits: [], // Price updates are sent via streams, not events
  flows: ['intelligence'],
  virtualEmits: ['price.updated'] // Document price update flow (via streams)
}

// Pricing configuration constants
const PRICING_CONFIG = {
  basePrice: 100,          // Base price - never go below this
  minPrice: 80,            // Absolute minimum (emergency floor - 20% below base)
  maxPrice: 500,          // Maximum allowed price
  defaultPrice: 100,       // Default starting price
  maxPriceChange: 0.25,    // Maximum 25% change per update
  competitorMargin: 0.02,  // 2% margin below competitor
  minMargin: 0.10,         // 10% minimum margin we need to maintain
  lowStockThreshold: 200,  // Stock level considered "low"
  highStockThreshold: 800  // Stock level considered "high"
}

// LLM Configuration
const LLM_CONFIG = {
  model: process.env.GROQ_MODEL || 'llama-3.1-70b-versatile',
  temperature: 0.6,
  maxRetries: 2
}

export const handler: Handlers['PricingAgent'] = async (
  event,
  { logger, state, streams }
) => {
  const startTime = Date.now()
  let currentPrice = PRICING_CONFIG.defaultPrice
  let signal = event

  try {
    // 1. VALIDATE API KEY
    const GROQ_KEY = process.env.GROQ_API_KEY
    if (!GROQ_KEY) {
      logger.error('❌ GROQ_API_KEY missing - pricing agent cannot function without API key')
      throw new ConfigError('GROQ_API_KEY environment variable is not set', {
        signalType: signal.type,
        signalValue: signal.value
      })
    }

    // 2. LOAD COMPLETE MARKET CONTEXT
    let competitorPrice: number | null = null
    let ourStock: number = 1000 // Default stock
    let demandLevel: number = 0
    
    try {
      // Load our current price
      currentPrice = (await state.get<number>('pricing', 'current_price')) || PRICING_CONFIG.defaultPrice
      
      // Ensure price is within bounds
      if (currentPrice < PRICING_CONFIG.minPrice || currentPrice > PRICING_CONFIG.maxPrice) {
        logger.warn('Current price out of bounds, resetting to base', {
          currentPrice,
          basePrice: PRICING_CONFIG.basePrice
        })
        currentPrice = PRICING_CONFIG.basePrice
        await state.set('pricing', 'current_price', currentPrice)
      }
      
      // Load competitor price (from signals)
      competitorPrice = (await state.get<number>('signals', 'competitor_price')) || null
      
      // Load our stock level (from inventory)
      ourStock = (await state.get<number>('inventory', 'our_stock')) || 1000
      
      // Load demand level (from signals)
      demandLevel = (await state.get<number>('signals', 'demand_surge')) || 0
      
    } catch (stateError: any) {
      logger.error('Failed to load market context from state', {
        error: stateError.message
      })
      // Use defaults
      currentPrice = PRICING_CONFIG.defaultPrice
      ourStock = 1000
    }

    // 3. UPDATE STATE BASED ON SIGNAL TYPE
    if (signal.type === 'competitor_price') {
      competitorPrice = signal.value
      await state.set('signals', 'competitor_price', signal.value)
    } else if (signal.type === 'stock_drop' || signal.type === 'stock_increase') {
      ourStock = signal.value
      await state.set('inventory', 'our_stock', signal.value)
      // Store as stock_drop signal for consistency
      await state.set('signals', 'stock_drop', signal.value)
    } else if (signal.type === 'demand_surge') {
      demandLevel = signal.value
      await state.set('signals', 'demand_surge', signal.value)
    }

    // 4. CALCULATE MARKET POSITION
    const stockStatus: 'low' | 'normal' | 'high' = ourStock < PRICING_CONFIG.lowStockThreshold ? 'low' :
                        ourStock > PRICING_CONFIG.highStockThreshold ? 'high' : 'normal'
    
    const competitorDiff = competitorPrice !== null ? competitorPrice - currentPrice : null
    const competitorDiffPct = competitorDiff !== null ? ((competitorDiff / currentPrice) * 100) : null
    
    logger.info('📊 Pricing Agent - Complete Market Context', {
      signalType: signal.type,
      signalValue: signal.value,
      currentPrice,
      competitorPrice: competitorPrice ?? 'unknown',
      ourStock,
      stockStatus,
      demandLevel,
      competitorDiff: competitorDiff !== null ? `$${competitorDiff.toFixed(2)} (${competitorDiffPct?.toFixed(1)}%)` : 'N/A',
      basePrice: PRICING_CONFIG.basePrice,
      source: signal.source,
      reason: signal.reason
    })

    // 5. BUILD COMPREHENSIVE CONTEXT FOR LLM
    const context = {
      currentPrice,
      basePrice: PRICING_CONFIG.basePrice,
      competitorPrice: competitorPrice ?? null,
      ourStock,
      stockStatus,
      demandLevel,
      signalType: signal.type,
      signalValue: signal.value,
      priceRange: {
        min: PRICING_CONFIG.minPrice,
        max: PRICING_CONFIG.maxPrice
      },
      maxChange: PRICING_CONFIG.maxPriceChange,
      minMargin: PRICING_CONFIG.minMargin,
      competitorMargin: PRICING_CONFIG.competitorMargin,
      reason: signal.reason
    }

    // 5. CALL LLM FOR PRICING DECISION WITH COMPREHENSIVE CONTEXT
    logger.info('🤖 Calling LLM for pricing decision with full market context', {
      model: LLM_CONFIG.model,
      signalType: signal.type,
      signalValue: signal.value,
      currentPrice,
      competitorPrice: competitorPrice ?? 'unknown',
      ourStock,
      stockStatus,
      demandLevel,
      basePrice: PRICING_CONFIG.basePrice
    })

    let result = await callLLMForPricing(GROQ_KEY, context, logger, signal)

    // 6. VALIDATE AND SANITIZE LLM RESPONSE
    result = validateAndSanitizePrice(result, currentPrice, logger)

    logger.info('✅ LLM Decision Received', {
      decision: result.decision,
      oldPrice: currentPrice,
      newPrice: result.new_price,
      priceChange: ((result.new_price - currentPrice) / currentPrice * 100).toFixed(2) + '%',
      reasoning: result.reasoning.substring(0, 100) + '...' // Truncate for logs
    })

    // 7. PERSIST NEW PRICE TO STATE
    try {
      await state.set('pricing', 'current_price', result.new_price)
      await state.set('pricing', 'last_pricing_ts', Date.now())
      await state.set('pricing', 'last_pricing_decision', result.decision)
      await state.set('pricing', 'last_pricing_reason', result.reasoning)
      await state.set('signals', signal.type, signal.value)
      
      logger.debug('State updated successfully', {
        newPrice: result.new_price,
        decision: result.decision
      })
    } catch (stateError: any) {
      logger.error('Failed to persist price to state', {
        error: stateError.message,
        newPrice: result.new_price
      })
      throw stateError // Critical - can't continue without saving price
    }

    // 8. UPDATE STREAM FOR REAL-TIME CLIENTS
    try {
      await streams.price_stream.set(
        'price:public',
        'current',
        {
          price: result.new_price,
          previousPrice: currentPrice,
          decision: result.decision,
          reason: result.reasoning,
          timestamp: new Date().toISOString()
        }
      )
      logger.info('✅ Price stream updated for real-time clients', { 
        newPrice: result.new_price,
        previousPrice: currentPrice,
        decision: result.decision
      })
    } catch (streamError: any) {
      logger.error('⚠️ Failed to update price stream (non-critical)', {
        error: streamError.message,
        price: result.new_price
      })
      // Don't throw - stream update is non-critical, price is already saved
    }

    const duration = Date.now() - startTime
    logger.info('✅ Pricing agent completed successfully', {
      signalType: signal.type,
      oldPrice: currentPrice,
      newPrice: result.new_price,
      decision: result.decision,
      duration: `${duration}ms`
    })
  } catch (error: any) {
    const duration = Date.now() - startTime
    logger.error('❌ Pricing agent failed', {
      error: error.message,
      stack: error.stack,
      signalType: signal.type,
      signalValue: signal.value,
      currentPrice,
      duration: `${duration}ms`
    })
    
    // Re-throw ConfigError to fail fast on configuration issues
    if (error instanceof ConfigError) {
      throw error
    }
    
    // For other errors, log and continue (event system handles retries)
  }
}

// Helper function: Call LLM for pricing decision with comprehensive market context
async function callLLMForPricing(
  apiKey: string,
  context: {
    currentPrice: number
    basePrice: number
    competitorPrice: number | null
    ourStock: number
    stockStatus: 'low' | 'normal' | 'high'
    demandLevel: number
    signalType: string
    signalValue: number
    priceRange: { min: number; max: number }
    maxChange: number
    minMargin: number
    competitorMargin: number
    reason?: string
  },
  logger: any,
  signal: any
): Promise<{ new_price: number; reasoning: string; decision: 'increase' | 'decrease' | 'hold' }> {
  const systemPrompt = `You are an expert Revenue Management AI specializing in dynamic pricing for e-commerce.
Your goal is to maximize revenue while maintaining competitiveness, protecting margins, and customer satisfaction.
You must consider ALL market factors together: competitor pricing, our stock levels, demand, and margins.
Always output valid JSON only.`

  // Calculate key metrics
  const competitorDiff = context.competitorPrice !== null 
    ? context.competitorPrice - context.currentPrice 
    : null
  const competitorDiffPct = competitorDiff !== null 
    ? ((competitorDiff / context.currentPrice) * 100).toFixed(1) 
    : null
  
  const stockPct = ((context.ourStock / 1000) * 100).toFixed(0)
  const minAcceptablePrice = Math.max(context.basePrice, context.currentPrice * (1 - context.minMargin))
  const maxPriceChange = context.currentPrice * context.maxChange

  // Build comprehensive market analysis
  let marketAnalysis = `
COMPLETE MARKET ANALYSIS:

OUR POSITION:
- Our Current Price: $${context.currentPrice.toFixed(2)}
- Base Price (Floor): $${context.basePrice.toFixed(2)} - NEVER go below this
- Our Stock Level: ${context.ourStock} units (${stockPct}% of normal, status: ${context.stockStatus})
- Current Demand Level: ${context.demandLevel}

COMPETITOR POSITION:
${context.competitorPrice !== null ? `
- Competitor's Price: $${context.competitorPrice.toFixed(2)}
- Price Difference: $${Math.abs(competitorDiff!).toFixed(2)} (${competitorDiffPct}% ${competitorDiff! > 0 ? 'higher' : 'lower'} than ours)
- Competitive Position: ${competitorDiff! < -10 ? '⚠️ Competitor is AGGRESSIVELY undercutting - DO NOT match if below base price' : 
                        competitorDiff! < 0 ? 'Competitor is slightly lower - consider matching' :
                        competitorDiff! > 0 ? '✅ We are competitive - can maintain or increase' : 'Prices are equal'}` : `
- Competitor Price: Unknown (no recent data)`}

CURRENT SIGNAL:
- Signal Type: ${context.signalType}
- Signal Value: ${context.signalValue}
${context.reason ? `- Context: ${context.reason}` : ''}

FINANCIAL CONSTRAINTS:
- Minimum Acceptable Price: $${minAcceptablePrice.toFixed(2)} (protect ${(context.minMargin * 100).toFixed(0)}% margin)
- Maximum Price Change: $${maxPriceChange.toFixed(2)} (${(context.maxChange * 100).toFixed(0)}% per update)
- Price Range: $${context.priceRange.min} - $${context.priceRange.max}`

  // Build strategic guidance
  let strategicGuidance = ''

  if (context.signalType === 'competitor_price' && context.competitorPrice !== null) {
    const isCompetitorTooLow = context.competitorPrice < context.basePrice
    const isCompetitorSlightlyLower = context.competitorPrice < context.currentPrice && context.competitorPrice >= context.basePrice
    const isCompetitorHigher = context.competitorPrice > context.currentPrice
    
    strategicGuidance = `
STRATEGIC GUIDANCE FOR COMPETITOR PRICE CHANGE:

${isCompetitorTooLow ? `
⚠️ CRITICAL: Competitor is trying to kill us with price $${context.competitorPrice.toFixed(2)} (below our base of $${context.basePrice})
- DO NOT match this predatory pricing
- Stay competitive but maintain base price floor
- Consider: Match to base price ($${context.basePrice}) or slightly above
- Protect margins - don't engage in price war` : isCompetitorSlightlyLower ? `
Competitor is slightly lower ($${context.competitorPrice.toFixed(2)}) but above base price
- Consider matching or slightly undercutting (maintain ${(context.competitorMargin * 100).toFixed(0)}% margin)
- Stock level (${context.ourStock}) affects decision: ${context.stockStatus === 'low' ? 'Low stock - can maintain higher price' : 'Normal stock - match competitively'}
- Suggested: Match to $${(context.competitorPrice * (1 - context.competitorMargin)).toFixed(2)}` : isCompetitorHigher ? `
✅ Competitor is pricing HIGHER ($${context.competitorPrice.toFixed(2)}) than us
- We're already competitive - maintain or slightly increase
- Stock level (${context.ourStock}): ${context.stockStatus === 'low' ? 'Low stock - increase price due to scarcity' : 'Normal stock - maintain competitive advantage'}
- Suggested: Increase to $${Math.min(context.competitorPrice * 0.98, context.currentPrice * 1.1).toFixed(2)}` : `
Prices are equal - maintain competitive position`}`
  } else if (context.signalType === 'demand_surge') {
    strategicGuidance = `
STRATEGIC GUIDANCE FOR DEMAND SURGE:

- High demand (${context.signalValue}) = pricing opportunity
- Stock level (${context.ourStock}): ${context.stockStatus === 'low' ? 'Low stock + high demand = STRONG increase opportunity' : 'Normal stock = moderate increase'}
- Competitor price: ${context.competitorPrice !== null ? `$${context.competitorPrice.toFixed(2)} - ${context.competitorPrice > context.currentPrice ? 'They\'re higher, we can increase' : 'Stay competitive'}` : 'Unknown'}
- Suggested increase: ${context.stockStatus === 'low' ? '10-15%' : '5-10%'}`
  } else if (context.signalType === 'stock_drop' || context.signalType === 'stock_increase') {
    strategicGuidance = `
STRATEGIC GUIDANCE FOR STOCK CHANGE:

- Our Stock: ${context.ourStock} units (${context.stockStatus})
- ${context.signalType === 'stock_drop' ? 'Stock decreased - scarcity pricing opportunity' : 'Stock increased - can be more competitive'}
- Competitor price: ${context.competitorPrice !== null ? `$${context.competitorPrice.toFixed(2)}` : 'Unknown'}
- Demand level: ${context.demandLevel}
- ${context.stockStatus === 'low' ? '⚠️ Low stock - increase price due to scarcity' : context.stockStatus === 'high' ? 'High stock - can be more competitive' : 'Normal stock - maintain pricing'}`
  }

  const userPrompt = `You are a strategic pricing manager. Analyze the COMPLETE market situation and make an intelligent pricing decision.

${marketAnalysis}

${strategicGuidance}

DECISION CRITERIA (consider ALL factors together):
1. Competitor Price: ${context.competitorPrice !== null ? `$${context.competitorPrice.toFixed(2)}` : 'Unknown'} - ${competitorDiff !== null ? (competitorDiff < -10 ? '⚠️ DO NOT match if below base price' : competitorDiff < 0 ? 'Match competitively' : 'We can increase') : 'No competitor data'}
2. Our Stock: ${context.ourStock} (${context.stockStatus}) - ${context.stockStatus === 'low' ? 'Low stock = scarcity = increase price' : context.stockStatus === 'high' ? 'High stock = can be competitive' : 'Normal stock'}
3. Demand: ${context.demandLevel} - ${context.demandLevel > 50 ? 'High demand = increase opportunity' : 'Normal demand'}
4. Base Price Floor: $${context.basePrice} - NEVER go below this
5. Margins: Maintain at least ${(context.minMargin * 100).toFixed(0)}% margin

CRITICAL RULES:
- NEVER price below base price ($${context.basePrice}) - even if competitor tries to kill us
- If competitor goes below base price, maintain base price or slightly above
- Low stock + high demand = increase price (scarcity pricing)
- High stock = can be more competitive (lower price)
- Always consider competitor price, stock, and demand TOGETHER
- Maximum change: ${(context.maxChange * 100).toFixed(0)}% ($${maxPriceChange.toFixed(2)})
- Price range: $${context.priceRange.min} - $${context.priceRange.max}

Return JSON ONLY:
{
  "new_price": <number between ${Math.max(context.basePrice, context.priceRange.min)} and ${context.priceRange.max}>,
  "reasoning": "<1-2 sentences explaining your decision considering competitor, stock, and demand>",
  "decision": "<increase | decrease | hold>"
}

Make a SMART decision based on ALL factors, not just the signal type.`

  let lastError: any = null

  for (let attempt = 0; attempt <= LLM_CONFIG.maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        logger.warn(`LLM retry attempt ${attempt}/${LLM_CONFIG.maxRetries}`, {
          previousError: lastError?.message
        })
        // Small delay before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
      }

      const response = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: LLM_CONFIG.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            response_format: { type: 'json_object' },
            temperature: LLM_CONFIG.temperature
          })
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Groq API error ${response.status}: ${errorText}`)
      }

      const data = await response.json()
      const content = JSON.parse(data.choices[0].message.content)

      return {
        new_price: Number(content.new_price),
        reasoning: String(content.reasoning || 'No reasoning provided'),
        decision: content.decision || 'hold'
      }
    } catch (err: any) {
      lastError = err
      if (attempt === LLM_CONFIG.maxRetries) {
        logger.error('⚠️ LLM failed after all retries, using fallback', {
          error: err.message,
          attempts: attempt + 1
        })
        break
      }
    }
  }

  // Fallback logic when LLM fails
  return getFallbackPricing(context, signal, logger)
}

// Helper function: Get fallback pricing when LLM fails - uses comprehensive context
function getFallbackPricing(
  context: {
    currentPrice: number
    basePrice: number
    competitorPrice: number | null
    ourStock: number
    stockStatus: 'low' | 'normal' | 'high'
    demandLevel: number
    signalType: string
    signalValue: number
    priceRange: { min: number; max: number }
    maxChange: number
    minMargin: number
    competitorMargin: number
  },
  signal: any,
  logger: any
): { new_price: number; reasoning: string; decision: 'increase' | 'decrease' | 'hold' } {
  logger.warn('Using deterministic fallback pricing with comprehensive context', {
    signalType: signal.type,
    currentPrice: context.currentPrice,
    competitorPrice: context.competitorPrice,
    ourStock: context.ourStock,
    basePrice: context.basePrice
  })

  let newPrice = context.currentPrice
  let decision: 'increase' | 'decrease' | 'hold' = 'hold'
  let reasoning = ''

  switch (signal.type) {
    case 'competitor_price':
      const competitorPrice = signal.value
      const competitorDiff = competitorPrice - context.currentPrice
      
      // CRITICAL: Don't let competitor kill us - protect base price
      if (competitorPrice < context.basePrice) {
        // Competitor is trying predatory pricing - maintain base price
        newPrice = context.basePrice
        decision = context.basePrice > context.currentPrice ? 'increase' : 'hold'
        reasoning = `Competitor using predatory pricing ($${competitorPrice.toFixed(2)}) - maintaining base price floor ($${context.basePrice})`
      } else if (competitorDiff < -5) {
        // Competitor is significantly lower but above base - match with margin
        newPrice = Math.max(
          competitorPrice * (1 - context.competitorMargin),
          context.basePrice
        )
        decision = 'decrease'
        reasoning = `Competitor significantly lower - matching with ${(context.competitorMargin * 100).toFixed(0)}% margin, protecting base price`
      } else if (competitorDiff < 0) {
        // Competitor slightly lower - match competitively
        newPrice = Math.max(
          competitorPrice * (1 - context.competitorMargin),
          context.basePrice
        )
        decision = newPrice < context.currentPrice ? 'decrease' : 'hold'
        reasoning = `Competitor slightly lower - matching competitively`
      } else if (competitorDiff > 0) {
        // Competitor higher - we can increase, but consider stock
        if (context.stockStatus === 'low') {
          // Low stock + competitor higher = increase
          const increase = Math.min(context.currentPrice * 0.08, context.currentPrice * context.maxChange)
          newPrice = Math.min(context.currentPrice + increase, context.priceRange.max)
          decision = 'increase'
          reasoning = `Competitor higher + low stock - increasing price`
        } else {
          // Normal stock - maintain competitive advantage
          decision = 'hold'
          reasoning = `Competitor higher - maintaining competitive advantage`
        }
      } else {
        decision = 'hold'
        reasoning = 'Prices equal - maintaining position'
      }
      break

    case 'demand_surge':
      // High demand = increase, but consider stock and competitor
      const demandMultiplier = Math.min(context.signalValue / 100, 1.5) // Cap at 1.5x
      const surgeIncrease = Math.min(
        context.currentPrice * 0.08 * demandMultiplier,
        context.currentPrice * context.maxChange
      )
      
      // If stock is low, increase more aggressively
      if (context.stockStatus === 'low') {
        newPrice = Math.min(context.currentPrice + surgeIncrease * 1.5, context.priceRange.max)
      } else {
        newPrice = Math.min(context.currentPrice + surgeIncrease, context.priceRange.max)
      }
      
      decision = 'increase'
      reasoning = `High demand (${context.signalValue}) + ${context.stockStatus} stock - price increase`
      break

    case 'stock_drop':
    case 'stock_increase':
      const stockLevel = signal.value
      const stockRatio = stockLevel / 1000 // Normalize to 1000
      
      if (stockRatio < 0.2) {
        // Very low stock - significant increase
        const scarcityIncrease = Math.min(context.currentPrice * 0.15, context.currentPrice * context.maxChange)
        newPrice = Math.min(context.currentPrice + scarcityIncrease, context.priceRange.max)
        decision = 'increase'
        reasoning = `Very low stock (${stockLevel}) - scarcity pricing`
      } else if (stockRatio < 0.5) {
        // Low stock - moderate increase
        const scarcityIncrease = Math.min(context.currentPrice * 0.10, context.currentPrice * context.maxChange)
        newPrice = Math.min(context.currentPrice + scarcityIncrease, context.priceRange.max)
        decision = 'increase'
        reasoning = `Low stock (${stockLevel}) - scarcity pricing`
      } else if (stockRatio > 1.5) {
        // High stock - can be more competitive if competitor allows
        if (context.competitorPrice !== null && context.competitorPrice < context.currentPrice) {
          // Competitor is lower, high stock = can match
          newPrice = Math.max(
            context.competitorPrice * (1 - context.competitorMargin),
            context.basePrice
          )
          decision = newPrice < context.currentPrice ? 'decrease' : 'hold'
          reasoning = `High stock (${stockLevel}) - matching competitor competitively`
        } else {
          decision = 'hold'
          reasoning = `High stock (${stockLevel}) - maintaining price`
        }
      } else {
        decision = 'hold'
        reasoning = `Normal stock level (${stockLevel})`
      }
      break

    default:
      decision = 'hold'
      reasoning = 'Unknown signal type - holding price'
  }

  // CRITICAL: Enforce base price floor - NEVER go below base price
  newPrice = Math.max(context.basePrice, newPrice)
  
  // Ensure price is within bounds
  newPrice = Math.max(context.priceRange.min, Math.min(context.priceRange.max, newPrice))

  return {
    new_price: Number(newPrice.toFixed(2)),
    reasoning,
    decision
  }
}

// Helper function: Validate and sanitize LLM response
function validateAndSanitizePrice(
  result: { new_price: number; reasoning: string; decision: 'increase' | 'decrease' | 'hold' },
  currentPrice: number,
  logger: any
): { new_price: number; reasoning: string; decision: 'increase' | 'decrease' | 'hold' } {
  let { new_price, reasoning, decision } = result

  // Validate price is a number
  if (typeof new_price !== 'number' || isNaN(new_price)) {
    logger.warn('LLM returned invalid price, using current price', { new_price })
    new_price = currentPrice
    decision = 'hold'
  }

  // CRITICAL: Enforce base price floor - NEVER go below base price
  if (new_price < PRICING_CONFIG.basePrice) {
    logger.warn('LLM price below base price, clamping to base price', {
      requested: new_price,
      clamped: PRICING_CONFIG.basePrice,
      note: 'Base price is the absolute floor - never go below this'
    })
    new_price = PRICING_CONFIG.basePrice
  } else if (new_price < PRICING_CONFIG.minPrice) {
    logger.warn('LLM price below minimum, clamping to minimum', {
      requested: new_price,
      clamped: PRICING_CONFIG.minPrice
    })
    new_price = PRICING_CONFIG.minPrice
  } else if (new_price > PRICING_CONFIG.maxPrice) {
    logger.warn('LLM price above maximum, clamping to maximum', {
      requested: new_price,
      clamped: PRICING_CONFIG.maxPrice
    })
    new_price = PRICING_CONFIG.maxPrice
  }

  // Enforce maximum change per update
  const priceChange = Math.abs(new_price - currentPrice) / currentPrice
  if (priceChange > PRICING_CONFIG.maxPriceChange) {
    const maxChange = currentPrice * PRICING_CONFIG.maxPriceChange
    const direction = new_price > currentPrice ? 1 : -1
    new_price = currentPrice + (direction * maxChange)
    logger.warn('LLM price change too large, capping to max change', {
      requested: result.new_price,
      capped: new_price,
      maxChange: (PRICING_CONFIG.maxPriceChange * 100).toFixed(0) + '%'
    })
  }

  // Validate decision matches price change
  const actualChange = new_price - currentPrice
  if (decision === 'increase' && actualChange <= 0) {
    decision = actualChange < 0 ? 'decrease' : 'hold'
    logger.warn('Decision mismatch corrected', { original: 'increase', corrected: decision })
  } else if (decision === 'decrease' && actualChange >= 0) {
    decision = actualChange > 0 ? 'increase' : 'hold'
    logger.warn('Decision mismatch corrected', { original: 'decrease', corrected: decision })
  } else if (decision === 'hold' && Math.abs(actualChange) > 0.01) {
    decision = actualChange > 0 ? 'increase' : 'decrease'
    logger.warn('Decision mismatch corrected', { original: 'hold', corrected: decision })
  }

  // Sanitize reasoning
  if (!reasoning || typeof reasoning !== 'string') {
    reasoning = `Price ${decision} to $${new_price.toFixed(2)}`
  }
  reasoning = reasoning.substring(0, 500) // Limit length

  return {
    new_price: Number(new_price.toFixed(2)),
    reasoning,
    decision
  }
}
