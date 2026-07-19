import { writeFile } from "node:fs/promises";
import { startFixtureServer } from "./fixture-server.js";

const urlFile = process.argv[2];
const fixture = await startFixtureServer();
if (urlFile) await writeFile(urlFile, fixture.baseUrl, "utf8");
console.log(fixture.baseUrl);

const shutdown = async () => {
  await fixture.close();
  process.exit(0);
};
process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
setInterval(() => undefined, 1000);
