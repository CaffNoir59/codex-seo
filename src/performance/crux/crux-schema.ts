import { z } from "zod";
export const cruxResponseSchema = z.object({ record: z.object({ key: z.record(z.string(), z.string()).optional(), metrics: z.record(z.string(), z.object({ percentiles: z.object({ p75: z.number().optional() }).optional(), histogram: z.array(z.object({ density: z.number().optional() })).optional() })).optional(), collectionPeriod: z.object({ firstDate: z.string().optional(), lastDate: z.string().optional() }).optional() }).optional() }).passthrough();
export type CruxResponse = z.infer<typeof cruxResponseSchema>;
