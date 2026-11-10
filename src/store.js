/* store.js — persistência do Meus Plantões (SPEC §3, contrato de persistência):
   um banco IndexedDB, cinco coleções; gravação integral por commit; FILA ÚNICA (um commit por vez, sempre com o instantâneo
   mais novo — commits coalescem); REVISÃO MONOTÔNICA (meta.rev); sucesso só em transaction.oncomplete (savedRev = rev);
   erro/abort/quota → estado explícito 'error' ("não gravado") com nova tentativa. Sem DOM; a fila é testável em node. */
export const DB_NAME = 'meus-plantoes', DB_VERSION = 1, STORES = ['places', 'templates', 'series', 'shifts', 'meta'];

/* M6: migração por versão — cada caso leva o banco de oldVersion para a seguinte; DB_VERSION sobe junto com o último caso */
export function migrate(db, oldVersion, tx) {
  switch (oldVersion) {
    case 0: for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'meta' ? 'key' : 'id' }); /* falls through */
    default: return DB_VERSION;
  }
}
export function openDB(name = DB_NAME, idb = globalThis.indexedDB) {
  return new Promise((res, rej) => {
    const r = idb.open(name, DB_VERSION);
    r.onupgradeneeded = e => migrate(r.result, e.oldVersion, r.transaction);
    r.onsuccess = () => { const db = r.result; db.onversionchange = () => db.close(); res(db); };
    r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('banco bloqueado por outra aba'));
  });
}
export function readAll(db) {
  return new Promise((res, rej) => {
    const tx = db.transaction(STORES, 'readonly'), out = {};
    for (const s of STORES) { const q = tx.objectStore(s).getAll(); q.onsuccess = () => { out[s] = q.result; }; }
    tx.oncomplete = () => res(out); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('leitura abortada'));
  });
}
/* uma transação sobre as cinco coleções: limpar + gravar; resolve só em oncomplete */
export function readMeta(db) { return new Promise((res, rej) => { const tx = db.transaction(['meta'], 'readonly'); const q = tx.objectStore('meta').get('meta'); q.onsuccess = () => res(q.result?.value || null); q.onerror = () => rej(q.error); }); }
/* expectRev (opcional): a revisão gravada precisa ser exatamente esta; se outra aba gravou antes, a transação aborta com ConflictError (duas abas concorrentes) */
/* V8: linhas s:* de `meta` (sombra, estado, envios pendentes) sobrevivem à regravação; `patches` entram na mesma transação (dados + sombra + cursor) */
export function writeAll(db, data, expectRev = null, patches = []) {
  return new Promise((res, rej) => {
    let tx; try { tx = db.transaction(STORES, 'readwrite'); } catch (e) { return rej(e); }
    let failed = null;
    tx.oncomplete = () => failed ? rej(failed) : res(); tx.onerror = () => rej(failed || tx.error || new Error('erro de gravação')); tx.onabort = () => rej(failed || tx.error || new Error('gravação abortada'));
    const issue = () => { /* qualquer exceção ao emitir os pedidos (valor não clonável, falha do runtime) aborta a transação inteira: nunca fica meia gravação (E2E-15) */
      try { for (const s of STORES) { const os = tx.objectStore(s); if (s === 'meta') os.delete(IDBKeyRange.upperBound('s:', true)); else os.clear(); for (const r of data[s] || []) os.put(r); } const m = tx.objectStore('meta'); for (const p of patches) { if (p.value === undefined) m.delete(p.key); else m.put({ key: p.key, value: p.value }); } }
      catch (e) { failed = e; try { tx.abort(); } catch (_) { rej(e); } }
    };
    if (expectRev == null) return issue();
    const q = tx.objectStore('meta').get('meta');
    q.onsuccess = () => { const stored = q.result?.value?.rev ?? 0; if (stored !== expectRev) { failed = Object.assign(new Error(`dados gravados por outra aba (revisão ${stored}, esperada ${expectRev})`), { name: 'ConflictError', storedRev: stored }); try { tx.abort(); } catch (_) { rej(failed); } return; } issue(); };
    q.onerror = () => { failed = q.error || new Error('leitura da revisão falhou'); try { tx.abort(); } catch (_) { rej(failed); } };
  });
}
const S_RANGE = () => IDBKeyRange.bound('s:', 's:￿');
export function readSync(db) { return new Promise((res, rej) => { const tx = db.transaction(['meta'], 'readonly'), q = tx.objectStore('meta').getAll(S_RANGE()); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
/* gravação só de metadados de sincronização, sem tocar nos dados */
export function writeSync(db, puts, dels = []) { return new Promise((res, rej) => { const tx = db.transaction(['meta'], 'readwrite'), m = tx.objectStore('meta'); for (const p of puts) m.put(p); for (const k of dels) m.delete(k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('gravação abortada')); }); }
/* Fila de commits. write(snapshot) → Promise. onState({state, rev, savedRev, error}) a cada mudança: 'saved' | 'saving' | 'error'. */
export function createCommitter(write, onState = () => { }, startRev = 0) {
  let patchesQ = [], rev = startRev, savedRev = startRev, state = 'saved', error = null, running = null, pendingSnap = null, waiters = [], revWaiters = []; /* B2: a revisão continua da persistida */
  const settleRevs = () => { revWaiters = revWaiters.filter(w => { if (savedRev >= w.r) { w.res(savedRev); return false; } if (state === 'error') { w.rej(error); return false; } return true; }); };
  const emit = () => onState({ state, rev, savedRev, error });
  const idle = () => !running && (!pendingSnap || state === 'error'); /* ocioso = nada em curso; com erro, o pendente espera retry() */
  const settle = () => { if (idle()) for (const w of waiters.splice(0)) w(); };
  async function loop() {
    while (pendingSnap) {
      const { snap, r } = pendingSnap; pendingSnap = null; state = 'saving'; error = null; emit();
      const taken = patchesQ; patchesQ = [];
      try { await write(snap(), savedRev, taken); savedRev = Math.max(savedRev, r); if (!pendingSnap) state = 'saved'; settleRevs(); }
      catch (e) { patchesQ = taken.concat(patchesQ); error = e; state = 'error'; if (!pendingSnap) pendingSnap = { snap, r }; running = null; emit(); settleRevs(); settle(); return; } /* para a fila: o instantâneo falhado fica pendente ("não gravado") até retry() ou o próximo commit */
    }
    running = null; emit(); settle();
  }
  const start = () => { if (!running && pendingSnap && state !== 'error') running = loop(); };
  return {
    /* snap: função que devolve o instantâneo no momento em que a gravação começa (sempre o estado mais novo) */
    /* devolve a revisão e uma promessa que só resolve quando essa revisão estiver durável (B2) */
    commit(snap, patches = []) { patchesQ.push(...patches); rev++; const r = rev; pendingSnap = { snap: () => { const s = snap(); return { ...s, meta: (s.meta || []).map(m => m.key === 'meta' ? { ...m, value: { ...m.value, rev: r } } : m) }; }, r }; if (state === 'error') state = 'saving'; queueMicrotask(start); const done = new Promise((res, rej) => revWaiters.push({ r, res, rej })); done.catch(() => { }); /* quem não espera a promessa não recebe rejeição solta: o estado 'error' já é observável */ return { rev: r, done }; },
    retry() { if (pendingSnap && !running) { state = 'saving'; running = loop(); } },
    /* depois de recarregar os dados gravados por outra aba: a fila passa a partir da revisão durável atual e descarta o pendente */
    resync(newRev) { patchesQ = []; pendingSnap = null; rev = newRev; savedRev = newRev; state = 'saved'; error = null; for (const w of revWaiters.splice(0)) w.rej(Object.assign(new Error('descartado após recarga'), { name: 'ConflictError' })); emit(); settle(); },
    /* dispara imediatamente o que estiver pendente (pagehide) */
    flushNow() { start(); },
    whenIdle() { return new Promise(res => { if (idle()) res(); else waiters.push(res); }); },
    get state() { return state; }, get rev() { return rev; }, get savedRev() { return savedRev; }, get error() { return error; },
  };
}
