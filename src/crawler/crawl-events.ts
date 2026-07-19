export type CrawlEvent =
  | { type: "discovered"; url: string; depth: number; from?: string }
  | { type: "skipped"; url: string; reason: string }
  | { type: "fetched"; url: string; statusCode?: number }
  | { type: "failed"; url: string; message: string };

export type CrawlEventSink = (event: CrawlEvent) => void;