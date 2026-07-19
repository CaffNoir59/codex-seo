import { assertSafeRedirectTarget, assertSafeUrl, validateUrlSyntax, type SafeUrl } from "./url-safety.js";

export type NetworkAccessPolicy = {
  allowPrivateNetwork: boolean;
  allowedOrigins: string[];
  initialOrigin: string;
};

export function createNetworkAccessPolicy(rawUrl: string, options: { allowPrivateNetwork?: boolean; allowedOrigins?: string[] } = {}): NetworkAccessPolicy {
  const initial = validateUrlSyntax(rawUrl, { allowPrivateNetwork: options.allowPrivateNetwork });
  const initialOrigin = initial.origin;
  return {
    allowPrivateNetwork: Boolean(options.allowPrivateNetwork),
    allowedOrigins: [...new Set([initialOrigin, ...(options.allowedOrigins ?? [])])].sort(),
    initialOrigin
  };
}

export async function assertPolicyUrl(rawUrl: string, policy?: NetworkAccessPolicy): Promise<SafeUrl> {
  if (policy?.allowPrivateNetwork) {
    return { url: validateUrlSyntax(rawUrl, { allowPrivateNetwork: true }), resolvedAddresses: [] };
  }
  return assertSafeUrl(rawUrl);
}

export async function assertPolicyRedirectTarget(fromUrl: string | URL, location: string, policy?: NetworkAccessPolicy): Promise<URL> {
  if (policy?.allowPrivateNetwork) {
    const base = typeof fromUrl === "string" ? new URL(fromUrl) : fromUrl;
    return validateUrlSyntax(new URL(location, base).toString(), { allowPrivateNetwork: true });
  }
  return assertSafeRedirectTarget(fromUrl, location);
}

export function validatePolicyUrlSyntax(rawUrl: string, policy?: NetworkAccessPolicy): URL {
  return validateUrlSyntax(rawUrl, { allowPrivateNetwork: policy?.allowPrivateNetwork });
}
