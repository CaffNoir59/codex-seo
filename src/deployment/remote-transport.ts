import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Client, type ConnectConfig, type FileEntryWithStats, type SFTPWrapper } from "ssh2";
import type { ProjectConfig } from "../project/config.js";
import { redactSecrets } from "../core/redaction.js";
import { resolveProjectPath } from "../security/project-policy.js";

export type RemoteEntry = { name: string; path: string; type: "file" | "directory" | "symlink"; size: number; modifiedAt?: number };
export type RemoteCommand = "php-version" | "node-version" | "disk-space" | "current-release";

export interface RemoteTransport {
  connect(): Promise<void>;
  close(): Promise<void>;
  exists(remotePath: string): Promise<boolean>;
  list(remotePath: string): Promise<RemoteEntry[]>;
  mkdir(remotePath: string, recursive?: boolean): Promise<void>;
  upload(localPath: string, remotePath: string): Promise<{ files: number; bytes: number; checksum: string }>;
  write(remotePath: string, data: string | Buffer): Promise<void>;
  read(remotePath: string): Promise<Buffer>;
  rename(source: string, destination: string): Promise<void>;
  copy(source: string, destination: string): Promise<void>;
  remove(remotePath: string, recursive?: boolean): Promise<void>;
  checksum(remotePath: string): Promise<string>;
  chmod(remotePath: string, mode: number): Promise<void>;
  symlink(target: string, linkPath: string): Promise<void>;
  readlink(linkPath: string): Promise<string | undefined>;
  run(command: RemoteCommand, root: string): Promise<{ code: number; stdout: string; stderr: string }>;
}

export class RemotePathError extends Error {
  readonly code = "remote.path-invalid";
}

export function validateRemotePath(value: string, options: { allowRelative?: boolean } = {}): string {
  if (!value || value.includes("\0") || /[\r\n]/.test(value)) throw new RemotePathError("Remote path is empty or contains control characters");
  const normalized = value.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!options.allowRelative && !normalized.startsWith("/")) throw new RemotePathError("Remote paths must be absolute");
  if (normalized.split("/").some((part) => part === ".." || part === ".")) throw new RemotePathError("Remote path traversal is not allowed");
  if (!/^[A-Za-z0-9_./@+\-]+$/.test(normalized)) throw new RemotePathError("Remote path contains unsupported characters");
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

export function sshHostFingerprint(key: Buffer): string {
  return "SHA256:" + createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
}

export function verifySshHostKey(key: Buffer, expectedFingerprint?: string, knownKeys: ReadonlySet<string> = new Set()): boolean {
  const expected = expectedFingerprint?.replace(/=+$/, "");
  return sshHostFingerprint(key) === expected || knownKeys.has(key.toString("base64"));
}

function callback<T>(register: (done: (error: Error | undefined, value: T) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => register((error, value) => error ? reject(error) : resolve(value)));
}

function operation(register: (done: (error?: Error | null) => void) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => register((error) => error ? reject(error) : resolve()));
}

function timeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(label + " timed out"), { code: "remote.timeout" })), timeoutMs);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

async function knownHostKeys(file: string, host: string, port: number): Promise<Set<string>> {
  const content = await readFile(file, "utf8");
  const candidates = new Set([host, "[" + host + "]:" + port]);
  const keys = new Set<string>();
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("|1|")) continue;
    const parts = line.split(/\s+/);
    if (parts.length >= 3 && parts[0].split(",").some((entry) => candidates.has(entry))) keys.add(parts[2]);
  }
  return keys;
}

export type SshTransportOptions = {
  projectRoot: string;
  deployment: ProjectConfig["deployment"];
  onLog?: (event: Record<string, unknown>) => void | Promise<void>;
};

export class SshSftpTransport implements RemoteTransport {
  private client?: Client;
  private sftpClient?: SFTPWrapper;
  private readonly timeoutMs: number;

  constructor(private readonly options: SshTransportOptions) {
    this.timeoutMs = options.deployment.transport.operationTimeoutMs;
  }

  private log(event: Record<string, unknown>): void {
    void this.options.onLog?.({ ...event, host: this.options.deployment.host, user: undefined });
  }

  private async connectionConfig(): Promise<ConnectConfig> {
    const deployment = this.options.deployment;
    const username = deployment.username ?? deployment.user;
    if (!deployment.host || !username) throw Object.assign(new Error("Remote host and username are required"), { code: "remote.config-invalid" });
    const verification = deployment.hostVerification;
    if (verification.strict && !verification.fingerprint && !verification.knownHostsPath) {
      throw Object.assign(new Error("Strict host verification requires a fingerprint or known_hosts file"), { code: "remote.host-unverified" });
    }
    const expectedFingerprint = verification.fingerprint?.replace(/=+$/, "");
    const known = verification.knownHostsPath
      ? await knownHostKeys(await resolveProjectPath(this.options.projectRoot, verification.knownHostsPath, { allowProtected: true }), deployment.host, deployment.port)
      : new Set<string>();
    const auth = deployment.authentication;
    const config: ConnectConfig = {
      host: deployment.host,
      port: deployment.port,
      username,
      readyTimeout: deployment.transport.connectTimeoutMs,
      keepaliveInterval: Math.min(10_000, deployment.transport.operationTimeoutMs),
      keepaliveCountMax: 3,
      hostVerifier: (key: Buffer): boolean => {
        if (!verification.strict) return true;
        return verifySshHostKey(key, expectedFingerprint, known);
      }
    };
    if (auth.type === "agent") {
      const socket = process.env[auth.agentEnv];
      if (!socket) throw Object.assign(new Error("SSH agent socket environment is not available"), { code: "remote.auth-unavailable" });
      config.agent = socket;
    } else {
      config.privateKey = await readFile(await resolveProjectPath(this.options.projectRoot, auth.privateKeyPath, { allowProtected: true }));
      if (auth.passphraseEnv) {
        const passphrase = process.env[auth.passphraseEnv];
        if (!passphrase) throw Object.assign(new Error("SSH key passphrase environment is not available"), { code: "remote.auth-unavailable" });
        config.passphrase = passphrase;
      }
    }
    return config;
  }

  async connect(): Promise<void> {
    if (this.client) return;
    const attempts = this.options.deployment.transport.reconnectAttempts + 1;
    let last: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const client = new Client();
      try {
        await timeout(new Promise<void>(async (resolve, reject) => {
          client.once("ready", resolve).once("error", reject).once("close", () => reject(new Error("SSH connection closed before ready")));
          try { client.connect(await this.connectionConfig()); } catch (error) { reject(error); }
        }), this.options.deployment.transport.connectTimeoutMs, "SSH connection");
        this.client = client;
        this.log({ type: "deployment", event: "connected", attempt });
        return;
      } catch (error) {
        client.end();
        last = error;
        this.log({ type: "deployment", event: "connection-failed", attempt, error: redactSecrets(error instanceof Error ? error.message : String(error)) });
      }
    }
    throw last;
  }

  async close(): Promise<void> {
    this.sftpClient?.end();
    this.client?.end();
    this.sftpClient = undefined;
    this.client = undefined;
  }

  private async sftp(): Promise<SFTPWrapper> {
    await this.connect();
    if (!this.sftpClient) {
      if (!this.client) throw new Error("SSH is unavailable");
      this.sftpClient = await timeout(callback<SFTPWrapper>((done) => this.client!.sftp(done)), this.timeoutMs, "SFTP startup");
    }
    return this.sftpClient;
  }

  async exists(remotePath: string): Promise<boolean> {
    const sftp = await this.sftp();
    const safe = validateRemotePath(remotePath);
    return timeout(callback((done) => sftp.stat(safe, done)), this.timeoutMs, "SFTP stat").then(() => true).catch(() => false);
  }

  async list(remotePath: string): Promise<RemoteEntry[]> {
    const sftp = await this.sftp();
    const safe = validateRemotePath(remotePath);
    const entries = await timeout(callback<FileEntryWithStats[]>((done) => sftp.readdir(safe, done)), this.timeoutMs, "SFTP list");
    return entries.filter((entry) => entry.filename !== "." && entry.filename !== "..").map((entry) => ({
      name: entry.filename,
      path: safe + "/" + entry.filename,
      type: entry.attrs.isDirectory() ? "directory" : entry.attrs.isSymbolicLink() ? "symlink" : "file",
      size: entry.attrs.size,
      modifiedAt: entry.attrs.mtime
    }));
  }

  async mkdir(remotePath: string, recursive = true): Promise<void> {
    const sftp = await this.sftp();
    const safe = validateRemotePath(remotePath);
    const paths = recursive ? safe.split("/").filter(Boolean).map((_, index, values) => "/" + values.slice(0, index + 1).join("/")) : [safe];
    for (const directory of paths) {
      if (!await this.exists(directory)) await timeout(operation((done) => sftp.mkdir(directory, { mode: this.options.deployment.permissions.directories }, done)), this.timeoutMs, "SFTP mkdir");
    }
  }

  private async uploadTree(localPath: string, remotePath: string, aggregate: { files: number; bytes: number; hash: ReturnType<typeof createHash> }): Promise<void> {
    const entry = await stat(localPath);
    if (entry.isDirectory()) {
      await this.mkdir(remotePath);
      for (const name of await readdir(localPath)) await this.uploadTree(path.join(localPath, name), remotePath + "/" + name, aggregate);
      return;
    }
    if (!entry.isFile()) return;
    const sftp = await this.sftp();
    await this.mkdir(remotePath.slice(0, remotePath.lastIndexOf("/")));
    await timeout(operation((done) => sftp.fastPut(localPath, remotePath, { mode: this.options.deployment.permissions.files }, done)), this.timeoutMs, "SFTP upload");
    if (this.options.deployment.transport.preserveTimestamps) {
      await timeout(operation((done) => sftp.utimes(remotePath, entry.atime, entry.mtime, done)), this.timeoutMs, "SFTP timestamps").catch(() => undefined);
    }
    const data = await readFile(localPath);
    aggregate.hash.update(remotePath).update(data);
    aggregate.files += 1;
    aggregate.bytes += entry.size;
  }

  async upload(localPath: string, remotePath: string): Promise<{ files: number; bytes: number; checksum: string }> {
    const safe = validateRemotePath(remotePath);
    const aggregate = { files: 0, bytes: 0, hash: createHash("sha256") };
    await this.uploadTree(localPath, safe, aggregate);
    return { files: aggregate.files, bytes: aggregate.bytes, checksum: aggregate.hash.digest("hex") };
  }

  async write(remotePath: string, data: string | Buffer): Promise<void> {
    const sftp = await this.sftp();
    const safe = validateRemotePath(remotePath);
    await this.mkdir(safe.slice(0, safe.lastIndexOf("/")));
    await timeout(operation((done) => sftp.writeFile(safe, data, { mode: this.options.deployment.permissions.files }, done)), this.timeoutMs, "SFTP write");
  }

  async read(remotePath: string): Promise<Buffer> {
    const sftp = await this.sftp();
    return timeout(callback<Buffer>((done) => sftp.readFile(validateRemotePath(remotePath), done)), this.timeoutMs, "SFTP read");
  }

  async rename(source: string, destination: string): Promise<void> {
    const sftp = await this.sftp();
    const from = validateRemotePath(source);
    const to = validateRemotePath(destination);
    await this.mkdir(to.slice(0, to.lastIndexOf("/")));
    await timeout(operation((done) => sftp.rename(from, to, done)), this.timeoutMs, "SFTP rename");
  }

  async copy(source: string, destination: string): Promise<void> {
    const from = validateRemotePath(source);
    const to = validateRemotePath(destination);
    const entries = await this.list(from).catch(() => undefined);
    if (!entries) {
      await this.write(to, await this.read(from));
      return;
    }
    await this.mkdir(to);
    for (const entry of entries) await this.copy(entry.path, to + "/" + entry.name);
  }

  async remove(remotePath: string, recursive = false): Promise<void> {
    const sftp = await this.sftp();
    const safe = validateRemotePath(remotePath);
    const entries = recursive ? await this.list(safe).catch(() => undefined) : undefined;
    if (entries) {
      for (const entry of entries) await this.remove(entry.path, true);
      await timeout(operation((done) => sftp.rmdir(safe, done)), this.timeoutMs, "SFTP rmdir");
    } else {
      await timeout(operation((done) => sftp.unlink(safe, done)), this.timeoutMs, "SFTP unlink");
    }
  }

  async checksum(remotePath: string): Promise<string> {
    const safe = validateRemotePath(remotePath);
    const entries = await this.list(safe).catch(() => undefined);
    const hash = createHash("sha256");
    if (!entries) return hash.update(await this.read(safe)).digest("hex");
    for (const entry of entries.sort((a, b) => a.path.localeCompare(b.path))) {
      hash.update(entry.path);
      if (entry.type === "file") hash.update(await this.read(entry.path));
      else if (entry.type === "directory") hash.update(await this.checksum(entry.path));
    }
    return hash.digest("hex");
  }

  async chmod(remotePath: string, mode: number): Promise<void> {
    const sftp = await this.sftp();
    await timeout(operation((done) => sftp.chmod(validateRemotePath(remotePath), mode, done)), this.timeoutMs, "SFTP chmod");
  }

  async symlink(target: string, linkPath: string): Promise<void> {
    const sftp = await this.sftp();
    await timeout(operation((done) => sftp.symlink(validateRemotePath(target), validateRemotePath(linkPath), done)), this.timeoutMs, "SFTP symlink");
  }

  async readlink(linkPath: string): Promise<string | undefined> {
    const sftp = await this.sftp();
    return timeout(callback<string>((done) => sftp.readlink(validateRemotePath(linkPath), done)), this.timeoutMs, "SFTP readlink").catch(() => undefined);
  }

  async run(command: RemoteCommand, root: string): Promise<{ code: number; stdout: string; stderr: string }> {
    await this.connect();
    if (!this.client) throw new Error("SSH is unavailable");
    const safeRoot = validateRemotePath(root);
    const commands: Record<RemoteCommand, string> = {
      "php-version": "php -v",
      "node-version": "node --version",
      "disk-space": "df -Pk " + safeRoot,
      "current-release": "readlink " + safeRoot + "/current"
    };
    return timeout(new Promise((resolve, reject) => {
      this.client!.exec(commands[command], (error, stream) => {
        if (error) return reject(error);
        let stdout = "";
        let stderr = "";
        stream.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
        stream.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
        stream.on("close", (code: number | null) => resolve({ code: code ?? 1, stdout: redactSecrets(stdout).slice(0, 20_000), stderr: redactSecrets(stderr).slice(0, 20_000) }));
      });
    }), this.timeoutMs, "SSH command");
  }
}
