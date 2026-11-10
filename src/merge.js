/* merge.js — regras puras da sincronização V8 (SPEC_V8 §2 + adendo). Sem DOM, sem relógio de decisão; testado em node. */
export const COLLS = ['places', 'templates', 'series', 'shifts', 'conflicts'];
const sortKeys = v => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => [k, sortKeys(v[k])])) : v;
export const canon = v => JSON.stringify(sortKeys(v));
export const same = (a, b) => canon(a ?? null) === canon(b ?? null);
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
/* R9 (adendo Gauntlet): unidades atômicas — marca e valor nunca se separam num merge. Os primeiros `core` campos são os da V8. */
const TIME = ['start', 'end', 'minutes', 'start_pending', 'end_pending', 'end_days'], AMOUNT = ['amount_cents', 'amount_zero'], EXPECT = ['expected_on', 'expected_pending'], META = new Set(['id', 'updated_at']);
const UNITS = [[TIME, 'horário', 3], [AMOUNT, 'valor', 1], [EXPECT, 'previsão', 1]];
export const UNIT_FIELDS = { 'horário': TIME, valor: AMOUNT, 'previsão': EXPECT };
const unitOf = (k, grouped) => (grouped && UNITS.find(([u]) => u.includes(k))?.[0]) || [k];
/* conflito de uma unidade: quando nenhuma marca do R9 está em jogo, sai na forma exata da V8 (horário {start,end,minutes}; valor e previsão escalares) */
function unitConflict(u, path, kept, other) {
  const def = UNITS.find(([x]) => x === u); if (!def) return { field: path + u[0], kept, other, kind: 'field' };
  const [, name, core] = def, extra = u.slice(core).some(k => kept?.[k] != null || other?.[k] != null);
  if (extra) return { field: path + name, kept, other, kind: 'field' };
  const cut = o => core === 1 ? (o?.[u[0]] ?? null) : Object.fromEntries(u.slice(0, core).map(k => [k, o?.[k] ?? null]));
  return { field: path + (core === 1 ? u[0] : name), kept: cut(kept), other: cut(other), kind: 'field' };
}
const pick = (o, u) => u.length === 1 ? (o?.[u[0]] ?? null) : Object.fromEntries(u.map(k => [k, o?.[k] ?? null]));
const put = (t, src, u) => { for (const k of u) { if (src?.[k] === undefined) delete t[k]; else t[k] = clone(src[k]); } };

/* três vias por unidade de campo sobre `out` (já cópia do remoto). base null = sem ancestral comum */
function mergeFields(out, base, local, remote, { grouped, path = '', skip = new Set() }, cfs, decide) {
  const keys = new Set([...Object.keys(local || {}), ...Object.keys(remote || {}), ...Object.keys(base || {})]), done = new Set();
  for (const k of keys) {
    if (META.has(k) || skip.has(k) || done.has(k)) continue;
    const u = unitOf(k, grouped); u.forEach(x => done.add(x));
    const b = pick(base, u), l = pick(local, u), r = pick(remote, u);
    if (same(l, r)) continue;
    if (base && same(l, b)) continue; /* só o remoto mudou: `out` já tem */
    if (base && same(r, b)) { put(out, local, u); continue; } /* só o local mudou */
    const d = decide ? decide(u, l, r, base) : null;
    if (d === 'local') put(out, local, u);
    if (d !== 'silent') cfs.push(unitConflict(u, path, clone(d === 'local' ? l : r), clone(d === 'local' ? r : l)));
  }
}
const shiftDecide = (u, l, r, base) => {
  if (u[0] === 'paid_at') return !r && l ? 'local' : 'remote'; /* recebido vence vazio; duas datas: fica a do servidor */
  if (u[0] === 'deleted_at') { if (l && r) return 'silent'; if (!base) return r ? 'local' : 'remote'; return 'remote'; } /* sem base, fica vivo */
  return 'remote';
};
function mergeSeries(out, base, local, remote, cfs) {
  mergeFields(out, base, local, remote, { skip: new Set(['overrides', 'exdates', 'tpl']) }, cfs);
  const bo = base?.overrides || {}, lo = local?.overrides || {}, ro = remote?.overrides || {}, oo = { ...ro };
  for (const k of new Set([...Object.keys(lo), ...Object.keys(ro), ...Object.keys(bo)])) {
    if (same(lo[k], ro[k]) || (base && same(lo[k], bo[k]))) continue;
    if (base && same(ro[k], bo[k])) { if (lo[k] === undefined) delete oo[k]; else oo[k] = clone(lo[k]); continue; }
    cfs.push({ field: `overrides.${k}`, kept: clone(ro[k] ?? null), other: clone(lo[k] ?? null), kind: 'field' });
  }
  out.overrides = oo;
  const bx = new Set(base?.exdates || []), lx = new Set(local?.exdates || []), rx = new Set(remote?.exdates || []);
  const removed = d => [...bx].filter(x => !d.has(x)), gone = new Set([...removed(lx), ...removed(rx)]);
  out.exdates = [...new Set([...lx, ...rx])].filter(x => !gone.has(x)).sort();
  if (local?.tpl || remote?.tpl) { const t = clone(remote?.tpl) || {}; mergeFields(t, base?.tpl || null, local?.tpl, remote?.tpl, { grouped: true, path: 'tpl.' }, cfs); out.tpl = t; }
}
/* registros existentes dos dois lados → {merged, conflicts, revive} */
export function mergeRecord(coll, base, local, remote) {
  const out = clone(remote), cfs = [];
  if (coll === 'series') mergeSeries(out, base, local, remote, cfs);
  else if (coll === 'shifts') mergeFields(out, base, local, remote, { grouped: true }, cfs, shiftDecide);
  else mergeFields(out, base, local, remote, { grouped: coll === 'templates' }, cfs);
  let revive = false;
  if (coll === 'shifts' && base) { /* regras cruzadas: exclusão × edição e exclusão × recebimento */
    const edited = o => Object.keys({ ...base, ...o }).some(k => !META.has(k) && k !== 'deleted_at' && !same(o[k], base[k]));
    const lDel = !base.deleted_at && local.deleted_at, rDel = !base.deleted_at && remote.deleted_at;
    if (!!lDel !== !!rDel) { /* exatamente um lado apagou */
      const other = lDel ? remote : local;
      if (edited(other)) {
        if (other.paid_at && !base.paid_at) { delete out.deleted_at; revive = true; cfs.push({ field: 'deleted_at', kept: null, other: clone(lDel ? local.deleted_at : remote.deleted_at), kind: 'received_wins' }); }
        else cfs.push({ field: 'deleted_at', kept: clone(out.deleted_at ?? null), other: null, kind: 'deleted_edited' });
      }
    }
  }
  return { merged: out, conflicts: cfs, revive };
}
/* aplica um registro remoto (data null = tombstone) sobre o local → {local, conflicts, revive} */
export function mergeAny(coll, base, local, remoteData) {
  if (coll === 'conflicts') return { local: remoteData, conflicts: [], revive: false };
  const rec = (kept, other) => [{ field: '*', kept: clone(kept), other: clone(other), kind: 'recreated' }];
  if (remoteData === null) {
    if (local == null) return { local: null, conflicts: [], revive: false };
    if (base && same(local, base)) return { local: null, conflicts: [], revive: false };
    return { local, conflicts: rec(local, null), revive: false }; /* edição (ou recebimento) recria o registro */
  }
  if (local == null) {
    if (base && same(remoteData, base)) return { local: null, conflicts: [], revive: false };
    return { local: clone(remoteData), conflicts: base ? rec(remoteData, null) : [], revive: false };
  }
  const m = mergeRecord(coll, base, local, remoteData);
  return { local: m.merged, conflicts: m.conflicts, revive: m.revive };
}
/* pendências do aparelho: registro diferente da sombra. state = {coll: {id: rec}}, shadow = Map('coll/id' → {rev, data}) */
export function diffLocal(state, shadow) {
  const ups = [], dels = [];
  for (const coll of COLLS) for (const [id, data] of Object.entries(state[coll] || {})) {
    if (data.sample) continue; /* dado de exemplo nunca sincroniza */
    const sh = shadow.get(`${coll}/${id}`);
    if (!sh || sh.data === null || !same(sh.data, data)) ups.push({ coll, id, base_rev: sh?.rev || 0, base: sh?.data ?? null, data: clone(data), deleted: false });
  }
  for (const [k, sh] of shadow) { if (sh.data === null) continue; const c = k.indexOf('/'), coll = k.slice(0, c), id = k.slice(c + 1); if (!state[coll]?.[id]) dels.push({ coll, id, base_rev: sh.rev, base: sh.data, data: null, deleted: true }); }
  dels.sort((a, b) => COLLS.indexOf(b.coll) - COLLS.indexOf(a.coll));
  return [...ups, ...dels]; /* criação em ordem topológica, exclusão na inversa */
}
export function countsDeletes(ops, shadow) {
  const live = [...shadow.values()].filter(s => s.data !== null).length;
  const del = ops.filter(o => o.deleted || (o.coll === 'shifts' && o.data?.deleted_at && o.base && !o.base.deleted_at)).length;
  return { del, live, massive: del > 10 && del > live * 0.3 };
}
const shiftKey = s => [s.start, s.end, s.place || '', s.title].join('|');
const totals = shifts => { const live = shifts.filter(s => !s.deleted_at); return { count: live.length, cents: live.reduce((a, s) => a + (s.amount_cents || 0), 0), paid: live.filter(s => s.paid_at).reduce((a, s) => a + (s.amount_cents || 0), 0) }; };
/* prévia da migração: local = {coll:{id:rec}}, server = {coll:{id:rec}} */
export function compareBases(local, server) {
  const r = { equal: 0, onlyLocal: 0, onlyServer: 0, divergent: 0, dupes: 0 };
  for (const coll of COLLS.filter(c => c !== 'conflicts')) {
    const L = Object.fromEntries(Object.entries(local[coll] || {}).filter(([, v]) => !v.sample)), R = server[coll] || {};
    for (const id of new Set([...Object.keys(L), ...Object.keys(R)])) {
      if (!L[id]) r.onlyServer++; else if (!R[id]) r.onlyLocal++;
      else { const a = { ...L[id], updated_at: 0 }, b = { ...R[id], updated_at: 0 }; if (same(a, b)) r.equal++; else r.divergent++; }
    }
  }
  const ls = Object.values(local.shifts || {}).filter(s => !s.sample), rs = Object.values(server.shifts || {}), byKey = new Map(rs.map(s => [shiftKey(s), s.id]));
  for (const s of ls) if (byKey.has(shiftKey(s)) && byKey.get(shiftKey(s)) !== s.id) r.dupes++;
  r.local = totals(ls); r.server = totals(rs);
  return r;
}
/* salvar um formulário: só os campos que o usuário mudou (orig ≠ novo) */
export function applyChanged(target, orig, next, skip = ['updated_at']) {
  const cfs = [], done = new Set();
  for (const k of new Set([...Object.keys(orig), ...Object.keys(next)])) {
    if (skip.includes(k) || k === 'id' || done.has(k)) continue;
    const u = unitOf(k, true); u.forEach(x => done.add(x)); /* horário é uma unidade também aqui */
    const o = pick(orig, u), n = pick(next, u), t = pick(target, u);
    if (same(o, n)) continue;
    if (!same(t, o) && !same(t, n)) { /* mudou por fora também: fica o valor corrente (já visível aos outros) e o digitado vira conflito; recebido vence vazio */
      const keepTyped = k === 'paid_at' && !t && n;
      cfs.push(unitConflict(u, '', clone(keepTyped ? n : t), clone(keepTyped ? t : n)));
      if (!keepTyped) continue;
    }
    put(target, next, u);
  }
  return cfs;
}
