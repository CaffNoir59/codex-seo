import { startPerformanceFixtureServer } from "./performance-fixture-server.js";

const fixture = await startPerformanceFixtureServer();
console.log(JSON.stringify({ baseUrl: fixture.baseUrl, lightUrl: fixture.lightUrl, heavyUrl: fixture.heavyUrl, siteUrl: fixture.siteUrl }));

const close = async () => {
  await fixture.close();
  process.exit(0);
};
process.on("SIGINT", () => { void close(); });
process.on("SIGTERM", () => { void close(); });