import { getSetting, setSetting } from '../db';
import { encryptSecret, decryptSecret } from '../crypto';

// Vectis is AI-provider-agnostic. A tenant configures ONE provider; keys live
// server-side in the settings table and are never returned to the browser.
export const AI_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic (Claude)', needsKey: true, needsBaseUrl: false, modelHint: 'e.g. claude-sonnet-4-5' },
  { id: 'openai', name: 'OpenAI', needsKey: true, needsBaseUrl: false, modelHint: 'e.g. gpt-4o-mini' },
  { id: 'gemini', name: 'Google Gemini', needsKey: true, needsBaseUrl: false, modelHint: 'e.g. gemini-1.5-flash' },
  { id: 'azure', name: 'Azure OpenAI / AI Foundry', needsKey: true, needsBaseUrl: true, modelHint: 'your deployment name' },
  { id: 'copilot', name: 'GitHub Copilot (OpenAI-compatible gateway)', needsKey: false, needsBaseUrl: true, modelHint: 'e.g. gpt-4o (served via your Copilot gateway)' },
  { id: 'custom', name: 'Local / OpenAI-compatible', needsKey: false, needsBaseUrl: true, modelHint: 'e.g. llama3.1 (Ollama), any model id' },
  { id: 'mock', name: 'Built-in demo AI (no key)', needsKey: false, needsBaseUrl: false, modelHint: 'no model needed' },
] as const;

export type ProviderId = (typeof AI_PROVIDERS)[number]['id'];
const VALID = new Set(AI_PROVIDERS.map((p) => p.id));

export interface AIConfig {
  provider: string;
  model: string;
  baseUrl: string;
  enabled: boolean;
  hasKey: boolean; // whether a key is stored (never the key itself)
}
export interface AIConfigFull extends AIConfig {
  apiKey: string;
}

export function readAIConfig(tenantId: string): AIConfig {
  const raw = getSetting(tenantId, 'ai_config', '');
  if (!raw) return { provider: '', model: '', baseUrl: '', enabled: false, hasKey: false };
  try {
    const c = JSON.parse(raw) as Partial<AIConfig>;
    const keyless = c.provider === 'mock' || c.provider === 'custom' || c.provider === 'copilot';
    const hasKey = keyless || !!getSetting(tenantId, 'ai_key', '');
    return {
      provider: c.provider || '',
      model: c.model || '',
      baseUrl: c.baseUrl || '',
      enabled: !!c.enabled,
      hasKey,
    };
  } catch {
    return { provider: '', model: '', baseUrl: '', enabled: false, hasKey: false };
  }
}

export function readAIConfigFull(tenantId: string): AIConfigFull {
  const c = readAIConfig(tenantId);
  return { ...c, apiKey: decryptSecret(getSetting(tenantId, 'ai_key', '')) };
}

export function writeAIConfig(
  tenantId: string,
  input: { provider: string; model?: string; baseUrl?: string; enabled?: boolean; apiKey?: string },
): { ok: boolean; error?: string } {
  if (!VALID.has(input.provider as ProviderId)) return { ok: false, error: 'unknown provider' };
  setSetting(
    tenantId,
    'ai_config',
    JSON.stringify({
      provider: input.provider,
      model: (input.model || '').trim(),
      baseUrl: (input.baseUrl || '').trim().replace(/\/+$/, ''),
      enabled: input.enabled !== false,
    }),
  );
  // Only overwrite the stored key when a new one is supplied (blank = keep existing).
  // Stored encrypted at rest.
  if (typeof input.apiKey === 'string' && input.apiKey.trim() !== '') {
    setSetting(tenantId, 'ai_key', encryptSecret(input.apiKey.trim()));
  }
  return { ok: true };
}

/** True when the tenant has a usable AI provider turned on. */
export function aiEnabled(tenantId: string): boolean {
  const c = readAIConfig(tenantId);
  if (!c.enabled || !c.provider) return false;
  if (c.provider === 'mock') return true;
  // Local endpoints and Copilot gateways carry their own auth, so no key required here.
  if (c.provider === 'custom' || c.provider === 'copilot') return true;
  return c.hasKey;
}
