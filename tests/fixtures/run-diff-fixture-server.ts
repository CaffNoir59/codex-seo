import { writeFile } from "node:fs/promises";
import { startDiffFixtureServer } from "./diff-site-server.js";

const output = process.argv[2];
const fixture = await startDiffFixtureServer();
const data = JSON.stringify({ v1Url: fixture.v1Url, v2Url: fixture.v2Url });
if (output) await writeFile(output, data, "utf8");
console.log(data);
const shutdown = async () => { await fixture.close(); process.exit(0); };
process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
setInterval(() => undefined, 1000);
