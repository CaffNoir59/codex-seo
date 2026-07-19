import { GoogleSearchConsoleClient } from "../src/gsc/gsc-client.js";
import { fetchSearchAnalytics } from "../src/gsc/search-analytics-adapter.js";
import { resolveGscConfig } from "../src/gsc/gsc-config.js";

const property = process.env.GSC_TEST_PROPERTY;
const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!property || !credentials) {
  console.log("GSC integration skipped: set GSC_TEST_PROPERTY and GOOGLE_APPLICATION_CREDENTIALS to run real Google checks.");
  process.exit(0);
}
const config = resolveGscConfig({ enabled: true, property, credentialsPath: credentials, authMode: "service-account", days: 7, rowLimit: 100 });
const client = new GoogleSearchConsoleClient({ mode: "service-account", credentialsPath: credentials });
const result = await fetchSearchAnalytics(client, property, config);
console.log(JSON.stringify({ ok: true, property, rows: result.rowCount, clicks: result.totals.clicks, impressions: result.totals.impressions, partial: result.partial }, null, 2));