import { access, readFile } from "node:fs/promises";
import { createSign } from "node:crypto";
import { dirname, resolve } from "node:path";
import { GscError } from "./gsc-errors.js";
import type { GscAuthMode } from "./gsc-schema.js";

export type GscAuthConfig = { mode?: GscAuthMode; credentialsPath?: string; privacyMode?: boolean; reportDir?: string };
export type GscAuthToken = { accessToken: string; expiresAt: number; source: "service-account" | "oauth" };

type ServiceAccountJson = { client_email?: string; private_key?: string; token_uri?: string; project_id?: string };

export function sanitizeCredentialPath(path: string): string {
  return path.replace(/[^\\/]+$/g, "[credential-file]");
}

export function assertCredentialPathAllowed(credentialsPath: string, reportDir?: string): string {
  const resolved = resolve(credentialsPath);
  if (reportDir) {
    const output = resolve(reportDir);
    if (resolved === output || resolved.startsWith(`${output}\\`) || resolved.startsWith(`${output}/`)) {
      throw new GscError("gsc.credentials-in-report-dir", "GSC credentials must not be stored inside the report directory");
    }
  }
  return resolved;
}

export async function loadServiceAccountCredentials(credentialsPath: string, reportDir?: string): Promise<ServiceAccountJson> {
  const resolved = assertCredentialPathAllowed(credentialsPath, reportDir);
  try { await access(resolved); } catch { throw new GscError("gsc.credentials-missing", `GSC credentials file not found: ${sanitizeCredentialPath(resolved)}`); }
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(resolved, "utf8")); } catch { throw new GscError("gsc.credentials-invalid-json", "GSC credentials JSON is invalid"); }
  const json = parsed as ServiceAccountJson;
  if (!json.client_email || !json.private_key) throw new GscError("gsc.credentials-missing-field", "GSC service account credentials require client_email and private_key");
  return json;
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function createServiceAccountJwt(credentials: ServiceAccountJson, nowSeconds = Math.floor(Date.now() / 1000)): string {
  if (!credentials.client_email || !credentials.private_key) throw new GscError("gsc.credentials-missing-field", "GSC service account credentials require client_email and private_key");
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/webmasters",
    aud: credentials.token_uri ?? "https://oauth2.googleapis.com/token",
    exp: nowSeconds + 3600,
    iat: nowSeconds
  }));
  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${claim}`);
  const signature = base64Url(sign.sign(credentials.private_key));
  return `${header}.${claim}.${signature}`;
}

export async function getGscAccessToken(config: GscAuthConfig, fetchImpl: typeof fetch = fetch): Promise<GscAuthToken> {
  const mode = config.mode ?? (config.credentialsPath ? "service-account" : "oauth");
  if (mode === "oauth") {
    const token = process.env.GSC_OAUTH_ACCESS_TOKEN;
    if (!token) throw new GscError("gsc.oauth-not-configured", "OAuth adapter is available, but no GSC_OAUTH_ACCESS_TOKEN was provided");
    return { accessToken: token, expiresAt: Date.now() + 300000, source: "oauth" };
  }
  const credentialsPath = config.credentialsPath ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentialsPath) throw new GscError("gsc.credentials-missing", "GSC service-account auth requires --gsc-credentials or GOOGLE_APPLICATION_CREDENTIALS");
  const credentials = await loadServiceAccountCredentials(credentialsPath, config.reportDir);
  const assertion = createServiceAccountJwt(credentials);
  const params = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion });
  const response = await fetchImpl(credentials.token_uri ?? "https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: params });
  if (!response.ok) throw new GscError("gsc.auth-google-error", `Google auth failed with status ${response.status}`, response.status >= 500 || response.status === 429);
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new GscError("gsc.auth-google-error", "Google auth response did not include an access token");
  return { accessToken: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000, source: "service-account" };
}