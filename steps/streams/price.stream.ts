import { StreamConfig } from 'motia'
import { z } from 'zod'

// Define the Data Shape
const priceSchema = z.object({

  type: z.enum(['signal', 'decision']).default('decision'), 
  
  // Core Data
  price: z.number(),
  previousPrice: z.number().optional(),
  
  competitorPrice: z.number().nullable().optional(),
  stockLevel: z.number().nullable().optional(),
  velocity: z.number().nullable().optional(), // Demand level
  
  // AI Logic
  reason: z.string().optional(),
  decision: z.enum(['increase', 'decrease', 'hold']),
  
  signalType: z.string().optional(),
  signalValue: z.number().optional(),
  
  timestamp: z.string(),
  itemId: z.string().optional(),
})

export const config: StreamConfig = {
  name: "price_stream",
  schema: priceSchema,
  baseConfig: { storageType: "default" }
}