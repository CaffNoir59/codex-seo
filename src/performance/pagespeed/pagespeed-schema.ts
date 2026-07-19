import { z } from "zod";

export const pagespeedResponseSchema = z.object({
  id: z.string().optional(),
  loadingExperience: z.unknown().optional(),
  originLoadingExperience: z.unknown().optional(),
  lighthouseResult: z.object({
    finalUrl: z.string().optional(),
    categories: z.record(z.string(), z.object({ score: z.number().nullable().optional() })).optional(),
    audits: z.record(z.string(), z.object({ numericValue: z.number().optional(), score: z.number().nullable().optional(), details: z.unknown().optional() })).optional()
  }).optional()
}).passthrough();
export type PageSpeedResponse = z.infer<typeof pagespeedResponseSchema>;
