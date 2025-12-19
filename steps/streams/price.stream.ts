import { StreamConfig } from 'motia'
import { z } from 'zod'

// Define the Data Shape
const priceSchema = z.object({
  price: z.number(),
  previousPrice: z.number().optional(),
  competitorPrice: z.number().optional(),
  reason: z.string().optional(),
  decision: z.enum(['increase', 'decrease', 'hold']),
  timestamp: z.string(),
  itemId: z.string().optional(),
  stockLevel: z.number().optional(),
  velocity: z.number().optional()
})

export const config: StreamConfig = {
  name: "price_stream",  // The name we reference in Frontend
  schema: priceSchema,
  baseConfig: { storageType: "default" } // Low latency
}