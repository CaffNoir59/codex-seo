import { readFile, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun" | "unknown";
export type Framework = "next" | "nuxt" | "astro" | "vite" | "react" | "vue" | "svelte" | "sveltekit" | "angular" | "remix" | "laravel" | "node" | "static" | "unknown";
export type DetectionEvidence = { field: string; value: string | boolean | number; confidence: number; source: string };
export type ProjectDetection = {
  root: string;
  packageManager: PackageManager;
  framework: Framework;
  confidence: number;
  commands: Partial<Record<"install" | "lint" | "typecheck" | "test" | "build" | "preview", string>>;
  probablePort?: number;
  buildDirectory?: string;
  git: { present: boolean; branch?: string };
  features: { envExample: boolean; docker: boolean; ci: boolean; sitemap: boolean; seoConfig: boolean };
  evidence: DetectionEvidence[];
};

async function exists(file: string): Promise<boolean> {
  return await stat(file).then(() => true).catch(() => false);
}

async function json(file: string): Promise<Record<string, unknown> | undefined> {
  return await readFile(file, "utf8").then((text) => JSON.parse(text) as Record<string, unknown>).catch(() => undefined);
}

function dependencyNames(pkg: Record<string, unknown> | undefined): Set<string> {
  const names = new Set<string>();
  for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
    const dependencies = pkg?.[key];
    if (dependencies && typeof dependencies === "object") for (const name of Object.keys(dependencies)) names.add(name);
  }
  return names;
}

function choosePackageManager(root: string, pkg: Record<string, unknown> | undefined, evidence: DetectionEvidence[]): Promise<PackageManager> {
  return (async () => {
    const candidates: Array<[PackageManager, string]> = [["pnpm", "pnpm-lock.yaml"], ["yarn", "yarn.lock"], ["bun", "bun.lockb"], ["bun", "bun.lock"], ["npm", "package-lock.json"]];
    for (const [manager, file] of candidates) {
      if (await exists(path.join(root, file))) {
        evidence.push({ field: "packageManager", value: manager, confidence: 0.98, source: file });
        return manager;
      }
    }
    const declared = typeof pkg?.packageManager === "string" ? pkg.packageManager.split("@")[0] : undefined;
    if (declared && ["npm", "pnpm", "yarn", "bun"].includes(declared)) {
      evidence.push({ field: "packageManager", value: declared, confidence: 0.9, source: "package.json#packageManager" });
      return declared as PackageManager;
    }
    return "unknown";
  })();
}

function chooseFramework(deps: Set<string>, files: Set<string>, hasPackage: boolean, evidence: DetectionEvidence[]): { framework: Framework; confidence: number; port?: number; output?: string } {
  const rules: Array<{ framework: Framework; dependency?: string; files?: string[]; port?: number; output?: string }> = [
    { framework: "next", dependency: "next", files: ["next.config.js", "next.config.mjs", "next.config.ts"], port: 3000, output: ".next" },
    { framework: "nuxt", dependency: "nuxt", files: ["nuxt.config.ts", "nuxt.config.js"], port: 3000, output: ".output" },
    { framework: "astro", dependency: "astro", files: ["astro.config.mjs", "astro.config.ts"], port: 4321, output: "dist" },
    { framework: "sveltekit", dependency: "@sveltejs/kit", files: ["svelte.config.js"], port: 5173, output: "build" },
    { framework: "angular", dependency: "@angular/core", files: ["angular.json"], port: 4200, output: "dist" },
    { framework: "remix", dependency: "@remix-run/react", files: ["remix.config.js"], port: 3000, output: "build" },
    { framework: "vite", dependency: "vite", files: ["vite.config.ts", "vite.config.js", "vite.config.mjs"], port: 5173, output: "dist" },
    { framework: "svelte", dependency: "svelte", port: 5173, output: "dist" },
    { framework: "react", dependency: "react", port: 3000, output: "build" },
    { framework: "vue", dependency: "vue", port: 5173, output: "dist" }
  ];
  for (const rule of rules) {
    const dependencyProof = rule.dependency ? deps.has(rule.dependency) : false;
    const fileProof = rule.files?.some((file) => files.has(file)) ?? false;
    if (dependencyProof || fileProof) {
      const confidence = dependencyProof && fileProof ? 0.99 : dependencyProof ? 0.9 : 0.82;
      evidence.push({ field: "framework", value: rule.framework, confidence, source: dependencyProof ? `package.json dependency ${rule.dependency}` : `project config file` });
      return { framework: rule.framework, confidence, port: rule.port, output: rule.output };
    }
  }
  if (files.has("artisan") && files.has("composer.json")) {
    evidence.push({ field: "framework", value: "laravel", confidence: 0.98, source: "artisan + composer.json" });
    return { framework: "laravel", confidence: 0.98, port: 8000, output: "public" };
  }
  if (hasPackage) {
    evidence.push({ field: "framework", value: "node", confidence: 0.55, source: "package.json" });
    return { framework: "node", confidence: 0.55 };
  }
  if (files.has("index.html")) {
    evidence.push({ field: "framework", value: "static", confidence: 0.75, source: "index.html" });
    return { framework: "static", confidence: 0.75, output: "." };
  }
  return { framework: "unknown", confidence: 0 };
}

function commandPrefix(manager: PackageManager): { install?: string; run: (script: string) => string } {
  if (manager === "pnpm") return { install: "pnpm install --frozen-lockfile", run: (script) => `pnpm run ${script}` };
  if (manager === "yarn") return { install: "yarn install --immutable", run: (script) => `yarn ${script}` };
  if (manager === "bun") return { install: "bun install --frozen-lockfile", run: (script) => `bun run ${script}` };
  if (manager === "npm") return { install: "npm ci", run: (script) => `npm run ${script}` };
  return { run: (script) => script };
}

async function gitBranch(root: string): Promise<string | undefined> {
  return await new Promise((resolve) => {
    const child = spawn("git", ["-C", root, "branch", "--show-current"], { shell: false, windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.on("error", () => resolve(undefined));
    child.on("close", (code) => resolve(code === 0 ? output.trim() || undefined : undefined));
  });
}

export async function detectProject(rootInput = process.cwd()): Promise<ProjectDetection> {
  const root = path.resolve(rootInput);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  const packageJson = await json(path.join(root, "package.json"));
  const scripts = packageJson?.scripts && typeof packageJson.scripts === "object" ? packageJson.scripts as Record<string, unknown> : {};
  const deps = dependencyNames(packageJson);
  const evidence: DetectionEvidence[] = [];
  const packageManager = await choosePackageManager(root, packageJson, evidence);
  const detected = chooseFramework(deps, files, Boolean(packageJson), evidence);
  const prefix = commandPrefix(packageManager);
  const commands: ProjectDetection["commands"] = {};
  if (prefix.install) commands.install = prefix.install;
  for (const name of ["lint", "typecheck", "test", "build"] as const) {
    if (typeof scripts[name] === "string") {
      commands[name] = prefix.run(name);
      evidence.push({ field: `commands.${name}`, value: commands[name]!, confidence: 0.98, source: `package.json#scripts.${name}` });
    }
  }
  const previewName = ["preview", "start", "dev"].find((name) => typeof scripts[name] === "string");
  if (previewName) {
    commands.preview = prefix.run(previewName);
    evidence.push({ field: "commands.preview", value: commands.preview, confidence: previewName === "preview" ? 0.95 : 0.75, source: `package.json#scripts.${previewName}` });
  }
  const gitPresent = await exists(path.join(root, ".git"));
  const ci = await exists(path.join(root, ".github", "workflows")) || files.has(".gitlab-ci.yml") || files.has("azure-pipelines.yml");
  const sitemap = files.has("sitemap.xml") || await exists(path.join(root, "public", "sitemap.xml"));
  const seoConfig = ["next-seo.config.js", "next-sitemap.config.js", "robots.txt", "codex-seo.config.json"].some((file) => files.has(file)) || await exists(path.join(root, "public", "robots.txt"));
  return {
    root,
    packageManager,
    framework: detected.framework,
    confidence: detected.confidence,
    commands,
    probablePort: detected.port,
    buildDirectory: detected.output,
    git: { present: gitPresent, branch: gitPresent ? await gitBranch(root) : undefined },
    features: {
      envExample: files.has(".env.example"),
      docker: files.has("Dockerfile") || files.has("docker-compose.yml") || files.has("compose.yml"),
      ci,
      sitemap,
      seoConfig
    },
    evidence
  };
}
