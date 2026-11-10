/* sync2.js — motor da sincronização V8 (PLAN §R5). Sem DOM: tudo que toca o app vem por `host`, tudo que toca o disco por `io`.
   Servidor decide ordem e durabilidade; o conteúdo vai cifrado por registro; merge roda aqui. */
import { b64u, unb64u } from './sync.js';
import { COLLS, canon, same, diffLocal, mergeAny, countsDeletes, compareBases } from './merge.js';
import { needsV2 } from './core.js';
const te = new TextEncoder(), td = new TextDecoder(), C = () => globalThis.crypto.subtle;
export const SALT2 = 'meus-plantoes/sync/v2', ITER2 = 600000, BATCH_OPS = 200, BATCH_BYTES = 6 * 1024 * 1024;
export const uid2 = () => globalThis.crypto.randomUUID();

/* 512 bits da frase: prova (só no cadastro, nunca guardada) | chave de dados (CryptoKey não extraível) */
export const newSalt = () => b64u(globalThis.crypto.getRandomValues(new Uint8Array(16)));
export async function deriveKeysV2(passphrase, salt, iterations = ITER2) {
  const base = await C().importKey('raw', te.encode(passphrase.normalize('NFC').trim()), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await C().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode(`${SALT2}/${salt}`), iterations }, base, 512));
  return { proof: b64u(bits.slice(0, 32)), key: await C().importKey('raw', bits.slice(32, 64), 'AES-GCM', false, ['encrypt', 'decrypt']) };
}
const aad = (coll, id) => te.encode(`${coll}/${id}`);
export async function sealRec(key, coll, id, data) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  /* R9: v 2 quando o registro usa algo que a V8 não representa — o aparelho V8 o põe em quarentena em vez de interpretá-lo errado; senão v 1, legível por todos */
  const ct = new Uint8Array(await C().encrypt({ name: 'AES-GCM', iv, additionalData: aad(coll, id) }, key, te.encode(JSON.stringify({ v: needsV2(coll, data) ? 2 : 1, data }))));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return b64u(out);
}
export async function openRec(key, coll, id, blob) {
  const u = unb64u(blob);
  const pt = await C().decrypt({ name: 'AES-GCM', iv: u.slice(0, 12), additionalData: aad(coll, id) }, key, u.slice(12));
  const o = JSON.parse(td.decode(pt));
  if ((o.v !== 1 && o.v !== 2) || !o.data || o.data.id !== id) throw new Error('registro incompatível');
  return o.data;
}
export async function sealSnapshot(key, obj) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await C().encrypt({ name: 'AES-GCM', iv, additionalData: te.encode('snapshot') }, key, te.encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return b64u(out);
}

export async function openSnapshot(key, blob) {
  const u = unb64u(blob), pt = await C().decrypt({ name: 'AES-GCM', iv: u.slice(0, 12), additionalData: te.encode('snapshot') }, key, u.slice(12));
  return JSON.parse(td.decode(pt));
}

export class Net extends Error { constructor(m = 'offline') { super(m); this.net = true; } }
export class Auth extends Error { constructor(m) { super(m); this.auth = m; } }
export function apiClient(url, tokenFn, { timeoutMs = 30000, fetchImpl = globalThis.fetch } = {}) {
  async function call(method, path, body, noauth) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), timeoutMs); let r;
    try { r = await fetchImpl(`${url}/v2${path}`, { method, cache: 'no-store', signal: ac.signal, headers: { ...(noauth ? {} : { Authorization: 'Bearer ' + tokenFn() }), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { throw new Net(); } finally { clearTimeout(t); }
    let b = {}; try { b = await r.json(); } catch (e) { b = {}; }
    if (r.status === 401) throw new Auth(b.error || 'unauthorized');
    if (r.status === 503 && b.error === 'disabled') throw Object.assign(new Net('disabled'), { disabled: true });
    if (r.status === 404 && /^\/(changes|push)/.test(path)) throw Object.assign(new Net('disabled'), { disabled: true }); /* servidor anterior, sem /v2 */
    if (r.status >= 500 || r.status === 429) throw new Net('server');
    return { status: r.status, body: b };
  }
  return {
    status: () => call('GET', '/status', null, true), enroll: b => call('POST', '/enroll', b, true),
    push: ops => call('POST', '/push', { ops }), changes: (s, l = 500) => call('GET', `/changes?since=${s}&limit=${l}`),
    devices: () => call('GET', '/devices'), revoke: id => call('DELETE', `/devices/${encodeURIComponent(id)}`), snapshot: (label, blob) => call('POST', '/snapshots', { label, blob }), snapshots: () => call('GET', '/snapshots'), snapshotGet: id => call('GET', `/snapshots/${id}`),
  };
}

/* host: {view() → {coll:{id:rec}}, put(coll,id,rec|null), addConflict(c), revive(shift), commit(patches) → Promise durável, durable() → bool, validate() → [erros], rev() → número}
   io: {load() → {state, shadow:Map, inflight:[]}, write(puts, dels) → Promise, } · api: apiClient · key: CryptoKey · on: estado para a tela */
export function createEngine({ host, io, api, on = () => { }, batchOps = BATCH_OPS }) {
  const K = { sh: k => `s:sh:${k}`, if: id => `s:if:${id}`, state: 's:state' };
  let forceDeletes = false;
  const pendingOf = (st) => { const d = diffLocal(host.view(), st.shadow); return { ops: d, n: d.length + st.inflight.filter(i => !d.some(o => o.coll === i.coll && o.id === i.id)).length }; };

  async function decryptAll(state, changes) {
    const out = [], bad = [];
    for (const c of changes) {
      try { out.push({ ...c, data: c.deleted ? null : await openRec(state.key, c.coll, c.id, c.blob) }); }
      catch (e) { bad.push(`${c.coll}/${c.id}`); }
    }
    return { out, bad };
  }
  async function pullAll(state, from) {
    let since = from, all = [], page;
    do {
      page = (await api.changes(since)).body;
      all.push(...page.changes); since = page.last;
    } while (page.more);
    return { changes: all, last: since, epoch: page.epoch };
  }
  /* ÚNICA função em que o sincronizador muda S. Síncrona: decide, aplica e pede gravação no mesmo tick. */
  function applyRemote(items, shadow, patches) {
    const undo = [], view = host.view(), newConf = [], revive = [];
    for (const { coll, id, rev, data, base: baseOv } of items) {
      const k = `${coll}/${id}`, sh = shadow.get(k), base = baseOv !== undefined ? baseOv : (sh?.data ?? null), local = view[coll]?.[id] ?? null;
      const r = mergeAny(coll, base, local, data);
      undo.push([coll, id, local]);
      host.put(coll, id, r.local);
      for (const c of r.conflicts) newConf.push({ ...c, coll, rec: id });
      if (r.revive) revive.push(r.local);
      shadow.set(k, { rev, data }); patches.push({ key: K.sh(k), value: { rev, data } });
    }
    const errs = host.validate();
    if (errs.length) { for (const [c, i, v] of undo.reverse()) host.put(c, i, v); throw Object.assign(new Error('dados recebidos inconsistentes: ' + errs[0]), { invalid: true }); }
    newConf.forEach(host.addConflict); revive.forEach(host.revive);
  }
  async function resolveResults(st, ops, results) {
    const byOp = new Map(results.map(r => [r.op_id, r])), puts = [], dels = [], conflicts = [];
    for (const o of ops) {
      const r = byOp.get(o.op_id); if (!r) throw new Error('resposta incompleta do servidor');
      if (r.status === 'op_id_reused') throw new Error('identificador de operação reutilizado');
      dels.push(K.if(o.op_id));
      if (r.status === 'applied' || r.status === 'duplicate') { const v = { rev: r.rev, data: o.deleted ? null : o.sent }; st.shadow.set(`${o.coll}/${o.id}`, v); puts.push({ key: K.sh(`${o.coll}/${o.id}`), value: v }); }
      else conflicts.push({ o, cur: r.current });
    }
    st.inflight = st.inflight.filter(i => !ops.some(o => o.op_id === i.op_id));
    if (conflicts.length) { /* merge contra a base imutável do envio, nunca contra a sombra corrente */
      const items = [], bad = [];
      for (const { o, cur } of conflicts) {
        let data = null; const rev = cur ? cur.rev : 0;
        if (cur && !cur.deleted) { try { data = await openRec(st.state.key, o.coll, o.id, cur.blob); } catch (e) { bad.push(o.id); continue; } }
        items.push({ coll: o.coll, id: o.id, rev, data, base: o.base });
      }
      if (bad.length) throw new Error('registro ilegível no servidor');
      const patches = [...puts, ...dels.map(key => ({ key }))]; applyRemote(items, st.shadow, patches); await host.commit(patches);
    } else await io.write(puts, dels);
  }
  async function sendBatch(st, ops) {
    const r = await api.push(ops.map(o => ({ op_id: o.op_id, coll: o.coll, id: o.id, base_rev: o.base_rev, deleted: o.deleted, blob: o.deleted ? null : o.blob })));
    if (r.status !== 200) throw new Error('push recusado: ' + (r.body.error || r.status));
    await resolveResults(st, ops, r.body.results);
  }
  async function pushPending(st) {
    for (let turn = 0; turn < 5; turn++) {
      const ops = diffLocal(host.view(), st.shadow);
      if (!ops.length) return true;
      const g = countsDeletes(ops, st.shadow);
      if (g.massive && !forceDeletes) { on({ state: 'confirm', pending: ops.length, deletes: g.del }); return false; }
      forceDeletes = false;
      let i = 0;
      while (i < ops.length) {
        const batch = []; let bytes = 0;
        while (i < ops.length && batch.length < batchOps && bytes < BATCH_BYTES) {
          const o = ops[i++], blob = o.deleted ? null : await sealRec(st.state.key, o.coll, o.id, o.data);
          const rec = { op_id: uid2(), coll: o.coll, id: o.id, base_rev: o.base_rev, base: o.base, sent: o.data, deleted: o.deleted, blob };
          batch.push(rec); bytes += (blob || '').length;
        }
        await io.write(batch.map(b => ({ key: K.if(b.op_id), value: b })), []); /* inflight durável antes de sair pela rede */
        st.inflight.push(...batch);
        await sendBatch(st, batch);
      }
    }
    return diffLocal(host.view(), st.shadow).length === 0;
  }
  async function resetForRegression(st, epoch) {
    const dels = [...st.shadow.keys()].map(K.sh).concat(st.inflight.map(i => K.if(i.op_id)));
    st.shadow.clear(); st.inflight = []; st.state.cursor = 0; st.state.epoch = epoch;
    await io.write([{ key: K.state, value: st.state }], dels);
  }
  async function pullApply(st) {
    let p = await pullAll(st.state, st.state.cursor || 0);
    if ((st.state.epoch && p.epoch !== st.state.epoch) || p.last < (st.state.cursor || 0)) { await resetForRegression(st, p.epoch); p = await pullAll(st.state, 0); }
    const fresh = p.changes.filter(c => (st.shadow.get(`${c.coll}/${c.id}`)?.rev || 0) < c.rev);
    const { out, bad } = await decryptAll(st.state, fresh);
    if (bad.length) throw Object.assign(new Error('quarantine'), { quarantine: true, bad }); /* não aplica nem avança: um registro ilegível nunca some em silêncio */
    if (p.last === (st.state.cursor || 0) && !out.length) return {};
    const items = out.map(c => ({ coll: c.coll, id: c.id, rev: c.rev, data: c.data }));
    st.state = { ...st.state, cursor: p.last, epoch: p.epoch };
    const patches = [{ key: K.state, value: st.state }];
    if (!items.length) { await io.write(patches, []); return { applied: 0 }; } /* só eco das próprias escritas: nada mudou em S */
    applyRemote(items, st.shadow, patches);
    await host.commit(patches);
    return { applied: items.length };
  }
  async function cycle() {
    await host.refresh?.(); /* sob o lock: esta aba pode estar velha em relação à sombra gravada pela aba que sincronizou antes. Sem isso, velho vira "exclusão" */
    const st = await io.load();
    if (!st.state?.active || !st.state.token) return { idle: true };
    if (!host.durable()) return { later: true };
    try {
      on({ state: 'syncing', pending: pendingOf(st).n });
      if (st.inflight.length) { /* desfecho desconhecido: reenvia o mesmo op_id antes de qualquer outra coisa */
        for (let i = 0; i < st.inflight.length;) { const b = st.inflight.slice(i, i + batchOps); await sendBatch(st, b); }
      }
      await pullApply(st);
      const clean = await pushPending(st);
      if (!clean) return { blocked: true };
      if (st.state.verifyPending) { /* a ativação só termina com a conferência limpa, ainda que a rede tenha caído no meio */
        const d = await verify(st);
        if (d.length) { st.state = { ...st.state, active: false }; await io.write([{ key: K.state, value: st.state }], []); on({ state: 'error', reason: 'verify', pending: 0 }); return { error: 'verify' }; }
        st.state = { ...st.state, verifyPending: false };
      }
      const ok = new Date().toISOString(); st.state = { ...st.state, last_ok: ok }; await io.write([{ key: K.state, value: st.state }], []);
      on({ state: 'synced', pending: 0, last_ok: ok });
      return { ok: true };
    } catch (e) {
      const pending = pendingOf(st).n;
      if (e.net) { on({ state: e.disabled ? 'paused' : 'waiting', pending, last_ok: st.state.last_ok }); return { net: true }; }
      if (e.auth) { st.state = { ...st.state, active: false, token: null, key: null, revoked: e.auth === 'revoked' }; await io.write([{ key: K.state, value: st.state }], []); on({ state: 'error', reason: e.auth, pending }); return { auth: e.auth }; }
      if (e.name === 'ConflictError') return { later: true }; /* outra aba gravou: o próximo ciclo recomeça do cursor durável */
      on({ state: 'error', reason: e.quarantine ? 'quarantine' : e.invalid ? 'invalid' : (e.message || 'erro'), pending }); return { error: e.message };
    }
  }
  /* ativação (SPEC §3): nada muda antes da confirmação */
  async function preview(state) {
    const { changes, last, epoch } = await pullAll(state, 0);
    const { out, bad } = await decryptAll(state, changes);
    if (bad.length) throw new Error('frase-senha diferente ou dado corrompido no servidor');
    const server = Object.fromEntries(COLLS.map(c => [c, {}])), tomb = [];
    for (const c of out) { if (c.deleted) tomb.push(c); else server[c.coll][c.id] = c.data; }
    return { cmp: compareBases(host.view(), server), rev: host.rev(), out, last, epoch };
  }
  /* união sem base: sombra vazia ⇒ ausência nunca vira exclusão; tombstone do servidor sem base mantém o local e o sobe de novo */
  async function union(state, pv) {
    const st = { state: { ...state, active: true, verifyPending: true, cursor: pv.last, epoch: pv.epoch }, shadow: new Map(), inflight: [] }, patches = [{ key: K.state, value: st.state }];
    applyRemote(pv.out.map(c => ({ coll: c.coll, id: c.id, rev: c.rev, data: c.data })), st.shadow, patches);
    await host.commit(patches);
    return st;
  }
  /* registros que o servidor não tinha precisam sair idênticos da união */
  function untouched(before, pv) {
    const srv = new Set(pv.out.map(c => `${c.coll}/${c.id}`)), view = host.view(), diffs = [];
    for (const coll of COLLS) for (const [id, v] of Object.entries(before[coll] || {})) if (!srv.has(`${coll}/${id}`) && !same(view[coll]?.[id], v)) diffs.push(`${coll}/${id}`);
    return diffs;
  }
  /* conferência: baixa e decifra tudo e compara registro a registro com o que o aparelho recebeu como confirmado */
  async function verify(st) {
    const { changes } = await pullAll(st.state, 0), { out, bad } = await decryptAll(st.state, changes), diffs = [...bad], seen = new Set();
    for (const c of out) {
      const k = `${c.coll}/${c.id}`, sh = st.shadow.get(k); seen.add(k);
      if (!sh) { if (c.rev > (st.state.cursor || 0)) continue; diffs.push(k); continue; } /* gravado por outro aparelho depois do pull */
      if (c.rev > sh.rev) continue;
      if (c.deleted ? sh.data !== null : !same(sh.data, c.data)) diffs.push(k);
    }
    for (const [k, sh] of st.shadow) if (sh.data !== null && !seen.has(k)) diffs.push(k);
    return diffs;
  }
  return { cycle, preview, union, verify, untouched, pushPending, allowDeletes() { forceDeletes = true; }, pendingCount: async () => pendingOf(await io.load()).n, canon };
}
