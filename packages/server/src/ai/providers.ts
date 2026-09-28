// One chat() entry point that speaks to any provider. Adapters normalize each
// vendor's HTTP shape to a simple {system, messages} -> string call. Node 18+
// global fetch is used; no SDKs, so the bundle stays tiny and dependency-free.

export interface ChatMsg { role: 'user' | 'assistant'; content: string }
export interface ChatOpts { system?: string; messages: ChatMsg[]; maxTokens?: number; temperature?: number }
export interface ProviderCfg { provider: string; model: string; baseUrl?: string; apiKey?: string }

const TIMEOUT_MS = 30_000;

async function httpJSON(url: string, init: RequestInit): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(`network error contacting provider: ${(e as Error).message}`);
  }
  clearTimeout(timer);
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try { const j = JSON.parse(text); msg = j.error?.message || j.error?.msg || j.message || j.error || msg; } catch { /* keep text */ }
    throw new Error(`provider ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  try { return JSON.parse(text); } catch { throw new Error('provider returned non-JSON response'); }
}

// ---- OpenAI & any OpenAI-compatible endpoint (Ollama, LM Studio, Groq, Together, vLLM…) ----
async function openaiChat(cfg: ProviderCfg, o: ChatOpts): Promise<string> {
  const base = (cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const messages = [...(o.system ? [{ role: 'system', content: o.system }] : []), ...o.messages];
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  const data = await httpJSON(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: cfg.model, messages, temperature: o.temperature ?? 0.2, max_tokens: o.maxTokens ?? 800 }),
  });
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

// ---- Azure OpenAI (OpenAI shape, different URL + auth) ----
async function azureChat(cfg: ProviderCfg, o: ChatOpts): Promise<string> {
  if (!cfg.baseUrl) throw new Error('Azure needs the resource endpoint as Base URL');
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const ver = '2024-02-15-preview';
  const url = `${base}/openai/deployments/${encodeURIComponent(cfg.model)}/chat/completions?api-version=${ver}`;
  const messages = [...(o.system ? [{ role: 'system', content: o.system }] : []), ...o.messages];
  const data = await httpJSON(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'api-key': cfg.apiKey ?? '' },
    body: JSON.stringify({ messages, temperature: o.temperature ?? 0.2, max_tokens: o.maxTokens ?? 800 }),
  });
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

// ---- Anthropic (Claude) ----
async function anthropicChat(cfg: ProviderCfg, o: ChatOpts): Promise<string> {
  const base = (cfg.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
  const data = await httpJSON(`${base}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey ?? '', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: o.maxTokens ?? 800,
      ...(o.system ? { system: o.system } : {}),
      messages: o.messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  return (Array.isArray(data.content) ? data.content.map((c: any) => c.text ?? '').join('') : '').trim();
}

// ---- Google Gemini ----
async function geminiChat(cfg: ProviderCfg, o: ChatOpts): Promise<string> {
  const base = (cfg.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
  const url = `${base}/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.apiKey ?? '')}`;
  const data = await httpJSON(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...(o.system ? { systemInstruction: { parts: [{ text: o.system }] } } : {}),
      contents: o.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: o.maxTokens ?? 800, temperature: o.temperature ?? 0.2 },
    }),
  });
  const parts = data.candidates?.[0]?.content?.parts;
  return (Array.isArray(parts) ? parts.map((p: any) => p.text ?? '').join('') : '').trim();
}

// ---- Built-in demo AI: deterministic, offline, so the features work with zero setup ----
function mockChat(o: ChatOpts): string {
  const sys = (o.system || '').toLowerCase();
  const last = (o.messages[o.messages.length - 1]?.content || '');
  const lc = last.toLowerCase();
  if (sys.includes('"rootcause"') || sys.includes('root-cause json')) {
    const cause =
      /disk|storage|/.test(lc) && /disk|storage/.test(lc) ? 'Filesystem exhaustion from unbounded log/artifact growth on the affected host.'
      : /nginx|service|down|http/.test(lc) ? 'The web service process exited (likely OOM) and did not auto-restart.'
      : /cpu/.test(lc) ? 'A runaway application process is saturating CPU; not a known-safe auto-restart target.'
      : /memory|leak|creep/.test(lc) ? 'A worker process has a slow memory leak, gradually exhausting RAM.'
      : /network|switch|unreachable|ping/.test(lc) ? 'Upstream link/hardware fault; the device is not reachable over the network.'
      : /cert|tls|rotate/.test(lc) ? 'A TLS certificate is nearing expiry and must be rotated under change control.'
      : 'Resource pressure on the affected host degrading service health.';
    const steps =
      /disk|storage/.test(lc) ? ['Identify the largest reclaimable paths (logs, caches, temp).', 'Rotate/compress logs and clear stale caches (reversible).', 'Re-measure usage and confirm headroom.']
      : /nginx|service/.test(lc) ? ['Confirm the process state and last exit reason.', 'Restart the service via the service manager.', 'Verify the health check returns 200.']
      : /network/.test(lc) ? ['Confirm loss of ICMP/SNMP.', 'Dispatch on-site check of the link/hardware.', 'Fail over upstream if available.']
      : ['Gather current metrics and recent changes.', 'Apply the least-risk reversible mitigation.', 'Verify the condition cleared before closing.'];
    const rec = /cpu|network|cert|tls/.test(lc) ? 'escalate' : 'auto-remediate (reversible, then verify)';
    return JSON.stringify({ rootCause: cause, steps, recommendation: rec, confidence: /network|cpu/.test(lc) ? 'medium' : 'high' });
  }
  if (sys.includes('propose') && sys.includes('json')) {
    const action = /restart|nginx|service/.test(lc) ? 'restart-service' : /disk|clean|reclaim|space/.test(lc) ? 'reclaim-disk' : /memory|worker/.test(lc) ? 'recycle-worker' : 'investigate';
    const host = (last.match(/\b([a-z0-9-]+\d[a-z0-9-]*)\b/i) || [])[1] || 'the target host';
    return JSON.stringify({ understood: `Requested: ${last}`, action, host, category: action === 'restart-service' ? 'service' : action === 'reclaim-disk' ? 'disk' : action === 'recycle-worker' ? 'memory' : 'other', rationale: `Mapped the request to the '${action}' playbook on ${host}. This will run through the approval-gated autopilot.` });
  }
  if (sys.includes('resolution') || sys.includes('summarize') || sys.includes('runbook')) {
    return `Resolution summary: the reported condition was diagnosed, a reversible mitigation was applied on the affected host, and health was re-verified before closing. Root-cause: resource pressure from unbounded growth. Preventive follow-up: add a guardrail alert and a scheduled cleanup so this does not recur.`;
  }
  // General assistant chat.
  return `I'm the Vectis assistant (demo AI). Based on your current environment${lc ? `, regarding "${last.slice(0, 80)}"` : ''}: I can triage tickets by severity, explain what the autopilot did on any incident, and propose safe, reversible fixes that you approve before they run. Configure a real provider (Anthropic, OpenAI, Gemini, Azure, or a local model) in Integrations for full analysis.`;
}

export async function providerChat(cfg: ProviderCfg, o: ChatOpts): Promise<string> {
  switch (cfg.provider) {
    case 'mock': return mockChat(o);
    case 'anthropic': return anthropicChat(cfg, o);
    case 'gemini': return geminiChat(cfg, o);
    case 'azure': return azureChat(cfg, o);
    case 'openai':
    case 'custom':
    case 'copilot': // GitHub Copilot via an OpenAI-compatible gateway (base URL supplied)
    default: return openaiChat(cfg, o);
  }
}
