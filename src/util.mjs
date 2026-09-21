import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function nowIso() {
  return new Date().toISOString();
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function safeRef(value, length = 16) {
  return value ? sha256(value).slice(0, length) : null;
}

export function newOpaqueToken() {
  return randomBytes(32).toString('base64url');
}

export function ensureDir(directory) {
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function expandWindowsEnv(value, env = process.env) {
  if (typeof value !== 'string') return value;
  return value.replace(/%([^%]+)%/g, (_, name) => env[name] ?? `%${name}%`);
}

export function sanitizeOrigin(value) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return parsed.protocol;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

export function projectRootFrom(importMetaUrl) {
  return path.resolve(path.dirname(new URL(importMetaUrl).pathname.replace(/^\/(?:[A-Za-z]:)/, match => match.slice(1))), '..');
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
