/* sync.js — backup cifrado no servidor do dono (R5_PLAN rev 6 §C). Sem DOM; testável em node.
   Cifra no aparelho (PBKDF2 → AES-GCM), servidor só-acrescenta, prazo `not_after` conferido no servidor e UMA regra no
   aparelho: lê a última versão do servidor; se a etiqueta não é a do estado atual, envia o estado atual. */
const te = new TextEncoder(), td = new TextDecoder();
const C = () => globalThis.crypto.subtle;
export const SALT = 'meus-plantoes/sync/v1', ITERATIONS = 600000, WINDOW_S = 60, JSON_SLACK = 1024;

export const b64u = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
export const unb64u = s => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(-s.length & 3)); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

/* 768 bits da frase: chave AES | token (prova de posse do cofre; id = sha256(token)) | chave de etiqueta (HMAC) */
export async function deriveKeys(passphrase, iterations = ITERATIONS) {
  const base = await C().importKey('raw', te.encode(passphrase.normalize('NFC').trim()), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await C().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode(SALT), iterations }, base, 768));
  const token = bits.slice(32, 64);
  return { id: hex(await C().digest('SHA-256', token)), token: b64u(token), key: b64u(bits.slice(0, 32)), tagkey: b64u(bits.slice(64, 96)) };
}
/* etiqueta opaca do conteúdo: o servidor guarda e devolve, mas não calcula nem inverte */
export async function tagOf(tagkey, sha) {
  const k = await C().importKey('raw', unb64u(tagkey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await C().sign('HMAC', k, te.encode(sha)));
}
const aes = (key, use) => C().importKey('raw', unb64u(key), 'AES-GCM', false, [use]);
const pipe = (u8, t) => new Response(new Blob([u8]).stream().pipeThrough(t)).arrayBuffer();
/* JSON → gzip → AES-GCM (IV aleatório de 12 bytes) → base64url(IV‖cifra) */
export async function seal(key, obj) {
  const z = new Uint8Array(await pipe(te.encode(JSON.stringify(obj)), new CompressionStream('gzip')));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await C().encrypt({ name: 'AES-GCM', iv }, await aes(key, 'encrypt'), z));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return b64u(out);
}
export async function open(key, blob) {
  let z; const u = unb64u(blob);
  try { z = await C().decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, await aes(key, 'decrypt'), u.slice(12)); }
  catch (e) { throw Object.assign(new Error('frase-senha diferente ou dado corrompido'), { type: 'decrypt' }); }
  return JSON.parse(td.decode(await pipe(new Uint8Array(z), new DecompressionStream('gzip'))));
}

/* cliente HTTP: devolve {status, body}; rede/tempo esgotado ⇒ lança {type:'offline'} */
export function client(url, id, token, { timeoutMs = 45000, fetchImpl = globalThis.fetch } = {}) {
  async function call(method, path, body) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetchImpl(`${url}/v1/vault/${id}${path}`, { method, cache: 'no-store', signal: ac.signal, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      let b = null; try { b = await r.json(); } catch (e) { b = null; }
      return { status: r.status, body: b || {} };
    } catch (e) { throw Object.assign(new Error('sem conexão com o servidor'), { type: 'offline' }); }
    finally { clearTimeout(t); }
  }
  return { meta: () => call('GET', '?meta=1'), latest: () => call('GET', ''), versions: () => call('GET', '/versions'), version: n => call('GET', `/v/${n}`), put: body => call('PUT', '', body) };
}

/* A regra única (R5_PLAN rev 6 §C). cfg é mutado; save(cfg) → true só se a gravação foi verificada.
   snap = {tag, seal: () => Promise<blob>} do estado DURÁVEL atual. Devolve um destes:
   {done, version} · {wait: segundos pela hora do servidor} · {retry, error} (pending pode ficar) · {again} · {error} */
export async function step(cfg, snap, api, save, { windowS = WINDOW_S } = {}) {
  const m = await api.meta(); /* sempre pergunta: o aparelho não guarda crença sobre o servidor */
  if (m.status !== 200 && m.status !== 404) return { retry: true, error: m.status === 429 ? 'rate' : m.status === 401 ? 'auth' : 'server' };
  const now = m.body.now;
  if (typeof now !== 'number' || !isFinite(now)) return { retry: true, error: 'server' };
  if (cfg.pending) { /* envio sem desfecho: só decide quando a hora do servidor passou do prazo daquele envio */
    if (now <= cfg.pending.not_after) return { wait: cfg.pending.not_after - now + 2 };
    cfg.pending = null; if (!save(cfg)) return { error: 'persist' };
  }
  if (m.status === 200) {
    if (cfg.enroll || !cfg.created) { cfg.enroll = null; cfg.created = true; if (!save(cfg)) return { error: 'persist' }; }
    if (m.body.tag === snap.tag) { cfg.last_version = m.body.version; cfg.last_ok_at = new Date().toISOString(); save(cfg); return { done: 'in_sync', version: m.body.version }; }
  } else if (cfg.created) return { error: 'vault_gone' };
  else if (!cfg.enroll) return { error: 'need_enroll' };
  const blob = await snap.seal();
  if (m.body.max_body && blob.length + JSON_SLACK > m.body.max_body) return { error: 'too_large', size: blob.length }; /* função só dos dados atuais: sem PUT repetido */
  cfg.pending = { tag: snap.tag, not_after: now + windowS };
  if (!save(cfg)) { cfg.pending = null; return { error: 'persist' }; } /* sem gravação verificada, o PUT não sai */
  let r;
  try { r = await api.put({ tag: snap.tag, not_after: cfg.pending.not_after, blob, ...(cfg.enroll ? { enroll: cfg.enroll } : {}) }); }
  catch (e) { return { retry: true, error: 'offline' }; } /* desfecho incerto: pending fica e o prazo decide */
  const s = r.status, clear = () => { cfg.pending = null; save(cfg); };
  if (s === 201 || s === 200) { /* 200 = o servidor já tinha exatamente este conteúdo como última versão */ cfg.created = true; cfg.enroll = null; cfg.last_version = r.body.version; cfg.last_ok_at = new Date().toISOString(); clear(); return { done: 'sent', version: r.body.version }; }
  if (s === 412) { clear(); return { again: true }; } /* recusado sob o lock: definitivo */
  if (s === 403) { cfg.enroll = null; clear(); return { error: 'enroll_bad' }; }
  if (s === 413) { clear(); return { error: 'too_large', size: blob.length }; }
  if (s === 507) { clear(); return { error: 'vault_limit' }; }
  if (s === 400 || s === 401) { clear(); return { error: s === 401 ? 'auth' : 'server' }; }
  return { retry: true, error: s === 429 ? 'rate' : 'server' }; /* 5xx: pode ter gravado — pending fica */
}
