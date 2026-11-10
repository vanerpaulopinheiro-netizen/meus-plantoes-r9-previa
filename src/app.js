/* Meus Plantões — app (B1). Base: protótipo aprovado G2/G2.1 + F01/F02 (congelado em 23/10/2026): mesmos tokens, componentes,
   gestos e DOM contratual. Acrescenta persistência (IndexedDB, contrato de durabilidade), cadastros, recorrência com escopos,
   lixeira, portabilidade (CSV/ICS/JSON) e PWA. Interface em módulo único; regras puras em core.js; codecs em codecs.js. */
import { TZ, pad, WD, WDL, WDS, cap, addDays, dim, addMonths, dow, diffDays, dm, dmy, wdm, monthOf, dayLong, dayFull, hrs, toMin, pl, sum, esc, isDateKey, isTimeHM, todayKey, nowIso, uid, day, endDay, t0, t1, night, brl, centsTxt, parseCents, PALETTE, isColorKey, effectiveColor, ruleDateFor, ruleTxtFor, validRule, cohortOf, overdueOf, occurrences, REP, seriesLabel, seriesFreq, freqTxt, scopeTargets, validateForm, repDates, mkShift as mkShiftCore,
  PAL, PAL_NAMES, SPECTRUM, ANCHORS, DEFAULT_START, amountKnown, isExpense, workedMin, pendingOf, formCents, spanOf, legacySpan, editShift, assignShift, datasetNeedsV2, overduePay, DEFAULT_COLORS, colorsClose } from './core.js';
import { openDB, readAll, readMeta, writeAll, createCommitter, readSync, writeSync } from './store.js';
import { validateDataset as validateDatasetV8 } from './core.js';
import { applyChanged, UNIT_FIELDS } from './merge.js';
import { createEngine, apiClient, deriveKeysV2, sealSnapshot, openSnapshot, newSalt, uid2 } from './sync2.js';
import { csvExport, csvExportGanhos, csvPreview, icsExport, icsPreview, backupMake, backupVerify, applyConflict } from './codecs.js';
import { APP_VERSION } from './version.js';
import { deriveKeys, tagOf, seal, open as openBlob, client as syncClient, step as syncStep, WINDOW_S } from './sync.js';

const Q = new URLSearchParams(location.search);
const TODAY_FIXED = isDateKey(Q.get('today')) ? Q.get('today') : null; /* testes: ?today=YYYY-MM-DD */
let TODAY = TODAY_FIXED || todayKey();
/* cor de cada local: um par claro/escuro (o app guarda a chave da paleta, não o hex). R9: PAL e PAL_NAMES moram em core.js (fonte única) */
const DEFAULT_RULE = { kind: 'days_after', days: 30 };

/* ---------- tema ---------- */
const mq = window.matchMedia('(prefers-color-scheme: dark)');
const lsGet = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };
const themePref = () => lsGet('mp-theme', 'system');
function applyTheme() { const p = themePref(); document.documentElement.dataset.theme = p === 'system' ? (mq.matches ? 'dark' : 'light') : p; }
const isDark = () => document.documentElement.dataset.theme === 'dark';
mq.addEventListener('change', () => { applyTheme(); if (S) render(false); });
applyTheme();
new MutationObserver(() => { if (themePref() !== 'system' && document.documentElement.dataset.theme !== themePref()) applyTheme(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- R9: toque sem perda ----------
   Um redesenho (innerHTML) entre o apertar e o soltar remove o botão tocado e o clique nunca chega (reproduzido em WebKit: r9/evidence/diag-header-antes.json).
   Enquanto houver dedo na tela, render() e renderToast() só marcam "pendente"; ao soltar, depois do despacho do clique, redesenham com o estado mais novo.
   Os redesenhos disparados pelo próprio toque acontecem no pointerup/click, quando `touching` já é falso (ouvinte em captura, registrado antes dos demais). */
const fingers = new Map(); /* pointerId → pointerType */ let renderPending = false, toastPending = false, touchTimer = null;
/* estados terminais: pointerup seguido de click (o redesenho roda logo DEPOIS do click, nunca entre os dois), pointerup sem click e pointercancel (250 ms).
   Auditoria MP-R9-006: cada dedo é um pointerId e o redesenho só sai quando todos saíram; não há tempo-limite que troque o DOM sob um dedo parado.
   Um pointerup que o sistema engoliu não trava o app: o próximo toque primário do mesmo tipo o descarta, e sair da aba zera tudo. */
function touchEnd(e) { if (e && e.pointerId != null) fingers.delete(e.pointerId); else fingers.clear(); if (fingers.size) return; clearTimeout(touchTimer); if (renderPending || toastPending) touchTimer = setTimeout(flushRender, 250); }
function flushRender() { if (fingers.size || !S) return; if (renderPending) render(false); else if (toastPending) renderToast(); }
addEventListener('pointerdown', e => { if (e.isPrimary) for (const [id, t] of fingers) if (t === e.pointerType) fingers.delete(id); /* isPrimary vale por tipo: o mouse não solta o que o dedo segura */ fingers.set(e.pointerId, e.pointerType); clearTimeout(touchTimer); }, true);
addEventListener('pointerup', touchEnd, true); addEventListener('pointercancel', touchEnd, true); document.addEventListener('visibilitychange', () => { if (document.hidden) touchEnd(); });
addEventListener('click', () => { if (renderPending || toastPending) { clearTimeout(touchTimer); setTimeout(flushRender, 0); } }); /* window, fase de borbulha: depois de todos os ouvintes do clique */
/* aviso acima do teclado do iPhone: elementos fixos no rodapé ficam atrás do teclado; --kb = altura coberta */
if (window.visualViewport) { const vv = window.visualViewport, kb = () => document.documentElement.style.setProperty('--kb', Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) + 'px'); vv.addEventListener('resize', kb); vv.addEventListener('scroll', kb); }

/* ---------- estado ---------- */
let S = null, db = null, committer = null;
const META_DEFAULT = () => ({ schema_version: 1 /* R9: 2 quando há registro que a V8 não representa (needsV2); recalculado em snapshot() */, timezone: TZ, week_start: 0, last_backup_at: null, last_backup_sha256: null, sample_loaded: false, restore_undo: null, rev: 0 });
/* só os dados (coleções + meta), sem mexer no estado de tela — usado na abertura e ao recarregar o que outra aba gravou */
function applyRaw(raw) {
  const shifts = [...(raw.shifts || [])].sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id)); /* getAll() devolve por id; a ordem útil é cronológica */
  S.places = Object.fromEntries((raw.places || []).map(p => [p.id, p])); S.templates = raw.templates || []; S.series = raw.series || [];
  S.shifts = shifts.filter(s => !s.deleted_at); S.trash = shifts.filter(s => !!s.deleted_at); S.meta = { ...META_DEFAULT(), ...((raw.meta || []).find(m => m.key === 'meta')?.value || {}) };
  S.conflicts = Object.fromEntries((raw.meta || []).filter(m => m.key.startsWith('c:')).map(m => [m.value.id, m.value]));
}
function hydrate(raw) {
  S = { view: 'cal', month: TODAY.slice(0, 7), sel: TODAY, pay: TODAY.slice(0, 7), cohort: 'cash', filter: 'all', showGot: false, calMode: lsGet('mp-cal', 'pontos'),
    seriesId: null, sheet: null, form: null, pform: null, tform: null, imp: null, toast: null, keep: false, flash: null, slide: 0, save: { state: 'saved' }, update: null };
  applyRaw(raw);
}
/* duas abas: recarrega o que a outra aba gravou e descarta o que esta aba não conseguiu gravar; o usuário refaz a última ação */
let reloading = false;
async function reloadFromOtherTab(reason) {
  if (!db || reloading) return; reloading = true;
  try { const raw = await readAll(db); applyRaw(raw); committer.resync(S.meta.rev || 0); S.sheet = null; S.form = S.form && S.view === 'form' ? S.form : null; S.toastPending = null; S.clearUndoAt = null;
    if (reason === 'silent') { if (!['form', 'pform', 'tform', 'import'].includes(S.view)) render(false); return; }
    S.toast = { kind: 'conflict', msg: reason === 'conflict' ? 'Seus dados foram alterados em outra aba e recarregados aqui. Refaça a última ação.' : 'Dados atualizados a partir de outra aba.' }; render(false); }
  catch (e) { console.warn('recarga após outra aba falhou', e); } finally { reloading = false; }
}
async function checkOtherTab() { if (!db || !committer || committer.state !== 'saved') return; try { const m = await readMeta(db); if ((m?.rev || 0) > committer.savedRev) await reloadFromOtherTab('refresh'); } catch (e) { } }
const UNKNOWN_PLACE = { id: '?', name: '(local removido)', short: '?', color: 'w1', rule: DEFAULT_RULE, archived: true };
const NO_PLACE = { id: null, name: 'Sem local', short: '—', color: null, rule: null, archived: false }; /* R6: vínculo nulo, nunca um local fictício */
const P = id => id ? S.places[id] || UNKNOWN_PLACE : NO_PLACE;
const places = () => Object.values(S.places).filter(p => !p.archived);
const templates = () => S.templates.filter(t => !t.archived);
const byId = id => S.shifts.find(s => s.id === id);
const seriesById = id => S.series.find(x => x.id === id);
const tplById = id => S.templates.find(t => t.id === id);
const tplOf = se => se.tpl || tplById(se.template) || { title: 'Plantão', place: Object.keys(S.places)[0], start: '07:00', end: '19:00', amount_cents: 0 };
/* R7: cor EFETIVA de um plantão/modelo/formulário (objeto com place e color_override): individual > local > neutra. Cor de LOCAL usa pcKey(place.color). */
const pcKey = key => `--pc:${(PAL[key] || PAL.w1)[isDark() ? 1 : 0]}`;
const colorOf = x => x ? effectiveColor(x, id => S.places[id]) : null;
const pc = x => { const k = colorOf(x); return k ? pcKey(k) : '--pc:var(--label3)'; }; /* sem cor: marca neutra */
/* R9 (§10, torneio focal: grade por espectro): 1ª casa = ação explícita de limpar — "Usar cor do local" (com local) ou "Sem cor" — e grava '' (G-R7-08);
   depois uma casa por família, na ordem do espectro: âncora em cima, tom secundário embaixo. Tudo visível de uma vez; alvo de 44 px; a seleção é anel + selo fora da amostra. */
function specGrid(sel, act, idAttr, first = '') {
  const sw = (k, sec) => `<button type="button" class="swc${sec ? ' sec' : ''}" data-act="${act}" data-id="${k}" aria-pressed="${sel === k}" aria-label="${PAL_NAMES[k]}" title="${PAL_NAMES[k]}" style="${pcKey(k)}"><i></i></button>`;
  return `<div class="spec${first ? '' : ' nofirst'}" id="${idAttr}" role="group" aria-label="Cor">${first}${SPECTRUM.map(g => `<div class="fam" role="group" aria-label="${g.name}"><span class="fl">${g.name}</span>${sw(g.keys[0])}${g.keys[1] ? sw(g.keys[1], true) : '<span class="swc sec void"></span>'}</div>`).join('')}</div>`;
}
function swatches(f, act, idAttr) {
  const hasPlace = !!(f.place && S.places[f.place]);
  return specGrid(f.color, act, idAttr, `<button type="button" class="fam first${hasPlace ? '' : ' neutral'}" data-act="${act}" data-id="" aria-pressed="${!f.color}"${hasPlace ? ` style="${pcKey(S.places[f.place].color)}"` : ''}><span class="swc"><i></i></span><span class="fl">${hasPlace ? 'Usar cor do local' : 'Sem cor'}</span></button>`);
}
function refreshSwatches(idAttr, f) { const box = document.getElementById(idAttr); if (!box) return; const want = swatches(f, box.querySelector('[data-act]')?.dataset.act || 'fcolor', idAttr); if (box.outerHTML !== want) box.outerHTML = want; }
/* amostra da célula Local = cor DO LOCAL (nunca a cor efetiva do plantão — parecer r2 #1); sem local = neutra */
const placeSq = pid => pid && S.places[pid] ? pcKey(S.places[pid].color) : '--pc:var(--fill3)';
const colorShort = f => f.color ? `${PAL_NAMES[f.color]} · personalizada` : f.place && S.places[f.place] ? `Do local · ${PAL_NAMES[S.places[f.place].color]}` : 'Sem cor';
function colorFoot(f) { const p = f.place && S.places[f.place]; return p ? (f.color ? `Selecionada: ${PAL_NAMES[f.color]} — só neste plantão; os outros de ${esc(p.name)} continuam em ${PAL_NAMES[p.color]}. “Usar cor do local” remove a cor individual.` : `Selecionada: cor do local — ${PAL_NAMES[p.color]} (${esc(p.name)}). Toque numa cor para destacar só este plantão.`) : (f.color ? `Selecionada: ${PAL_NAMES[f.color]} — cor própria deste plantão, sem local. “Sem cor” remove a cor individual.` : 'Selecionada: sem cor — marca neutra no calendário. Toque numa cor para identificar o plantão.'); }
const ruleDate = (pid, k) => pid ? ruleDateFor(P(pid).rule, k) : null;
const ruleTxt = pid => ruleTxtFor(P(pid).rule);
const cohort = (ym, by) => cohortOf(S.shifts, ym, by);
const overdue = () => overdueOf(S.shifts, TODAY);
const mkShift = (f, k, first) => mkShiftCore(f, k, first, f.place ? P(f.place).rule : null);
function selfCheck() { /* só com os dados de exemplo (que trazem os totais esperados) */
  const D = window.PLANTOES_SAMPLE; if (!S.meta.sample_loaded || !D?.expected) return [];
  const bad = [];
  for (const [ym, e] of Object.entries(D.expected.months)) for (const [by, key] of [['worked', 'worked_in_month'], ['cash', 'expected_in_month']]) { const t = cohort(ym, by); for (const f of ['count', 'minutes', 'total', 'received', 'pending']) if (t[f] !== e[key][f]) bad.push(`${ym} ${key}.${f}`); }
  if (sum(overdueOf(S.shifts, D.expected.today)) !== D.expected.overdue_cents) bad.push('atrasados');
  return bad;
}

/* ---------- persistência (contrato: nada diz "salvo" antes do transaction.complete) ---------- */
const snapshot = () => { const d = { places: Object.values(S.places), templates: S.templates, series: S.series, shifts: [...S.shifts, ...S.trash] }; S.meta.schema_version = datasetNeedsV2({ ...d, conflicts: Object.values(S.conflicts || {}) }) ? 2 : 1; /* toda gravação (edição, importação, restauração, merge remoto, exclusão) passa por aqui */
  return { ...d, meta: [{ key: 'meta', value: { ...S.meta, restore_undo: S.clearUndoAt ? null : S.meta.restore_undo } }, ...Object.values(S.conflicts || {}).map(c => ({ key: 'c:' + c.id, value: c }))] }; };
/* B2 (auditoria): nenhuma mensagem de sucesso aparece antes de a revisão estar durável; o instantâneo de desfazer a restauração só some depois da gravação seguinte confirmada */
function persist(keepRestoreUndo = false) {
  if (!keepRestoreUndo && S.meta.restore_undo && !S.clearUndoAt) S.clearUndoAt = (committer?.rev || 0) + 1;
  S.meta.updated_at = nowIso(); const c = committer?.commit(snapshot);
  if (S.toast && !S.toast.kind && c) { S.toastPending = { toast: S.toast, rev: c.rev }; S.toast = null; }
  return c;
}
function onSaveState(st) {
  S.save = st; const el = document.getElementById('save-state'); if (el) el.outerHTML = saveCell();
  if (st.state === 'error') { S.toastPending = null; if (st.error?.name === 'ConflictError') { reloadFromOtherTab('conflict'); return; } if (!(S.toast && S.toast.kind === 'save')) { S.toast = { kind: 'save', msg: 'Não foi possível gravar no aparelho.', btn: { label: 'Tentar de novo', act: 'retry-save' } }; renderToast(); } return; }
  if (st.state === 'saved') {
    if (S.clearUndoAt && st.savedRev >= S.clearUndoAt) { S.meta.restore_undo = null; S.clearUndoAt = null; if (S.view === 'data') render(false); }
    if (S.toast?.kind === 'save') S.toast = null;
    if (S.toastPending && st.savedRev >= S.toastPending.rev) { if (!S.toast) S.toast = S.toastPending.toast; /* R9: a confirmação atrasada nunca apaga um aviso mais novo */ S.toastPending = null; }
    renderToast();
    if (S.reloadWhenSaved) { S.reloadWhenSaved = false; location.reload(); } /* N1: a atualização adiada conclui só com tudo gravado */
    if (S.v8?.token && !v8Active() && v8Engine) v8Engine.pendingCount().then(v8Since).catch(() => { }); /* reauditoria MP-R9-005: em pausa não há ciclo; a fila é medida a cada gravação durável */
    syncKick(); /* R5: toda gravação durável agenda o backup no servidor */
  }
}
function saveCell() {
  const st = S.save || { state: 'saved' }, t = st.state === 'saving' ? ['Gravando…', ''] : st.state === 'error' ? [`Não gravado${st.error ? ` (${esc(String(st.error.name || st.error.message || st.error)).slice(0, 60)})` : ''}`, 'late'] : ['Gravado neste aparelho', 'ok'];
  return `<div class="cell" id="save-state"><span class="k">${S.view === 'settings' ? sic('disk', 'mute') : ''}Gravação</span><span class="v ${t[1]}">${t[0]}${st.state === 'error' ? ` <button class="textb" data-act="retry-save">Tentar de novo</button>` : ''}</span></div>`;
}

/* ---------- ícones ---------- */
const I = {
  cal: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  wallet: '<path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h12a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5z"/><path d="M15 12h5.5v4H15a2 2 0 0 1 0-4z"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', left: '<path d="M15 5l-7 7 7 7"/>', right: '<path d="M9 5l7 7-7 7"/>', chev: '<path d="M9 6l6 6-6 6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  rep: '<path d="M4 11V9a3 3 0 0 1 3-3h12M16 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H5M8 21l-3-3 3-3"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.01"/>', pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  note: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/>', lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  more: '<circle cx="6" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18" cy="12" r="1.6" fill="currentColor"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>', palette: '<circle cx="12" cy="12" r="8.5"/><circle cx="8.5" cy="10" r="1.3" fill="currentColor"/><circle cx="12" cy="7.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="10" r="1.3" fill="currentColor"/><path d="M12 20.5c-1.5-1.5-.5-3.5 1.5-3.5h2a3 3 0 0 0 0-6"/>',
  trash: '<path d="M4.5 7h15M10 4h4M6.5 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5l1-12.5M10 11v6M14 11v6"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
  down: '<path d="M5 9l7 7 7-7"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.01"/>', tpl: '<rect x="7" y="7" width="13" height="13" rx="2.5"/><path d="M4 15.5V6.5A2.5 2.5 0 0 1 6.5 4h9"/>',
  dots: '<circle cx="7" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="17" cy="12" r="2" fill="currentColor"/>',
  cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.6 4.5 4.5 0 0 0 7 18.5z"/><path d="M12 11v5M9.8 13.8L12 16l2.2-2.2"/>', disk: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>', daycal: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="16" cy="15" r="1.3" fill="currentColor"/>',
};
const sic = (n, tone = '', key = null) => `<span class="ico ic-${n} ${tone}"${key ? ` style="${pcKey(key)}"` : ''}>${ic(n, 17, 2)}</span>`; /* R7: ícone em quadrado colorido por item (Ajustes), como no app-modelo; a cor vem da paleta aprovada (nenhum hex novo) */
const ic = (n, s = 22, w = 1.8) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${I[n]}</svg>`;

/* ---------- T01 calendário ---------- */
const dayShifts = k => S.shifts.filter(s => day(s) === k).sort((a, b) => a.start.localeCompare(b.start));
const contShifts = k => S.shifts.filter(s => !s.end_pending && day(s) < k && endDay(s) >= k && !(endDay(s) === k && t1(s) === '00:00')); /* R9: vale para vários dias; o plantão conta uma vez, no dia de início */
function viewCal() {
  const ym = S.month, [y, m] = ym.split('-').map(Number), ws = S.meta.week_start ? 1 : 0, lead = (dow(ym + '-01') - ws + 7) % 7;
  const cells = monthCells(ym);
  const wk = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']; if (ws) wk.push(wk.shift());
  const empty = !S.shifts.length && !places().length;
  return `
  <header class="nav">
    <div class="l"><button class="pillb" data-act="today">Hoje</button><button class="srb" data-act="pmonth" aria-label="Mês anterior">‹</button></div>
    <h1 class="month" aria-live="polite">${monthOf(ym + '-01')} ${y}</h1>
    <div class="r"><button class="srb" data-act="nmonth" aria-label="Próximo mês">›</button><a class="circ" href="#/novo/${S.sel}" aria-label="Novo plantão em ${dm(S.sel)}">${ic('plus', 22, 2)}</a></div>
  </header>
  <div class="cal" data-calswipe>
    <div class="wk" aria-hidden="true">${wk.map(d => `<span>${d}</span>`).join('')}</div>
    <div class="grid${S.calMode === 'siglas' ? ' siglas' : ''}" role="group" aria-label="${monthOf(ym + '-01')} de ${y}">${cells.map(k => dayCell(k, k.startsWith(ym))).join('')}</div>
  </div>
  ${empty ? firstRun() : dayPanel(S.sel)}${backupNotice()}`; /* R7: sem legenda de locais (a cor do ponto é a do plantão, pode ser individual; Siglas continua em Ajustes); a lista do dia vem logo após a grade e o lembrete de backup depois dela */
}
/* F12: lembrete honesto de backup, em linha (nunca sobreposto ao conteúdo): só com dados e sem backup há mais de 7 dias */
/* R9 (§9): o calendário não é painel de notificações. O lembrete é dispensável (✕) e a dispensa vale 30 dias neste aparelho; com sincronização V8 em dia
   ou backup no servidor recente ele nem aparece (o estado fica em Ajustes). Só uma situação não se dispensa: sincronização parada há mais de 3 dias com
   alterações na fila — é risco real de divergência entre aparelhos, não lembrete. */
const NOTICE_KEY = 'mp-notice-x', NOTICE_DAYS = 30, SYNC_STALE_DAYS = 3, SINCE_KEY = 'mp-v8-since'; /* SINCE_KEY: dia em que a fila deixou de estar vazia neste aparelho (auditoria MP-R9-005) */
function backupNotice() {
  if (!S.shifts.length) return '';
  const row = (href, text, action, crit) => `<div class="notice${crit ? ' crit' : ''}"><a class="nlink" href="${href}"><span class="ico">${ic(crit ? 'alert' : 'cloud', 17, 2)}</span><span class="nt">${text}</span><span class="na">${action} ${ic('chev', 14, 2.2)}</span></a>${crit ? '' : `<button class="nx" data-act="notice-x" aria-label="Dispensar este lembrete por ${NOTICE_DAYS} dias">${ic('x', 16, 2.2)}</button>`}</div>`;
  if (v8Active()) {
    const st = S.v8st || {}, since = lsGet(SINCE_KEY, ''), stale = isDateKey(since) ? diffDays(since, TODAY) : null; /* idade da alteração mais antiga na fila, não da última sincronização */
    return S.v8fail && (st.pending || 0) > 0 && stale != null && stale > SYNC_STALE_DAYS ? row('#/sincronizacao', `Sincronização parada: ${pl(st.pending, 'alteração', 'alterações')} por enviar há ${stale} dias.`, 'Ver', true) : '';
  }
  const dis = lsGet(NOTICE_KEY, ''); if (isDateKey(dis) && diffDays(dis, TODAY) >= 0 && diffDays(dis, TODAY) < NOTICE_DAYS) return '';
  const lb = S.meta.last_backup_at, days = lb ? diffDays(lb.slice(0, 10), TODAY) : null;
  const sc = syncLoad(), sd = sc?.last_ok_at ? diffDays(sc.last_ok_at.slice(0, 10), TODAY) : null; /* R5: com o servidor em dia, o lembrete de arquivo some */
  if (sd != null && sd <= 2) return '';
  if (sd != null) return row('#/dados', `Backup no servidor sem envio há ${sd} dias.`, 'Ver');
  if (lb && days <= 7) return '';
  return row('#/dados', lb ? `Sem backup há ${days} dias.` : 'Você ainda não fez backup dos seus plantões.', 'Fazer backup');
}
function firstRun() {
  return `<div class="gl"><section class="first" aria-labelledby="fr-t"><h2 id="fr-t">Seus plantões em todos os aparelhos</h2>
    <p>Registre o primeiro plantão pelo "+" — o local é opcional. Cadastrar locais (hospital, UPA, clínica) com a regra de recebimento deixa a previsão automática. Também dá para importar uma planilha ou ver o app com dados de exemplo. Já usava o app em outro endereço ou aparelho? Ative a sincronização em Ajustes e tudo aparece aqui.</p>
    <div class="acts"><a class="btn p" href="#/novo/${S.sel}" style="display:flex;align-items:center;justify-content:center">Novo plantão</a><a class="btn" href="#/local/novo" style="display:flex;align-items:center;justify-content:center">Cadastrar um local</a><a class="btn" href="#/dados" style="display:flex;align-items:center;justify-content:center">Importar planilha ou backup</a><button class="btn" data-act="sample">Carregar dados de exemplo</button></div></section></div>`;
}
function dayCell(k, inMonth, sel = S.sel) {
  const d = +k.slice(8, 10), list = inMonth ? dayShifts(k) : [];
  const dots = S.calMode === 'siglas'
    ? `</span><span class="sgs">${list.slice(0, 2).map(s => `<i style="${pc(s)}">${esc(P(s.place).short)}${night(s) ? ' ☾' : ''}</i>`).join('')}${list.length > 2 ? `<em>+${list.length - 2}</em>` : ''}<span hidden>`
    : list.slice(0, 3).map(s => `<i${pendingOf(s).length ? ' class="todo"' : ''} style="${pc(s)}"></i>`).join('') + (list.length > 3 ? '<em>+</em>' : ''); /* R7: ponto na cor efetiva de cada plantão; R9: vazado = a completar */
  const lab = `${dayLong(k)}${k === TODAY ? ', hoje' : ''}${inMonth ? `. ${list.length ? pl(list.length, 'plantão', 'plantões') + ': ' + list.map(s => `${P(s.place).short} ${s.title} às ${t0(s)}`).join('; ') : 'sem plantões'}` : ''}`;
  return `<button class="day${inMonth ? '' : ' other'}${k === TODAY ? ' today' : ''}${k === sel ? ' sel' : ''}" data-act="day" data-id="${k}" aria-pressed="${k === sel}"${k === TODAY ? ' aria-current="date"' : ''} aria-label="${esc(lab)}">
    <span class="n num">${d}</span><span class="dots">${dots}</span></button>`;
}
function status(s) {
  const out = isExpense(s);
  if (s.amount_zero) return { k: 'pend', h: 'Sem valor' }; /* antes de paid_at: sem valor não há recebimento (o interruptor para desfazer fica em Detalhes) */
  if (s.paid_at) return { k: 'ok', h: `${out ? 'Pago' : 'Recebido'} ${dm(s.paid_at)}` };
  if (!amountKnown(s)) return { k: 'pend todo', h: 'Valor a preencher' };
  if (s.expected_pending) return { k: 'pend todo', h: 'Sem previsão' };
  if (s.expected_on < TODAY) return { k: 'late', h: out ? 'Vencido' : 'Atrasado' };
  return { k: 'pend', h: out ? (s.expected_on === TODAY ? 'Pagar hoje' : `Pagar até ${dm(s.expected_on)}`) : s.expected_on === TODAY ? 'Cai hoje' : `Previsto ${dm(s.expected_on)}` };
}
/* R9: textos que dependem de valor conhecido/desconhecido e de receita/despesa */
const money = s => !amountKnown(s) ? 'a preencher' : isExpense(s) ? `− ${brl(-s.amount_cents)}` : brl(s.amount_cents);
const PEND_TXT = { start: 'horário', end: 'término', value: 'valor', expected: 'previsão' };
const pendTxt = s => pendingOf(s).map(k => PEND_TXT[k]).join(', ');
/* horário para leitura: "07:00 – 19:00", "19:00 → 07:00 qua", "07:00 → dom 19:00", "07:00 · término a definir" */
function whenTxt(s) {
  const a = `${t0(s)}${s.start_pending ? ' (padrão)' : ''}`; if (s.end_pending) return `${a} · término a definir`;
  const span = diffDays(day(s), endDay(s)), long = s.minutes > 1440 ? ` · ${hrs(s.minutes)}` : ''; return span === 0 ? `${a} – ${t1(s)}` : span === 1 ? `${a} → ${t1(s)} ${WD[dow(endDay(s))]}${long}` : `${a} → ${WD[dow(endDay(s))]} ${dm(endDay(s))} ${t1(s)}${long}`;
}
/* R9 (§8, torneio focal: linha em duas camadas): 1ª linha = nome + valor (quando informado); 2ª linha = horário · local (só quando acrescenta) + estado resumido.
   Sigla, duração, regra e competência ficam nos detalhes. Toque abre; deslize e "⋯" como sempre (o plano de ações e a superfície [data-swipe] não mudam). */
const words = t => normTitleQ(t).split(/[^a-z0-9]+/).filter(Boolean);
const placeAdds = (s, p) => !!s.place && !normTitleQ(s.title).includes(normTitleQ(p.name)) && !words(s.title).includes(normTitleQ(p.short));
function rowState(s) { const pend = pendingOf(s); return s.paid_at || !pend.length || (pend.length === 1 && pend[0] === 'value') ? status(s) : { k: 'todo', h: 'A completar' }; }
function shiftRow(s, when) {
  const st = rowState(s), p = P(s.place), pend = pendingOf(s), out = isExpense(s);
  const sub = when ?? (s.start_pending ? `Falta ${pendTxt(s)}` : `<span class="num">${whenTxt(s)}</span>${placeAdds(s, p) ? ` · ${esc(p.name)}` : ''}`);
  const label = `${s.title}${s.place ? ', ' + p.name : ''}, ${whenTxt(s)}, ${amountKnown(s) ? (out ? 'a pagar ' : '') + brl(Math.abs(s.amount_cents)) : 'valor a preencher'}, ${st.h}`;
  /* I1: plano inferior com as ações (ocultas até o gesto descobrir) + superfície [data-swipe] que desliza por cima. R9: sem valor conhecido a ação é completar */
  return `<li data-shift="${s.id}" data-open="">${s.paid_at
    ? `<button class="act unpay" data-act="unpay" data-id="${s.id}">${ic('undo', 22, 2)}<span>Desfazer</span></button>`
    : canSettle(s) ? `<button class="act pay" data-act="pay" data-id="${s.id}">${ic('check', 22, 2.4)}<span>${out ? 'Paguei' : 'Recebi'}</span></button>`
      : `<button class="act pay todo" data-act="edit" data-id="${s.id}">${ic('edit', 22, 2)}<span>${pend.length ? 'Completar' : 'Editar'}</span></button>`}<button class="act rm" data-act="delete" data-id="${s.id}">${ic('trash', 22, 2)}<span>Apagar</span></button>
    <div class="sws" data-swipe><button class="row r2${pend.length ? ' todo' : ''}" data-act="open" data-id="${s.id}" style="${pc(s)}" aria-label="${esc(label)}">
    <span class="bar"></span>
    <span class="l1"><span class="ttl">${esc(s.title)}</span>${amountKnown(s) ? `<span class="amt">${money(s)}</span>` : ''}</span>
    <span class="l2"><span class="sub">${sub}</span><span class="st ${st.k}">${st.h}</span></span>
    </button><button class="mbtn" data-act="more" data-id="${s.id}" aria-haspopup="dialog" aria-label="${esc(`Mais ações de ${s.title}${s.place ? ', ' + p.name : ''}, ${dm(day(s))}`)}">${ic('more', 22)}</button></div></li>`;
}
function dayPanel(k) {
  const list = dayShifts(k), conts = contShifts(k), mins = list.reduce((a, s) => a + workedMin(s), 0), net = sum(list);
  /* R9: horas só do que tem término; soma com sinal só quando algum valor é conhecido */
  const sub = list.length ? `${pl(list.length, 'plantão', 'plantões')}${mins ? ` · ${hrs(mins)}` : ''}${list.some(amountKnown) ? ` · ${net < 0 ? '− ' + brl(-net) : brl(net)}` : ''}` : '';
  return `<section aria-labelledby="dh">
    <div class="dayhead"><h2 id="dh" tabindex="-1">${dayLong(k)}</h2><span class="sub num">${sub}</span></div>
    ${conts.map(s => `<button class="cont" data-act="open" data-id="${s.id}" style="${pc(s)}"><span class="bar"></span><span class="ct">${endDay(s) === k && s.minutes <= 1440 && t1(s) <= '12:00' ? 'Madrugada de ' : ''}${esc(s.title)}</span> <span class="cs num">${endDay(s) === k ? (s.minutes <= 1440 && t1(s) <= '12:00' ? `até ${t1(s)}` : `termina às ${t1(s)}`) : `continua até ${wdm(endDay(s))} ${t1(s)}`} · de ${wdm(day(s))}</span></button>`).join('')}
    ${list.length ? `<ul class="rows">${list.map(s => shiftRow(s)).join('')}</ul>` : `<div class="emptyday"><p class="empty">Nenhum plantão ${conts.length ? 'começa ' : ''}em ${WDL[dow(k)]}, ${+k.slice(8, 10)} de ${monthOf(k)}.</p><a class="addbtn" href="#/novo/${k}">${ic('plus', 16, 2.2)} Adicionar plantão</a></div>`}
  </section>`; /* R7: dia vazio com ação, como no app-modelo (V6) */
}

/* ---------- T02 detalhes ---------- */
function viewDetail(id) {
  const s = byId(id); if (!s) return `<header class="nav"><div class="l"><a class="circ" href="#/calendario" aria-label="Voltar">${ic('left')}</a></div><h1>Plantão</h1><div class="r"></div></header><p class="empty">Plantão não encontrado.</p>`;
  const p = P(s.place), se = s.series && seriesById(s.series), byRule = !!s.place && s.expected_on === ruleDate(s.place, day(s));
  const out = isExpense(s), left = diffDays(TODAY, s.expected_on); /* R9: despesa tem vocabulário próprio; pendência nunca vira atraso */
  const sit = s.paid_at ? `<span class="v sdot ok">${out ? 'Pago' : 'Recebido'} em ${dmy(s.paid_at)}</span>` : !amountKnown(s) ? '<span class="v sdot pend">Valor a preencher</span>' : s.amount_zero ? '<span class="v sdot pend">Sem valor</span>' : s.expected_pending ? '<span class="v sdot pend">Sem previsão</span>'
    : left < 0 ? `<span class="v sdot late">${out ? 'Vencido' : 'Atrasado'} há ${pl(-left, 'dia', 'dias')}</span>`
    : `<span class="v sdot pend">${left === 0 ? (out ? 'Pagar hoje' : 'Cai hoje') : `${out ? 'A pagar' : 'Previsto'} · faltam ${pl(left, 'dia', 'dias')}`}</span>`;
  const colorTxt = isColorKey(s.color_override) ? `Personalizada · ${PAL_NAMES[s.color_override]}` : s.place ? `Do local · ${PAL_NAMES[p.color] || ''}` : 'Neutra';
  /* R7: detalhes em cards (hero · Pagamento · Local/Cor · Observações · Apagar), como o app-modelo de 27/10 (V8); nada de cartão dentro de cartão */
  return `
  <header class="nav">
    <div class="l"><a class="circ" href="#/calendario/${day(s)}" aria-label="Voltar ao calendário">${ic('left')}</a></div>
    <h1>Detalhes do plantão</h1>
    <div class="r"><a class="pillb" href="#/editar/${s.id}">Editar</a></div>
  </header>
  <article class="detail gl" style="${pc(s)}">
    <section class="group herocard">
      <div class="hd"><span class="bar"></span><div class="hdt"><h1>${esc(s.title)}</h1>
        <p class="d">${dayFull(day(s))}</p>
        <p class="ml num">${t0(s)}${s.start_pending ? ' (padrão, a confirmar)' : ''} ${s.end_pending ? '· término a definir' : `${night(s) ? '→' : '–'} ${t1(s)} · ${hrs(s.minutes)}${night(s) ? ` · <span class="mo">${ic('moon', 13, 2)} termina ${WD[dow(endDay(s))]}, ${dmy(endDay(s))}</span>` : ''}`}</p>
        ${pendingOf(s).length ? `<a class="rep todo" href="#/editar/${s.id}">${ic('edit', 15, 2)} A completar: ${pendTxt(s)}</a>` : ''}
        ${Object.values(S.conflicts).some(c => c.rec === s.id) ? `<a class="rep late" href="#/sincronizacao">Há um conflito de sincronização neste plantão</a>` : ''}
        ${se ? `<a class="rep" href="#/serie/${se.id}">${ic('rep', 15, 2)} Plantão recorrente: ${esc(se.label)} · até ${dm(se.until)}</a>` : ''}</div></div>
    </section>
    <div class="ghead">Pagamento</div>
    <div class="group">
      <div class="cell kv"><span class="k">${out ? 'Valor a pagar' : 'Valor'}</span><span class="v strong num">${!amountKnown(s) ? '<span class="todo">a preencher</span>' : s.amount_zero ? 'sem valor' : money(s)}</span></div>
      ${s.amount_zero ? '<div class="cell kv"><span class="k">Previsão</span><span class="v">não se aplica</span></div>' : s.expected_pending ? `<a class="cell kv" href="#/editar/${s.id}"><span class="k">${out ? 'Pagar até' : 'Previsto para'}</span><span class="v"><span class="todo">sem previsão</span> ${ic('chev', 16, 2)}</span></a>` : `<div class="cell kv"><span class="k"><span class="kt">${out ? 'Pagar até' : 'Previsto para'}<small>${byRule ? `regra de ${esc(p.short)} · cai em ${monthOf(s.expected_on)}` : s.place ? `ajustada só neste plantão · cai em ${monthOf(s.expected_on)}` : `informada por você · cai em ${monthOf(s.expected_on)}`}</small></span></span><span class="v num">${WD[dow(s.expected_on)]}, ${dmy(s.expected_on)}</span></div>`}
      <div class="cell kv"><span class="k">Situação</span>${sit}</div>
      ${s.amount_zero && !s.paid_at ? '' : `<div class="cell kv"><span class="k">${out ? 'Marcar como pago' : 'Marcar como recebido'}</span><button class="sw" role="switch" aria-checked="${!!s.paid_at}" data-act="${s.paid_at ? 'unpay' : 'pay'}" data-id="${s.id}" aria-label="${out ? 'Marcar como pago' : 'Marcar como recebido'}"></button></div>`}
      ${s.paid_at ? `<div class="cell kv"><span class="k">${out ? 'Pago em' : 'Recebido em'}</span><input class="datein num" type="date" value="${s.paid_at}" data-paid="${s.id}" aria-label="Data em que recebeu"></div>` : ''}
    </div>
    <div class="ghead">Local</div>
    <div class="group">
      ${s.place ? `<a class="cell" href="#/local/${p.id}"><span class="k"><span class="sq" style="${pcKey(p.color)}"></span><span class="kt">${esc(p.name)}<small>${esc(p.short)} · ${ruleTxt(s.place)}</small></span></span><span class="v">${ic('chev', 16, 2)}</span></a>`
        : `<a class="cell" href="#/editar/${s.id}"><span class="k"><span class="sq neutral"></span><span class="nolocal">Sem local</span></span><span class="v">Vincular local ${ic('chev', 16, 2)}</span></a>`}
      <a class="cell" href="#/editar/${s.id}"><span class="k"><span class="sq" style="${pc(s)}"></span>Cor</span><span class="v">${colorTxt} ${ic('chev', 16, 2)}</span></a>
      <a class="cell obsrow" href="#/editar/${s.id}"><span class="k">${ic('note', 18, 2)} Observações</span><span class="v wrap">${s.note ? esc(s.note) : '<span style="color:var(--label3)">Nenhuma</span>'} ${ic('chev', 16, 2)}</span></a>
      ${s.ext_uid ? `<div class="cell kv"><span class="k">${ic('daycal', 18, 2)} Importado de agenda</span><span class="v wrap" style="font-size:13px">${esc(s.ext_uid).slice(0, 40)}</span></div>` : ''}
    </div>
    <div class="group dangercard"><button class="cell del" data-act="delete" data-id="${s.id}">${ic('trash', 18, 2)} Apagar plantão</button></div>
  </article>`;
}

/* ---------- T03 formulário de plantão ---------- */
const amtTxt = x => x.amount_zero ? '0,00' : x.amount_cents ? centsTxt(Math.abs(x.amount_cents)) : ''; /* vazio = desconhecido; o sinal vai em kind */
const tplTimes = t => ({ start: t.start_pending ? '' : t.start, end: t.end_pending ? '' : t.end, end_days: t.end_days ?? null, endDate: '', endAuto: t.end_days == null });
const newForm = (date, tplId) => { const t = tplId && tplById(tplId); return { editId: null, date, title: t ? t.title : '', place: t ? t.place : (places().length === 1 ? places()[0].id : ''), ...(t ? tplTimes(t) : { start: '', end: '', end_days: null, endDate: '', endAuto: true }), amount: t ? amtTxt(t) : '', kind: t && t.amount_cents < 0 ? 'out' : 'in', expected: '', expOverride: false, paid: false, paidAt: TODAY, repeat: 'none', until: '', note: '', tpl: tplId || '', color: t ? (t.color_override || '') : '' }; };
/* R9 (adendo): cada pendência abre como CAMPO VAZIO — nunca o marcador; salvar sem tocar recria a mesma marca; a marca só some quando o campo recebe valor */
const formFrom = s => ({ orig: JSON.stringify(s), editId: s.id, date: day(s), title: s.title, place: s.place, start: s.start_pending ? '' : t0(s), end: s.end_pending ? '' : t1(s), end_days: null, endDate: s.end_pending ? '' : endDay(s), endAuto: s.end_pending || diffDays(day(s), endDay(s)) === legacySpan(t0(s), t1(s)), amount: amtTxt(s), kind: isExpense(s) ? 'out' : 'in', expected: s.expected_pending ? '' : s.expected_on, expOverride: !s.place || s.expected_pending || s.expected_on !== ruleDate(s.place, day(s)), paid: !!s.paid_at, paidAt: s.paid_at || TODAY, repeat: 'none', until: '', note: s.note || '', tpl: '', color: s.color_override || '' }); /* R7: color = '' herda (local ou neutra) */
const validate = f => { const e = validateForm(f); if (f.place && !S.places[f.place]) e.place = 'local'; return e; };
function viewForm() {
  const f = S.form, ed = !!f.editId, e = validate(f), ok = !Object.keys(e).length, out = f.kind === 'out';
  const exp = f.place && S.places[f.place] ? (f.expOverride ? f.expected : (isDateKey(f.date) ? ruleDate(f.place, f.date) : '')) : (f.expected || '');
  const [stCls, stHtml] = fragStatus(f); const tp = templates(); const opts = places().concat(f.place && S.places[f.place]?.archived ? [S.places[f.place]] : []);
  return `
  <header class="nav">
    <div class="l"><a class="textb" href="${ed ? '#/plantao/' + f.editId : '#/calendario/' + f.date}">Cancelar</a></div>
    <h1>${ed ? 'Editar plantão' : 'Novo plantão'}</h1>
    <div class="r"><button class="textb b" data-act="save"${ok ? '' : ' aria-disabled="true"'}>Salvar</button></div>
  </header>
  <form id="f" class="gl" novalidate>
    ${ed || !tp.length ? '' : `<div class="ghead">Começar por um modelo <small>opcional</small></div><div class="chips">${tp.map(t => `<button type="button" class="chip" data-act="tpl" data-id="${t.id}" aria-pressed="${f.tpl === t.id}" style="${pc(t)}"><i></i>${esc(t.title)}</button>`).join('')}</div>`}
    <div class="ghead">Plantão</div>
    <div class="group">
      <label class="cell plain"><input name="title" value="${esc(f.title)}" placeholder="Título do plantão" autocomplete="off" aria-label="Título"></label>
      <label class="cell"><span class="k">Local</span><span class="v"><span class="sq${f.place && S.places[f.place] ? '' : ' neutral'}" id="f-dot" style="${placeSq(f.place)}"></span><select name="place"><option value="">Sem local</option>${opts.map(p => `<option value="${p.id}"${f.place === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}<option value="__new">Novo local…</option></select>${ic('chev', 16, 2)}</span></label>
      <button type="button" class="cell" data-act="gocolor"><span class="k"><span class="sq" id="f-colorsq" style="${pc({ place: f.place && S.places[f.place] ? f.place : null, color_override: f.color })}"></span>Cor</span><span class="v" id="f-colorv">${colorShort(f)} ${ic('chev', 16, 2)}</span></button>
    </div>
    <p class="gfoot">${ed ? '' : 'Só o título e a data são obrigatórios: o resto pode ficar para depois. '}${f.place && S.places[f.place] ? 'A regra de recebimento vem do local; a cor também, salvo escolha em “Cor”.' : 'Local opcional. “Novo local…” abre o cadastro e volta para este formulário.'}</p>
    <div class="ghead">Quando</div>
    <div class="group">
      <label class="cell"><span class="k">Data</span><input class="num" type="date" name="date" value="${f.date}"></label>
      <label class="cell"><span class="k">Começa</span><input class="num" type="time" name="start" value="${f.start}"></label>
      <label class="cell"><span class="k">Termina</span><input class="num" type="time" name="end" value="${f.end}"></label>
      <label class="cell" id="f-enddate"><span class="k">Dia do término</span><input class="num" type="date" name="endDate" value="${f.endDate}"${f.end ? '' : ' disabled'}></label>
      <div class="cell"><span class="k">Duração</span><div class="chips dur" id="f-dur" role="group" aria-label="Atalhos de duração">${durChips(f)}</div></div>
    </div>
    <div id="f-night" style="display:contents">${fragNight(f)}</div>
    <div class="ghead">Pagamento</div>
    <div class="group">
      <div class="cell"><span class="k">Tipo</span><div class="seg" role="group" aria-label="Receita ou despesa"><button type="button" data-act="fkind" data-id="in" aria-pressed="${!out}">A receber</button><button type="button" data-act="fkind" data-id="out" aria-pressed="${out}">A pagar</button></div></div>
      <label class="cell"><span class="k">Valor</span><span class="v" style="gap:4px"><span>${out ? '− R$' : 'R$'}</span><input name="amount" inputmode="decimal" placeholder="a preencher" value="${esc(f.amount)}" style="width:110px"></span></label>
      <label class="cell"><span class="k">${out ? 'Pagar até' : 'Previsto para'}</span><input class="num" type="date" name="expected" value="${exp}"${isDateKey(f.date) ? '' : ' disabled'}></label>
    </div>
    <p class="gfoot" id="f-exp">${fragExp(f)}</p>
    <div class="group">
      <div class="cell"><span class="k">${out ? 'Já pago' : 'Já recebido'}</span><button type="button" class="sw" role="switch" aria-checked="${f.paid}" data-act="fpaid" aria-label="${out ? 'Já pago' : 'Já recebido'}" style="margin-left:auto"></button></div>
      ${f.paid ? `<label class="cell"><span class="k">${out ? 'Pago em' : 'Recebido em'}</span><input class="num" type="date" name="paidAt" value="${f.paidAt}"></label>` : ''}
    </div>
    <div class="ghead">Cor</div>
    <div class="group"><div class="cell col swcell"><span class="k">Cor do plantão</span><div class="prev" id="f-prev" aria-hidden="true" style="${pc({ place: f.place && S.places[f.place] ? f.place : null, color_override: f.color })}"><span class="pd"><b class="num">${isDateKey(f.date) ? +f.date.slice(8, 10) : ''}</b><i></i></span><span class="bar"></span><span class="pt" id="f-prevt">${esc(f.title.trim() || 'Plantão')}</span></div>${swatches(f, 'fcolor', 'f-colors')}</div></div>
    <p class="gfoot" id="f-colorfoot">${colorFoot(f)}</p>
    ${ed ? '' : `<div class="ghead">Repetição</div><div class="group">
      <label class="cell"><span class="k">Repetir</span><select name="repeat">${Object.entries(REP).map(([v, t]) => `<option value="${v}"${f.repeat === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      <div id="f-until" style="display:contents">${fragUntil(f)}</div>
    </div>
    <div id="f-rep" style="display:contents">${fragRep(f)}</div>`}
    <div class="group"><label class="cell col"><span class="k">Observações</span><textarea name="note" rows="2" placeholder="Opcional — sem dados de pacientes">${esc(f.note)}</textarea></label></div>
    <p id="f-status" class="status-line ${stCls}" aria-live="polite">${stHtml}</p>
  </form>`;
}
/* F01: trechos do formulário que mudam com a edição, atualizados no lugar — nenhum re-render destrói o campo ativo nem o botão tocado */
const DURS = [360, 720, 1440];
const durOf = f => isTimeHM(f.start) && isTimeHM(f.end) ? toMin(f.end) - toMin(f.start) + 1440 * spanOf(f) : null;
const durChips = f => DURS.map(m => `<button type="button" class="chip s" data-act="fdur" data-id="${m}" aria-pressed="${durOf(f) === m}">${m / 60} h</button>`).join('');
function fragNight(f) { /* R9: horário é opcional; o término tem dia próprio; a duração aparece assim que início e fim existem */
  if ((f.start && !isTimeHM(f.start)) || (f.end && !isTimeHM(f.end))) return '';
  const st = f.start || DEFAULT_START, dflt = f.start ? '' : ` Sem hora de início, fica ${DEFAULT_START} como padrão, a confirmar.`;
  if (!f.end) return `<p class="gfoot">Sem término, o plantão fica a completar e as horas só contam quando ele for informado.${dflt}</p>`;
  const span = spanOf(f), mins = toMin(f.end) - toMin(st) + 1440 * span; if (mins <= 0) return '';
  const endK = isDateKey(f.date) ? addDays(f.date, span) : null;
  return span ? `<p class="gfoot night">${ic('moon', 12, 2)} Termina ${span === 1 ? 'no dia seguinte' : `${span} dias depois`}${endK ? ` (${wdm(endK)})` : ''} às ${f.end} · ${hrs(mins)} · conta como trabalho de ${isDateKey(f.date) ? dm(f.date) : 'hoje'}.${dflt}</p>`
    : `<p class="gfoot">${hrs(mins)} · termina no mesmo dia.${dflt}</p>`;
}
function fragExp(f) { const p = f.place && S.places[f.place]; return p ? (f.expOverride ? `Pela regra de ${esc(p.name)} seria ${isDateKey(f.date) ? dmy(ruleDate(f.place, f.date)) : '—'}. Alterar aqui vale só para este plantão.` : `Regra de ${esc(p.name)}: ${ruleTxt(f.place)}. Alterar aqui vale só para este plantão.`) : `Sem local: informe quando espera ${f.kind === 'out' ? 'pagar' : 'receber'}, ou deixe em branco e complete depois. Nenhuma data é inventada.` + (f.repeat && f.repeat !== 'none' ? ' As repetições ficam à mesma distância do plantão.' : ''); }
function fragUntil(f) { return f.repeat !== 'none' ? `<label class="cell"><span class="k">Até</span><input class="num" type="date" name="until" value="${f.until}"></label>` : ''; }
function fragRep(f) { if (!(f.repeat !== 'none' && isDateKey(f.until) && isDateKey(f.date) && f.until >= f.date)) return ''; const ds = repDates(f); return `<p class="gfoot">${pl(ds.length, 'plantão', 'plantões')}: ${ds.slice(0, 4).map(dm).join(', ')}${ds.length > 4 ? ` … ${dm(ds[ds.length - 1])}` : ''}.</p>`; }
function fragStatus(f) { const e = validate(f), ok = !Object.keys(e).length; if (!ok) return ['warn', `${ic('alert', 14, 2.2)} Falta: ${Object.values(e).join(', ')}`]; const p = pendTxt(mkShift(f, f.date, true)); /* R9: o que fica para depois é dito antes de salvar */ return ['ok', `${ic('check', 14, 2.4)} Pronto para salvar${p ? ` · a completar depois: ${p}` : ''}`]; }
function refreshForm() {
  const f = S.form, form = document.getElementById('f'); if (!f || !form) return;
  const set = (id, html) => { const el = document.getElementById(id); if (el && el.innerHTML !== html) el.innerHTML = html; };
  set('f-night', fragNight(f)); set('f-exp', fragExp(f)); set('f-rep', fragRep(f)); set('f-dur', durChips(f));
  { const i = document.querySelector('#f-enddate input'); if (i) { i.disabled = !f.end; if (document.activeElement !== i && i.value !== f.endDate) i.value = f.endDate; } } /* R9: o dia do término acompanha o horário. A linha existe sempre (só habilita): inserir uma linha ao sair do campo de hora empurrava os controles de baixo entre o apertar e o soltar e o toque seguinte se perdia (WebKit, e2e_r9) */
  if (!!form.querySelector('[name="until"]') !== (f.repeat !== 'none')) set('f-until', fragUntil(f));
  const dot = document.getElementById('f-dot'); if (dot) { dot.style.cssText = placeSq(f.place); dot.classList.toggle('neutral', !(f.place && S.places[f.place])); }
  const csq = document.getElementById('f-colorsq'), pcs = pc({ place: f.place && S.places[f.place] ? f.place : null, color_override: f.color }); if (csq) csq.style.cssText = pcs;
  { const pv = document.getElementById('f-prev'), pt = document.getElementById('f-prevt'); if (pv) pv.style.cssText = pcs; if (pt) pt.textContent = f.title.trim() || 'Plantão'; } /* R9: prévia imediata (ponto do calendário + faixa da linha) */
  set('f-colorv', `${colorShort(f)} ${ic('chev', 16, 2)}`);
  refreshSwatches('f-colors', f); set('f-colorfoot', colorFoot(f)); /* R7: trocar o local não mexe na cor escolhida (f.color); só a amostra "Usar cor do local"/"Sem cor" muda */
  const ex = form.querySelector('[name="expected"]'); if (ex && document.activeElement !== ex) { ex.disabled = !isDateKey(f.date); const v = f.place && S.places[f.place] ? (f.expOverride ? f.expected : (isDateKey(f.date) ? ruleDate(f.place, f.date) : '')) : (f.expected || ''); if (ex.value !== v) ex.value = v; }
  const [cls, html] = fragStatus(f), st = document.getElementById('f-status'); if (st) { st.className = 'status-line ' + cls; st.innerHTML = html; }
  const sv = document.querySelector('[data-act="save"]'); if (sv) { if (cls === 'ok') sv.removeAttribute('aria-disabled'); else sv.setAttribute('aria-disabled', 'true'); }
  for (const el of form.querySelectorAll('[aria-invalid]')) if ((el.value || '').trim()) el.removeAttribute('aria-invalid');
}
const firstMissing = (f, errs) => ({ title: 'title', place: 'place', date: 'date', time: f.start && !isTimeHM(f.start) ? 'start' : 'end', amount: 'amount', expected: 'expected', paidAt: 'paidAt', paid: 'amount', until: 'until' })[Object.keys(errs)[0]];
/* data de término: enquanto automática segue a regra de sempre (fim ≤ início ⇒ dia seguinte); mexida à mão, acompanha a data do plantão mantendo a distância */
function syncEnd(f, prevDate) {
  if (!f.end) { f.endDate = ''; f.endAuto = true; return; }
  if (f.endAuto || !isDateKey(f.endDate)) { f.endDate = isDateKey(f.date) ? addDays(f.date, f.end_days ?? legacySpan(f.start || DEFAULT_START, f.end)) : ''; return; }
  if (prevDate && prevDate !== f.date && isDateKey(prevDate) && isDateKey(f.date)) f.endDate = addDays(f.date, diffDays(prevDate, f.endDate));
}
function readForm() {
  const el = document.getElementById('f'); if (!el) return S.form;
  const fd = new FormData(el), f = S.form, prevDate = f.date, prevEnd = f.endDate, prevTimes = f.start + '|' + f.end;
  for (const k of ['title', 'place', 'date', 'start', 'end', 'endDate', 'amount', 'expected', 'paidAt', 'repeat', 'until', 'note']) if (fd.has(k)) f[k] = fd.get(k);
  if (fd.has('endDate') && f.endDate !== prevEnd) { f.endAuto = false; f.end_days = null; } /* o usuário escolheu a data de término */
  if (f.start + '|' + f.end !== prevTimes) f.end_days = null; /* horário mudou: a distância em dias do modelo deixa de valer */
  syncEnd(f, prevDate);
  if (fd.has('expected')) f.expOverride = f.place && isDateKey(f.date) && S.places[f.place] ? f.expected !== ruleDate(f.place, f.date) && !!f.expected : true;
  return f;
}
function submitForm() {
  const f = readForm(), errs = validate(f);
  if (Object.keys(errs).length) {
    refreshForm(); S.toast = { msg: `Ainda falta: ${Object.values(errs).join(', ')}.` }; renderToast();
    const el = document.querySelector(`#f [name="${firstMissing(f, errs)}"]`); if (el) { el.setAttribute('aria-invalid', 'true'); el.scrollIntoView({ block: 'center' }); el.focus({ preventScroll: true }); }
    return;
  }
  if (f.editId) {
    const s = shiftsAll().find(x => x.id === f.editId); if (!s) { S.form = null; S.toast = { msg: 'Este plantão foi excluído em outro aparelho.' }; go('#/calendario'); return; }
    const before = JSON.stringify(s), se = s.series && seriesById(s.series), ovBefore = se ? JSON.stringify(se.overrides) : null;
    { const open = JSON.parse(f.orig); v8AddConflicts(applyChanged(s, open, editShift(open, mkShift(f, f.date, true))), 'shifts', s.id); s.updated_at = nowIso(); } /* V8: só os campos que o usuário mudou; R9: marcas que deixaram de valer saem junto */
    if (se) { const o = { ...(se.overrides[day(s)] || {}), ...tplBits(s, false) }; for (const k of ['start_pending', 'end_pending', 'end_days']) if (!(k in tplBits(s, false))) delete o[k]; if (s.color_override) o.color_override = s.color_override; else delete o.color_override; se.overrides = { ...se.overrides, [day(s)]: o }; } /* H1 (r2): toda edição individual vira exceção visível na série; R7: a exceção é MESCLADA e leva a cor (prebuild r1 #3) */
    S.toast = { msg: `${esc(s.title)} atualizado.`, undo: () => { Object.assign(s, JSON.parse(before)); if (se) se.overrides = JSON.parse(ovBefore); } }; S.form = null; persist(); go('#/plantao/' + s.id); return;
  }
  let se = null;
  if (f.repeat !== 'none') {
    const { freq, interval } = seriesFreq(f.repeat);
    const m0 = mkShift(f, f.date, true); /* R9: o modelo embutido nasce do 1º plantão montado (horário, valor, marcas, distância em dias) */
    se = { id: uid(), tpl: { title: m0.title, place: m0.place, ...tplBits(m0, true), color_override: m0.color_override, ...(f.place || m0.expected_pending ? {} : { exp_days: diffDays(f.date, f.expected) }) }, freq, interval, starts_on: f.date, until: f.until, label: seriesLabel(f.repeat, f.date), exdates: [], overrides: {}, created_at: nowIso() }; /* R7: a série guarda a cor como semente das ocorrências */
    S.series.push(se);
  }
  const made = repDates(f).map((k, i) => ({ id: uid(), template: f.tpl || null, series: se ? se.id : null, ...mkShift(f, k, i === 0), updated_at: nowIso() }));
  S.shifts.push(...made); const ids = new Set(made.map(s => s.id));
  const todo = made.length === 1 && pendingOf(made[0]).length; if (todo) S.completeId = made[0].id; /* R9: rascunho salvo oferece completar agora, além de desfazer */
  S.toast = { ...(todo ? { btn: { label: 'Completar', act: 'complete' } } : {}), msg: made.length > 1 ? `${pl(made.length, 'plantão criado', 'plantões criados')} (${esc(se.label)}).` : `${esc(made[0].title)} salvo em ${dm(f.date)}${todo ? ', a completar' : ''}.`, undo: () => { S.shifts = S.shifts.filter(s => !ids.has(s.id)); if (se) S.series = S.series.filter(x => x !== se); } };
  S.month = f.date.slice(0, 7); S.sel = f.date; S.form = null; S.flash = made[0].id; persist(); go('#/calendario/' + f.date); /* volta ao dia com a linha nova em destaque */
}

/* ---------- T04 recorrência ---------- */
function viewSeriesList() {
  const rows = S.series.map(se => ({ se, tp: tplOf(se), n: S.shifts.filter(x => x.series === se.id).length })).sort((a, b) => b.se.until.localeCompare(a.se.until));
  return `<header class="nav"><div class="l"><a class="circ" href="#/ajustes" aria-label="Voltar">${ic('left')}</a></div><h1>Recorrências</h1><div class="r"></div></header>
  <div class="gl">${rows.length ? `<div class="group" style="margin-top:12px">${rows.map(({ se, tp, n }) => `<a class="cell" href="#/serie/${se.id}" style="${pc(tp)}"><span class="k"><span class="dot"></span><span>${esc(tp.title)}<br><small style="color:var(--label2);font-size:13px">${esc(se.label)} · até ${dmy(se.until)} · ${pl(n, 'plantão', 'plantões')}</small></span></span><span class="v">${ic('chev', 16, 2)}</span></a>`).join('')}</div>` : '<p class="empty">Nenhuma recorrência. Ao criar um plantão, escolha “Repetir”.</p>'}
  <p class="gfoot">Uma recorrência gera os plantões de uma vez; cada um pode ser editado, recebido ou apagado sozinho.</p></div>`;
}
function viewSeries() {
  const se = seriesById(S.seriesId); if (!se) return `<header class="nav"><div class="l"><a class="circ" href="#/recorrencias" aria-label="Voltar">${ic('left')}</a></div><h1>Recorrência</h1><div class="r"></div></header><p class="empty">Série não encontrada.</p>`;
  const tp = tplOf(se), rows = occurrences(se.freq, se.interval, se.starts_on, se.until).map(k => ({ k, s: S.shifts.find(x => x.series === se.id && day(x) === k), ed: !!se.overrides[k] })).map(r => ({ ...r, skip: !r.s }));
  const next = rows.find(r => r.k >= TODAY && !r.skip), cur = TODAY.slice(0, 7), fut = rows.filter(r => r.k.slice(0, 7) >= cur), past = rows.filter(r => r.k.slice(0, 7) < cur);
  const months = [...new Set(fut.map(r => r.k.slice(0, 7)))].slice(0, 3), n = rows.filter(r => !r.skip).length;
  const occ = r => r.skip ? `<div class="occ skip"><span class="d num">${wdm(r.k)}</span><span class="t">${tp.start}–${tp.end} · pulado</span><button class="textb" data-act="restore" data-id="${r.k}">Restaurar</button></div>`
    : `<button class="occ" data-act="occ" data-id="${r.k}"><span class="d num${r.k < TODAY ? ' past' : ''}">${wdm(r.k)}</span><span class="t num"><b>${t0(r.s)}–${t1(r.s)}</b>${r.s.paid_at || r.s.amount_zero ? '' : r.s.expected_pending ? ' · sem previsão' : ` · ${isExpense(r.s) ? 'vence' : 'cai'} ${dm(r.s.expected_on)}`}</span><span>${r.s.paid_at ? `<span class="tag ok">${isExpense(r.s) ? 'pago' : 'recebido'}</span>` : r.ed ? `<span class="tag">editado</span>` : next && r.k === next.k ? `<span class="tag">próximo</span>` : ''}</span></button>`;
  return `
  <header class="nav"><div class="l"><a class="circ" href="#/recorrencias" aria-label="Voltar">${ic('left')}</a></div><h1>Recorrência</h1><div class="r"></div></header>
  <div class="series-hd" style="${pc(tp)}"><span class="bar"></span><div><h1>${esc(tp.title)}</h1><p class="num">${esc(se.label)} · ${tp.start_pending ? 'horário a confirmar' : tp.end_pending ? `${tp.start} · término a definir` : `${tp.start}–${tp.end}`} · ${tp.amount_cents < 0 ? `a pagar ${brl(-tp.amount_cents)}` : tp.amount_cents || tp.amount_zero ? brl(tp.amount_cents) : 'valor a preencher'}</p></div></div>
  <div class="gl">
    <div class="group" style="margin-top:16px">
      <div class="cell"><span class="k">Local</span><span class="v"><span class="dot" style="${tp.place ? pcKey(P(tp.place).color) : pc(null)}"></span>${esc(P(tp.place).short)} · ${esc(P(tp.place).name)}</span></div>
      <div class="cell"><span class="k">Cor</span><span class="v"><span class="dot" style="${pc(tp)}"></span>${isColorKey(tp.color_override) ? `Personalizada · ${PAL_NAMES[tp.color_override]}` : tp.place ? 'Do local' : 'Neutra'}${Object.values(se.overrides).some(o => o.color_override) ? ` · ${pl(Object.values(se.overrides).filter(o => o.color_override).length, 'exceção', 'exceções')}` : ''}</span></div>
      <div class="cell"><span class="k">Repete</span><span class="v">${freqTxt(se)}</span></div>
      <div class="cell"><span class="k">Até</span><span class="v num">${dmy(se.until)}</span></div>
      <div class="cell"><span class="k">Recebimento</span><span class="v">${ruleTxt(tp.place)}</span></div>
    </div>
    <p class="gfoot">${pl(n, 'plantão', 'plantões')} · ${pl(rows.filter(r => r.skip).length, 'pulado', 'pulados')} · ${pl(Object.keys(se.overrides).length, 'editado só nessa data', 'editados só nessas datas')}. Toque em uma data para editar; para apagar, use o gesto ou o “⋯” na lista do dia (escopos: só este, este e os próximos, toda a série).</p>
  </div>
  ${months.map(ym => `<div class="mlabel">${monthOf(ym + '-01')}</div>${fut.filter(r => r.k.startsWith(ym)).map(occ).join('')}`).join('')}
  ${past.length ? `<div class="mlabel">anteriores · ${pl(past.filter(r => !r.skip).length, 'plantão', 'plantões')}</div>` : ''}
  ${S.sheet ? scopeSheet(se) : ''}`;
}
function scopeSheet(se) {
  const { occ, scope } = S.sheet, s = S.shifts.find(x => x.series === se.id && day(x) === occ), tp = tplOf(se); if (!s) return '';
  const all = S.shifts.filter(x => x.series === se.id), fol = all.filter(x => day(x) >= occ && !x.paid_at), nAll = all.filter(x => !x.paid_at).length, paid = all.length - nAll;
  const opt = (v, t, d, dis) => `<label class="radio${dis ? ' dis' : ''}"><input type="radio" name="scope" value="${v}"${scope === v ? ' checked' : ''}${dis ? ' disabled' : ''}><span><b>${t}</b><small>${d}</small></span></label>`;
  return `<div class="dim" data-act="sheetx"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh-t">
    <div class="handle"></div>
    <h2 id="sh-t">Editar ${wdm(occ)}</h2><p class="sub">${esc(tp.title)} · ${esc(P(tp.place).short)}${se.overrides[occ] ? ' · já editado só nesta data' : ''}</p>
    <div class="three"><label>Início<input class="num" type="time" id="sc-start" value="${s.start_pending ? '' : t0(s)}"></label><label>Fim<input class="num" type="time" id="sc-end" value="${s.end_pending ? '' : t1(s)}"></label><label>Valor<input class="num" id="sc-amt" inputmode="decimal" placeholder="a preencher" value="${amountKnown(s) ? (isExpense(s) ? '-' : '') + amtTxt(s) : ''}"></label></div>
    <label class="cell sccolor"><span class="k">Cor</span><span class="v"><span class="sq" style="${pc(s)}"></span><select id="sc-color"><option value="">Manter como está</option><option value="inherit">${tp.place ? 'Do local' : 'Neutra'}</option>${PALETTE.map(k => `<option value="${k}">${PAL_NAMES[k]}</option>`).join('')}</select>${ic('chev', 16, 2)}</span></label>
    <div class="ghead" style="padding-left:0">Aplicar a</div>
    ${opt('one', 'Só este', s.paid_at ? 'Já recebido — desfaça o recebimento para editar.' : `${dm(occ)} · 1 plantão. O resto da série não muda.`, !!s.paid_at)}
    ${opt('following', 'Este e os próximos', `${dm(occ)} → ${dm(se.until)} · ${pl(fol.length, 'plantão', 'plantões')}. Os anteriores ficam como estão.`)}
    ${opt('all', 'Toda a série', `${pl(nAll, 'plantão não recebido', 'plantões não recebidos')}, inclusive os já trabalhados.`)}
    <p class="lock">${ic('lock', 14, 2)} Plantões recebidos nunca mudam nem somem (${paid} nesta série). Datas puladas continuam puladas. Cores escolhidas só numa data são mantidas nos escopos amplos.</p>
    <div class="acts"><button class="btn" data-act="sheetx">Cancelar</button><button class="btn p" data-act="applyScope">Aplicar</button></div>
  </div>`;
}

/* ---------- T05 pagamentos ---------- */
function viewPay() {
  const ym = S.pay, mon = monthOf(ym + '-01'), y = ym.slice(0, 4), c = cohort(ym, S.cohort), od = overdue();
  const pct = c.total ? Math.round(c.received / c.total * 100) : 0, cash = S.cohort === 'cash';
  const inF = s => S.filter === 'all' || (s.place || 'none') === S.filter, late = s => s.amount_cents > 0 && !s.expected_pending && s.expected_on < TODAY; /* R9: só receita com valor e previsão reais atrasa */
  const up = c.list.filter(s => !isExpense(s) && !s.amount_zero && !s.paid_at && !late(s) && inF(s)).sort((a, b) => (cash ? a.expected_on.localeCompare(b.expected_on) : a.start.localeCompare(b.start)));
  const got = c.list.filter(s => !isExpense(s) && !s.amount_zero && s.paid_at && inF(s)).sort((a, b) => a.paid_at.localeCompare(b.paid_at));
  const pays = c.list.filter(s => isExpense(s) && inF(s)).sort((a, b) => (a.paid_at ? 1 : 0) - (b.paid_at ? 1 : 0) || a.expected_on.localeCompare(b.expected_on)); /* despesas: nunca na lista de recebimentos */
  const noDate = cash ? S.shifts.filter(s => s.expected_pending && !s.paid_at && amountKnown(s) && s.amount_cents !== 0 && inF(s)) : []; /* sem previsão: não caem em mês nenhum, mas não somem */
  const lateIn = od.filter(inF);
  const paidIn = cohortOf(S.shifts, ym, 'paid');
  const fplaces = places().concat(Object.keys(c.byPlace).filter(id => S.places[id]?.archived).map(id => S.places[id])), noPlace = !!c.byPlace['']; /* R6: grupo "Sem local" */
  const avg = c.minutes ? brl(Math.round(c.total / (c.minutes / 60))) : null; /* R7: média por hora (só exibição; coortes intactas) */
  const LATE_MAX = 5;
  /* R7: composição em cards (resumo · atrasados expansível · agrupado por local), como o app-modelo de 27/10 (V6); semântica Cai no mês × Trabalhado × Caixa inalterada */
  return `
  <div class="lt"><h1>Pagamentos</h1></div>
  <div class="pg gl">
    <div class="mon"><button class="circ" data-act="pprev" aria-label="Mês anterior">${ic('left', 20, 2)}</button><h2>${cap(mon)} ${y}</h2><button class="circ" data-act="pnext" aria-label="Próximo mês">${ic('right', 20, 2)}</button></div>
    <div class="seg" role="group" aria-label="Recorte do mês"><button data-act="cohort" data-id="cash" aria-pressed="${cash}">Cai no mês</button><button data-act="cohort" data-id="worked" aria-pressed="${!cash}">Trabalhado</button></div>
    <section class="hero group" aria-live="polite">
      <div class="lab">${cash ? `Cai em ${mon}` : `Trabalhado em ${mon}`}</div>
      <div class="big">${brl(c.total)}</div>
      <div class="cap num">${pl(c.count, 'plantão', 'plantões')}${cash ? ' · pela previsão de recebimento' : ` · ${hrs(c.minutes)} · pelo dia de início`}</div>
      <div class="split"><div class="ok">Recebido<b>${brl(c.received)}</b></div><div>${cash ? 'Pendente' : 'A receber'}<b>${brl(c.pending)}</b></div></div>
      <div class="bar2" role="img" aria-label="${pct}% recebido"><i style="width:${pct}%"></i></div>
      <p class="note">${avg ? `${avg}/h em média · ` : ''}Caixa de ${mon}: ${brl(paidIn.total)} recebidos de fato (${pl(paidIn.count - paidIn.expense.count, 'plantão', 'plantões')}), pela data do recebimento.</p>
      ${c.expense.count ? `<div class="paybox"><div class="lab">A pagar ${cash ? `em ${mon}` : `· trabalhado em ${mon}`}</div><div class="split"><div>Em aberto<b>${brl(c.expense.pending)}</b></div><div class="ok">Pago<b>${brl(c.expense.paid)}</b></div></div><p class="note">Saldo líquido (receitas − despesas): <b class="num">${c.net < 0 ? '− ' + brl(-c.net) : brl(c.net)}</b>.</p></div>` : ''}
    </section>
    ${lateIn.length ? `<section class="late-box group"><button class="latehd" data-act="late" aria-expanded="${!!S.showLate}"><span class="ic">!</span><span class="lt2"><b>${pl(lateIn.length, 'recebimento atrasado', 'recebimentos atrasados')}</b><small class="num">${brl(sum(lateIn))} · o mais antigo previsto para ${dm(lateIn[0].expected_on)}</small></span>${ic(S.showLate ? 'down' : 'chev', 16, 2)}</button>
      ${S.showLate ? `<ul class="rows">${lateIn.slice(0, LATE_MAX).map(s => shiftRow(s, `<span class="num">previsto ${wdm(s.expected_on)}</span><span class="w2">trabalhado ${dm(day(s))}</span>`)).join('')}</ul>${lateIn.length > LATE_MAX ? `<p class="gfoot">… e mais ${lateIn.length - LATE_MAX}. Filtre por local ou use a lista do mês.</p>` : ''}` : `<div class="lateact"><button class="textb" data-act="pay" data-id="${lateIn[0].id}">Recebi: ${esc(lateIn[0].title)} · ${esc(P(lateIn[0].place).short)}</button></div>`}
    </section>` : ''}
    <div class="chips" style="margin-top:14px"><button class="chip s" data-act="filter" data-id="all" aria-pressed="${S.filter === 'all'}">Todos os locais</button>${fplaces.map(p => `<button class="chip s" data-act="filter" data-id="${p.id}" aria-pressed="${S.filter === p.id}" style="${pcKey(p.color)}"><i></i>${esc(p.short)}</button>`).join('')}${noPlace ? `<button class="chip s" data-act="filter" data-id="none" aria-pressed="${S.filter === 'none'}" style="${pc(null)}"><i></i>Sem local</button>` : ''}</div>
    <section class="sec"><h2>Agrupado por local <span>${cash ? `cai em ${mon}` : `trabalhado em ${mon}`}</span></h2>
      ${Object.keys(c.byPlace).length ? `<ul class="rows placecards">${Object.entries(c.byPlace).sort((a, b) => b[1].total - a[1].total).map(([pid, b]) => `<li><button class="row place group" data-act="filter" data-id="${pid || 'none'}" aria-pressed="${S.filter === (pid || 'none')}" style="${pid ? pcKey(P(pid).color) : pc(null)}"><span class="bar"></span><span class="pinfo"><span class="ttl">${esc(P(pid || null).name)}</span><span class="where num">${pl(b.count, 'plantão', 'plantões')}</span><span class="pr num"><span>Recebido <b class="ok">${brl(b.received)}</b></span><span>${cash ? 'Pendente' : 'A receber'} <b>${brl(b.pending)}</b></span>${b.expense ? `<span>A pagar <b>${brl(b.expense)}</b></span>` : ''}</span></span><span class="amt">${brl(b.total)}</span><span class="chev">${ic('chev', 16, 2)}</span></button></li>`).join('')}</ul>` : `<p class="empty" style="padding-left:0">Nenhum plantão ${cash ? `cai em ${mon}` : `trabalhado em ${mon}`}.</p>`}
    </section>
    <section class="sec"><h2>${cash ? 'Próximos a cair' : 'A receber'} <span class="num">${brl(sum(up))}</span></h2>
      ${up.length ? `<ul class="rows">${up.map(s => shiftRow(s, cash ? `<span class="num">cai ${wdm(s.expected_on)}</span><span class="w2">trabalhado ${dm(day(s))}</span>` : undefined)).join('')}</ul>` : `<p class="empty" style="padding-left:0">Nada pendente em ${mon}.</p>`}
      ${got.length ? `<button class="more" data-act="got">${S.showGot ? ic('down', 14, 2) : ic('chev', 14, 2)} Já recebidos ${cash ? `que caíam em ${mon}` : `de ${mon}`} (${got.length}) · ${brl(sum(got))}</button>${S.showGot ? `<ul class="rows">${got.map(s => shiftRow(s, `<span class="num">recebido ${wdm(s.paid_at)}</span><span class="w2">previsto ${dm(s.expected_on)}</span>`)).join('')}</ul>` : ''}` : ''}
    </section>
    ${pays.length ? `<section class="sec"><h2>A pagar <span class="num">${brl(Math.abs(sum(pays.filter(s => !s.paid_at))))}</span></h2><ul class="rows">${pays.map(s => shiftRow(s, cash ? `<span class="num">${s.paid_at ? `pago ${wdm(s.paid_at)}` : s.expected_pending ? 'sem previsão' : `pagar até ${wdm(s.expected_on)}`}</span><span class="w2">plantão de ${dm(day(s))}</span>` : undefined)).join('')}</ul></section>` : ''}
    ${noDate.length ? `<section class="sec"><h2>Sem previsão <span class="num">${pl(noDate.length, 'plantão', 'plantões')}</span></h2><ul class="rows">${noDate.map(s => shiftRow(s)).join('')}</ul><p class="gfoot" style="padding:6px 4px 0">Fora de “cai no mês” até terem data de previsão. Toque para completar.</p></section>` : ''}
  </div>`;
}

/* ---------- T06 ajustes, locais, modelos, dados, lixeira ---------- */
function viewSettings() {
  const t = themePref(), lb = S.meta.last_backup_at;
  return `
  <div class="lt"><h1>Ajustes</h1></div>
  <div class="gl">
    <div class="ghead">Aparência</div>
    <div class="group ics"><div class="cell"><span class="k">${sic('sun', '', 'w4')}Tema</span><div class="seg" role="group" aria-label="Tema">${[['light', 'Claro'], ['dark', 'Escuro'], ['system', 'Sistema']].map(([v, l]) => `<button data-act="theme" data-id="${v}" aria-pressed="${t === v}">${l}</button>`).join('')}</div></div></div>
    <p class="gfoot">“Sistema” acompanha o modo claro/escuro do iPhone.</p>
    <div class="ghead">Plantões</div>
    <div class="group ics">
      <a class="cell" href="#/locais"><span class="k">${sic('pin', '', 'w1')}Locais</span><span class="v">${places().map(p => `<span class="dot" style="${pcKey(p.color)}"></span>`).join('')} ${places().length} ${ic('chev', 16, 2)}</span></a>
      <a class="cell" href="#/modelos"><span class="k">${sic('tpl', '', 'w3')}Modelos de plantão</span><span class="v">${templates().length} ${ic('chev', 16, 2)}</span></a>
      <a class="cell" href="#/recorrencias"><span class="k">${sic('rep', '', 'w6')}Recorrências</span><span class="v">${S.series.length} ${ic('chev', 16, 2)}</span></a>
      <a class="cell" href="#/lixeira"><span class="k">${sic('trash', 'mute')}Lixeira</span><span class="v">${S.trash.length} ${ic('chev', 16, 2)}</span></a>
      <div class="cell"><span class="k">${sic('cal', '', 'w8')}Semana começa</span><div class="seg" role="group" aria-label="Primeiro dia da semana">${[[0, 'Domingo'], [1, 'Segunda']].map(([v, l]) => `<button data-act="week" data-id="${v}" aria-pressed="${(S.meta.week_start || 0) === v}">${l}</button>`).join('')}</div></div>
      <div class="cell"><span class="k">${sic('dots', '', 'w9')}Calendário</span><div class="seg" role="group" aria-label="Marcação dos plantões no calendário">${[['pontos', 'Pontos'], ['siglas', 'Siglas']].map(([v, l]) => `<button data-act="calmode" data-id="${v}" aria-pressed="${S.calMode === v}">${l}</button>`).join('')}</div></div>
    </div>
    <p class="gfoot">“Siglas” mostra o local em cada dia, sem depender da cor.</p>
    <div class="ghead">Seus dados</div>
    <div class="group ics">
      <a class="cell" href="#/dados"><span class="k">${sic('cloud', '', 'w2')}<span class="kt">Backup, exportar e importar<small>${lb ? `arquivo em ${dm(lb.slice(0, 10))}` : 'sem backup em arquivo'}${syncLoad()?.last_ok_at ? ` · servidor em ${dm(syncLoad().last_ok_at.slice(0, 10))}` : ''}</small></span></span><span class="v">${ic('chev', 16, 2)}</span></a>
      <a class="cell" href="#/sincronizacao"><span class="k">${sic('rep', '', 'w6')}<span class="kt">Sincronização<small id="v8-small">${esc(v8Status()[0])}</small></span></span><span class="v">${Object.keys(S.conflicts).length ? `<span class="late">${Object.keys(S.conflicts).length}</span> ` : ''}${ic('chev', 16, 2)}</span></a>
      ${saveCell()}
    </div>
    <p class="gfoot">${v8Active() ? 'Sincronizado entre os seus aparelhos, cifrado com a sua frase-senha. Funciona sem internet e envia ao reconectar.' : syncLoad() ? 'Sem conta: os plantões ficam neste aparelho e uma cópia cifrada vai para o seu servidor. Sem a frase-senha ninguém lê.' : 'Sem conta: os plantões ficam só neste aparelho. O backup é um arquivo seu ou, se você ativar, uma cópia cifrada no seu servidor.'}</p>
    <div class="ghead">Sobre</div>
    <div class="group ics">
      <div class="cell"><span class="k">${sic('info', 'mute')}Versão</span><span class="v">${esc(APP_VERSION)}</span></div>
      ${S.update ? `<button class="cell accent" data-act="update"><span class="k">${sic('down')}Atualizar para a nova versão</span></button>` : ''}
      <a class="cell" href="#/privacidade"><span class="k">${sic('lock', 'mute')}Privacidade</span><span class="v">${ic('chev', 16, 2)}</span></a>
    </div>
  </div>`;
}
function viewPrivacy() {
  return `<header class="nav"><div class="l"><a class="circ" href="#/ajustes" aria-label="Voltar">${ic('left')}</a></div><h1>Privacidade</h1><div class="r"></div></header>
  <div class="gl priv"><p>Os plantões, valores e observações ficam gravados neste aparelho (IndexedDB do navegador). Com a sincronização ativada, seguem para o servidor do dono do app cifrados no aparelho com a sua frase-senha, registro a registro. Sem ela, ninguém lê os dados, nem o servidor. Fora isso, só saem nos arquivos que você mesmo exportar.</p>
  <p>O backup no servidor vai só para o servidor do dono do app (plantoes-sync.vksos.com). O servidor guarda texto cifrado e não recebe a frase-senha: sem ela, ninguém lê os dados, nem o servidor. A política de segurança do app (CSP) bloqueia qualquer outra conexão fora da origem onde ele está instalado. Não há analytics, nem fontes ou scripts de terceiros.</p>
  <p>Como o iPhone pode apagar dados de sites sob pressão de espaço, faça backups periódicos (Ajustes › Seus dados). O app avisa quando passam 7 dias sem backup.</p>
  <p>Não registre dados de pacientes nas observações.</p></div>`;
}
function viewPlaces() {
  const act = places(), arch = Object.values(S.places).filter(p => p.archived);
  const cell = p => `<a class="cell" href="#/local/${p.id}" style="${pcKey(p.color)}" data-q="${esc(normTitleQ(p.name + ' ' + p.short))}"><span class="k"><span class="sq"></span><span class="kt">${esc(p.name)}<small>${esc(p.short)} · ${ruleTxt(p.id)}</small></span></span><span class="v">${ic('chev', 16, 2)}</span></a>`;
  return `<header class="nav"><div class="l"><a class="circ" href="#/ajustes" aria-label="Voltar">${ic('left')}</a></div><h1>Locais</h1><div class="r"><a class="circ" href="#/local/novo" aria-label="Novo local">${ic('plus', 22, 2)}</a></div></header>
  <div class="gl">${act.length > 1 ? `<div class="group search" style="margin-top:12px"><label class="cell plain">${ic('search', 18, 2)}<input id="pq" type="search" placeholder="Buscar locais" aria-label="Buscar locais" autocomplete="off"></label></div>` : ''}
  ${act.length ? `<div class="group" id="places-list" style="margin-top:12px">${act.map(cell).join('')}</div><p class="empty" id="pq-empty" hidden>Nenhum local com esse nome.</p>` : '<p class="empty">Nenhum local. Toque em “+” para cadastrar o primeiro.</p>'}
  ${(() => { const pairs = []; for (let i = 0; i < act.length; i++) for (let j = i + 1; j < act.length; j++) if (colorsClose(act[i].color, act[j].color)) pairs.push([act[i], act[j]]); return pairs.length ? `<div class="group" style="margin-top:12px">${pairs.slice(0, 3).map(([x, y]) => `<a class="cell" href="#/local/${y.id}"><span class="k"><span class="sq" style="${pcKey(x.color)}"></span><span class="sq" style="${pcKey(y.color)}"></span><span class="kt">Cores parecidas<small>${esc(x.name)} e ${esc(y.name)} · toque para trocar a de ${esc(y.name)}</small></span></span><span class="v">${ic('chev', 16, 2)}</span></a>`).join('')}</div>` : ''; })()}
  <p class="gfoot">Cada local tem sigla, cor padrão e regra de recebimento. A cor do local vale para os plantões que não têm cor própria.</p>
  ${arch.length ? `<div class="ghead">Arquivados</div><div class="group">${arch.map(cell).join('')}</div><p class="gfoot">Arquivar tira o local do formulário e da legenda; os plantões dele continuam.</p>` : ''}</div>`;
}
const normTitleQ = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); /* R7: busca de locais sem acento */
const freeColor = (n = Object.keys(S.places).length) => DEFAULT_COLORS.find(k => !Object.values(S.places).some(p => p.color === k)) || DEFAULT_COLORS[n % DEFAULT_COLORS.length];
const newPlaceForm = () => ({ id: null, name: '', short: '', color: freeColor(), kind: 'days_after', days: 30, day: 10, archived: false });
const placeForm = p => ({ orig: JSON.stringify(p), id: p.id, name: p.name, short: p.short, color: p.color, kind: p.rule.kind, days: p.rule.kind === 'days_after' ? p.rule.days : 30, day: p.rule.kind === 'fixed_day' ? p.rule.day : 10, archived: !!p.archived });
function validatePlace(f) { const e = {}; if (!f.name.trim()) e.name = 'nome'; if (!f.short.trim() || f.short.trim().length > 4) e.short = 'sigla (1 a 4 letras)'; if (!PALETTE.includes(f.color)) e.color = 'cor'; if (!validRule(f.kind === 'days_after' ? { kind: 'days_after', days: +f.days } : { kind: 'fixed_day', day: +f.day })) e.rule = f.kind === 'days_after' ? 'dias (0 a 366)' : 'dia do mês (1 a 31)'; return e; }
function viewPlaceForm() {
  const f = S.pform, ed = !!f.id, e = validatePlace(f), ok = !Object.keys(e).length, n = ed ? S.shifts.filter(s => s.place === f.id).length : 0;
  return `
  <header class="nav"><div class="l"><a class="textb" href="${S.formKeep ? (S.formKeep.editId ? '#/editar/' + S.formKeep.editId : '#/novo/' + S.formKeep.date) : '#/locais'}">Cancelar</a></div><h1>${ed ? 'Editar local' : 'Novo local'}</h1><div class="r"><button class="textb b" data-act="psave"${ok ? '' : ' aria-disabled="true"'}>Salvar</button></div></header>
  <form id="pf" class="gl" novalidate>
    <div class="ghead">Local</div>
    <div class="group">
      <label class="cell plain"><input name="name" value="${esc(f.name)}" placeholder="Nome (ex.: UPA Vila Nova)" autocomplete="off" aria-label="Nome do local"></label>
      <label class="cell"><span class="k">Sigla</span><input class="short num" name="short" value="${esc(f.short)}" maxlength="4" placeholder="UPA" aria-label="Sigla"></label>
    </div>
    <p class="gfoot">A sigla aparece no calendário no modo “Siglas” e nas listas.</p>
    <div class="ghead">Cor</div>
    <div class="group"><div class="cell col swcell"><span class="k">${PAL_NAMES[f.color] ? `Escolhida: ${PAL_NAMES[f.color]}` : 'Cor'}${(() => { const o = Object.values(S.places).find(p => !p.archived && p.id !== f.id && colorsClose(p.color, f.color)); return o ? ` · parecida com a de ${esc(o.name)}` : ''; })()}</span>${specGrid(f.color, 'pcolor', 'pf-colors')}</div></div>
    <div class="ghead">Regra de recebimento</div>
    <div class="group">
      <div class="cell"><span class="k">Quando recebe</span><div class="seg" role="group" aria-label="Tipo de regra"><button type="button" data-act="pkind" data-id="days_after" aria-pressed="${f.kind === 'days_after'}">Dias após</button><button type="button" data-act="pkind" data-id="fixed_day" aria-pressed="${f.kind === 'fixed_day'}">Dia fixo</button></div></div>
      ${f.kind === 'days_after' ? `<label class="cell"><span class="k">Dias após o plantão</span><input type="number" class="num" name="days" min="0" max="366" inputmode="numeric" value="${esc(f.days)}"></label>` : `<label class="cell"><span class="k">Dia do mês seguinte</span><input type="number" class="num" name="day" min="1" max="31" inputmode="numeric" value="${esc(f.day)}"></label>`}
    </div>
    <p class="gfoot">${f.kind === 'days_after' ? 'Ex.: 30 dias após → plantão de 22/10 cai em 21/11.' : 'Ex.: dia 10 → plantão de 22/10 cai em 10/11. No mês sem esse dia, vale o último dia válido.'} A regra só muda a previsão de plantões novos; os existentes mantêm a sua.</p>
    ${ed ? `<div class="group" style="margin-top:20px"><div class="cell"><span class="k">Arquivado</span><button type="button" class="sw" role="switch" aria-checked="${f.archived}" data-act="parch" aria-label="Arquivar local" style="margin-left:auto"></button></div></div><p class="gfoot">Arquivar esconde o local do formulário e da legenda; ${pl(n, 'plantão existente continua', 'plantões existentes continuam')} no calendário e nas somas.</p>` : ''}
    <p id="pf-status" class="status-line ${ok ? 'ok' : 'warn'}" aria-live="polite">${ok ? `${ic('check', 14, 2.4)} Pronto para salvar` : `${ic('alert', 14, 2.2)} Falta: ${Object.values(e).join(', ')}`}</p>
  </form>`;
}
function readPlaceForm() { const el = document.getElementById('pf'); if (!el) return S.pform; const fd = new FormData(el), f = S.pform; for (const k of ['name', 'short', 'days', 'day']) if (fd.has(k)) f[k] = fd.get(k); f.short = f.short.toUpperCase(); return f; }
function savePlace() {
  const f = readPlaceForm(), e = validatePlace(f);
  if (Object.keys(e).length) { S.toast = { msg: `Ainda falta: ${Object.values(e).join(', ')}.` }; renderToast(); const el = document.querySelector(`#pf [name="${e.name ? 'name' : e.short ? 'short' : f.kind === 'days_after' ? 'days' : 'day'}"]`); if (el) { el.setAttribute('aria-invalid', 'true'); el.focus(); } return; }
  const rule = f.kind === 'days_after' ? { kind: 'days_after', days: +f.days } : { kind: 'fixed_day', day: +f.day };
  const p = f.id ? S.places[f.id] : (S.places[uid()] = { id: null }); if (!p.id) p.id = Object.keys(S.places).find(k => S.places[k] === p);
  const before = JSON.stringify(p), vals = { name: f.name.trim(), short: f.short.trim().toUpperCase(), color: f.color, rule, archived: !!f.archived };
  if (f.id && f.orig) { const open = JSON.parse(f.orig); v8AddConflicts(applyChanged(p, open, { ...open, ...vals }), 'places', p.id); p.updated_at = nowIso(); } else Object.assign(p, vals, { updated_at: nowIso() });
  S.toast = { msg: `${esc(p.name)} ${f.id ? 'atualizado' : 'cadastrado'}.`, undo: f.id ? () => Object.assign(p, JSON.parse(before)) : () => { delete S.places[p.id]; } };
  S.pform = null; persist();
  if (S.formKeep) { S.formKeep.place = p.id; S.formKeep.expOverride = !!S.formKeep.editId; go(S.formKeep.editId ? '#/editar/' + S.formKeep.editId : '#/novo/' + S.formKeep.date); } /* volta ao formulário com o local novo escolhido; em edição a previsão existente não muda */
  else go('#/locais');
}
function viewTemplates() {
  const act = templates(), arch = S.templates.filter(t => t.archived);
  const mins = t => toMin(t.end) - toMin(t.start) + 1440 * (t.end_days ?? legacySpan(t.start, t.end));
  const cell = t => `<a class="cell" href="#/modelo/${t.id}" style="${pc(t)}"><span class="k"><span class="sq"></span><span class="kt">${esc(t.title)}<small class="num">${t.start}–${t.end} · ${hrs(mins(t))} · ${t.amount_cents < 0 ? `a pagar ${brl(-t.amount_cents)}` : brl(t.amount_cents)} · ${esc(P(t.place).short)}</small></span></span><span class="v">${ic('chev', 16, 2)}</span></a>`; /* R7: nome · turno · duração · valor · local */
  return `<header class="nav"><div class="l"><a class="circ" href="#/ajustes" aria-label="Voltar">${ic('left')}</a></div><h1>Modelos de plantão</h1><div class="r"><a class="circ" href="#/modelo/novo" aria-label="Novo modelo">${ic('plus', 22, 2)}</a></div></header>
  <div class="gl">${act.length ? `<div class="group" style="margin-top:12px">${act.map(cell).join('')}</div>` : '<p class="empty">Nenhum modelo. Toque em “+” para criar o primeiro.</p>'}
  <p class="gfoot">Um modelo preenche título, local, horário e valor com um toque no formulário.</p>
  ${arch.length ? `<div class="ghead">Arquivados</div><div class="group">${arch.map(cell).join('')}</div>` : ''}</div>`;
}
const newTplForm = () => ({ id: null, title: '', place: places()[0]?.id || '', start: '07:00', end: '19:00', amount: '', kind: 'in', archived: false, color: '' });
const tplForm = t => ({ orig: JSON.stringify(t), id: t.id, title: t.title, place: t.place, start: t.start, end: t.end, amount: centsTxt(Math.abs(t.amount_cents)), kind: t.amount_cents < 0 ? 'out' : 'in', archived: !!t.archived, color: t.color_override || '' });
/* R9: início = fim é um modelo de 24 h; o valor pode ser despesa (A pagar) */
function validateTpl(f) { const e = {}; if (!f.title.trim()) e.title = 'título'; if (!f.place || !S.places[f.place]) e.place = 'local'; if (!isTimeHM(f.start) || !isTimeHM(f.end)) e.time = 'horário'; const a = formCents(f); if (!a || !a.known || a.cents === 0) e.amount = 'valor'; return e; }
function viewTplForm() {
  const f = S.tform, ed = !!f.id, e = validateTpl(f), ok = !Object.keys(e).length;
  return `
  <header class="nav"><div class="l"><a class="textb" href="#/modelos">Cancelar</a></div><h1>${ed ? 'Editar modelo' : 'Novo modelo'}</h1><div class="r"><button class="textb b" data-act="tsave"${ok ? '' : ' aria-disabled="true"'}>Salvar</button></div></header>
  <form id="tf" class="gl" novalidate>
    <div class="ghead">Modelo</div>
    <div class="group">
      <label class="cell plain"><input name="title" value="${esc(f.title)}" placeholder="Título (ex.: Noturno 12h)" autocomplete="off" aria-label="Título do modelo"></label>
      <label class="cell"><span class="k">Local</span><span class="v"><span class="sq${f.place && S.places[f.place] ? '' : ' neutral'}" id="tf-dot" style="${placeSq(f.place)}"></span><select name="place"><option value="">Escolher</option>${places().map(p => `<option value="${p.id}"${f.place === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>${ic('chev', 16, 2)}</span></label>
      <label class="cell"><span class="k">Começa</span><input class="num" type="time" name="start" value="${f.start}"></label>
      <label class="cell"><span class="k">Termina</span><input class="num" type="time" name="end" value="${f.end}"></label>
      <div class="cell"><span class="k">Tipo</span><div class="seg" role="group" aria-label="Receita ou despesa"><button type="button" data-act="tkind" data-id="in" aria-pressed="${f.kind !== 'out'}">A receber</button><button type="button" data-act="tkind" data-id="out" aria-pressed="${f.kind === 'out'}">A pagar</button></div></div>
      <label class="cell"><span class="k">Valor</span><span class="v" style="gap:4px"><span>${f.kind === 'out' ? '− R$' : 'R$'}</span><input name="amount" inputmode="decimal" placeholder="0,00" value="${esc(f.amount)}" style="width:110px"></span></label>
    </div>
    <p class="gfoot">Início igual ao fim vale um plantão de 24 horas.</p>
    <div class="ghead">Cor</div>
    <div class="group"><div class="cell col swcell"><span class="k">Cor dos plantões deste modelo</span>${swatches(f, 'tcolor', 'tf-colors')}</div></div>
    <p class="gfoot" id="tf-colorfoot">${colorFoot(f)}</p>
    ${ed ? `<div class="group" style="margin-top:20px"><div class="cell"><span class="k">Arquivado</span><button type="button" class="sw" role="switch" aria-checked="${f.archived}" data-act="tarch" aria-label="Arquivar modelo" style="margin-left:auto"></button></div></div><p class="gfoot">Arquivar tira o modelo dos chips do formulário; nenhum plantão muda.</p>` : ''}
    <p id="tf-status" class="status-line ${ok ? 'ok' : 'warn'}" aria-live="polite">${ok ? `${ic('check', 14, 2.4)} Pronto para salvar` : `${ic('alert', 14, 2.2)} Falta: ${Object.values(e).join(', ')}`}</p>
  </form>`;
}
function readTplForm() { const el = document.getElementById('tf'); if (!el) return S.tform; const fd = new FormData(el), f = S.tform; for (const k of ['title', 'place', 'start', 'end', 'amount']) if (fd.has(k)) f[k] = fd.get(k); return f; }
function saveTpl() {
  const f = readTplForm(), e = validateTpl(f);
  if (Object.keys(e).length) { S.toast = { msg: `Ainda falta: ${Object.values(e).join(', ')}.` }; renderToast(); const el = document.querySelector(`#tf [name="${Object.keys(e)[0] === 'time' ? 'start' : Object.keys(e)[0]}"]`); if (el) { el.setAttribute('aria-invalid', 'true'); el.focus(); } return; }
  let t = f.id ? tplById(f.id) : null; const before = t && JSON.stringify(t);
  if (!t) { t = { id: uid() }; S.templates.push(t); }
  const vals = { title: f.title.trim(), place: f.place, start: f.start, end: f.end, amount_cents: formCents(f).cents, archived: !!f.archived, color_override: isColorKey(f.color) ? f.color : null };
  if (f.id && f.orig) { const open = JSON.parse(f.orig); v8AddConflicts(applyChanged(t, open, { ...open, ...vals }), 'templates', t.id); t.updated_at = nowIso(); } else Object.assign(t, vals, { updated_at: nowIso() });
  S.toast = { msg: `${esc(t.title)} ${f.id ? 'atualizado' : 'criado'}.`, undo: f.id ? () => Object.assign(t, JSON.parse(before)) : () => { S.templates = S.templates.filter(x => x !== t); } };
  S.tform = null; persist(); go('#/modelos');
}
function viewTrash() {
  const list = [...S.trash].sort((a, b) => (b.deleted_at || '').localeCompare(a.deleted_at || ''));
  return `<header class="nav"><div class="l"><a class="circ" href="#/ajustes" aria-label="Voltar">${ic('left')}</a></div><h1>Lixeira</h1><div class="r">${list.length ? `<button class="textb" data-act="tempty" style="color:var(--danger)">Esvaziar</button>` : ''}</div></header>
  ${list.length ? `<p class="gfoot" style="padding:8px 20px 0">${pl(list.length, 'plantão apagado', 'plantões apagados')}. Fora do calendário e das somas até ser restaurado.</p><ul class="rows">${list.map(s => `<li class="plain"><button class="row" data-act="trestore" data-id="${s.id}" style="${pc(s)}" aria-label="${esc(`Restaurar ${s.title}, ${P(s.place).name}, ${dmy(day(s))}`)}"><span class="bar"></span><span class="info"><span class="when"><span class="num">${dmy(day(s))} · ${t0(s)}–${t1(s)}</span></span><span class="ttl">${esc(s.title)}</span><span class="where"><span class="sg">${esc(P(s.place).short)}</span> · apagado ${dm((s.deleted_at || '').slice(0, 10))}</span></span><span class="right"><span class="amt">${money(s)}</span><span class="st pend">${ic('undo', 13, 2.2)} Restaurar</span></span></button></li>`).join('')}</ul>` : '<p class="empty">A lixeira está vazia.</p>'}`;
}
function viewData() {
  const lb = S.meta.last_backup_at, days = lb ? diffDays(lb.slice(0, 10), TODAY) : null, n = S.shifts.length;
  return `<header class="nav"><div class="l"><a class="circ" href="#/ajustes" aria-label="Voltar">${ic('left')}</a></div><h1>Seus dados</h1><div class="r"></div></header>
  <div class="gl">
    ${viewSyncGroup()}
    <div class="ghead">Backup completo</div>
    <div class="group">
      <div class="cell"><span class="k">Último backup</span><span class="v ${days != null && days > 7 ? 'late' : ''}">${lb ? `${dmy(lb.slice(0, 10))} ${lb.slice(11, 16)} UTC${days > 7 ? ` · há ${days} dias` : ''}` : 'nunca'}</span></div>
      <button class="cell accent" data-act="backup">Fazer backup agora (.json)</button>
      <button class="cell" data-act="pick" data-id="backup"><span class="k">Restaurar de um backup</span><span class="v">${ic('chev', 16, 2)}</span></button>
      ${S.meta.restore_undo ? `<button class="cell" data-act="restore-undo"><span class="k">Desfazer a última restauração</span><span class="v">${ic('undo', 16, 2)}</span></button>` : ''}
    </div>
    <p class="gfoot">O backup traz tudo (locais, modelos, recorrências, plantões, lixeira) com assinatura SHA-256; a restauração só grava depois de validar o arquivo inteiro e pode ser desfeita.</p>
    <div class="ghead">Exportar</div>
    <div class="group">
      <button class="cell" data-act="exp" data-id="csv"><span class="k">Planilha da escala (.csv)</span><span class="v">${n} ${ic('chev', 16, 2)}</span></button>
      <button class="cell" data-act="exp" data-id="ganhos"><span class="k">Planilha com ganhos (.csv)</span><span class="v">${ic('chev', 16, 2)}</span></button>
      <button class="cell" data-act="exp" data-id="ics"><span class="k">Agenda (.ics) sem valores</span><span class="v">${ic('chev', 16, 2)}</span></button>
      <button class="cell" data-act="exp" data-id="icsv"><span class="k">Agenda (.ics) com valores</span><span class="v">${ic('chev', 16, 2)}</span></button>
    </div>
    <p class="gfoot">CSV da escala no formato documentado do Plantãozinho (id, title, place, color, start_date, end_date, value, notes). A agenda "sem valores" leva só horário, título e local — para compartilhar o calendário sem expor ganhos; a "com valores" inclui valor, previsão e recebimento. O .ics abre no Calendário do iPhone pela folha de compartilhar.</p>
    <div class="ghead">Importar</div>
    <div class="group">
      <button class="cell" data-act="pick" data-id="csv"><span class="k">Planilha (.csv)</span><span class="v">${ic('chev', 16, 2)}</span></button>
      <button class="cell" data-act="pick" data-id="ics"><span class="k">Agenda (.ics)</span><span class="v">${ic('chev', 16, 2)}</span></button>
    </div>
    <p class="gfoot">Antes de gravar, você vê a prévia: válidas, inválidas (com o motivo) e duplicadas. Nada é alterado sem confirmação.</p>
    <div class="ghead">Dados de exemplo</div>
    <div class="group">${S.meta.sample_loaded ? `<button class="cell danger" data-act="sample-remove">Remover os dados de exemplo</button>` : `<button class="cell" data-act="sample">Carregar dados de exemplo (fictícios)</button>`}</div>
    <div class="ghead">Gravação</div>
    <div class="group">${saveCell()}<div class="cell"><span class="k">Armazenamento persistente</span><span class="v wrap ${S.storage?.persisted ? 'ok' : S.storage?.persisted === false ? 'late' : ''}">${S.storage?.persisted ? 'concedido pelo sistema' : S.storage?.persisted === false ? 'não concedido — o sistema pode apagar dados de sites sem aviso; mantenha backups' : 'não informado por este navegador'}</span></div></div>
    <input type="file" id="pick-csv" accept=".csv,text/csv,text/plain" hidden><input type="file" id="pick-ics" accept=".ics,text/calendar" hidden><input type="file" id="pick-backup" accept=".json,application/json" hidden>
  </div>`;
}
function viewImport() {
  const im = S.imp; if (!im) return `<header class="nav"><div class="l"><a class="circ" href="#/dados" aria-label="Voltar">${ic('left')}</a></div><h1>Importar</h1><div class="r"></div></header><p class="empty">Nenhum arquivo escolhido.</p>`;
  const kind = { csv: 'planilha', ics: 'agenda', backup: 'backup' }[im.kind], pv = im.preview;
  if (im.kind === 'backup') {
    const b = im.raw, ok = pv.ok;
    return `<header class="nav"><div class="l"><a class="textb" href="#/dados">Cancelar</a></div><h1 tabindex="-1">Restaurar backup</h1><div class="r"><button class="textb b" data-act="imp-confirm"${ok ? '' : ' aria-disabled="true"'}>Restaurar</button></div></header>
    <div class="gl"><div class="ghead">Arquivo</div><div class="group">
      <div class="cell"><span class="k">Nome</span><span class="v wrap">${esc(im.name)}</span></div>
      ${typeof b?.exported_at === 'string' ? `<div class="cell"><span class="k">Exportado em</span><span class="v num">${esc(b.exported_at.replace('T', ' ').slice(0, 16))} UTC</span></div>` : ''}
      ${typeof b?.app_version === 'string' ? `<div class="cell"><span class="k">Versão do app</span><span class="v">${esc(b.app_version.slice(0, 40))}</span></div>` : ''}
      ${b?.counts && ['shifts', 'places', 'templates', 'series'].every(k => Number.isInteger(b.counts[k])) ? `<div class="cell"><span class="k">Conteúdo</span><span class="v wrap num">${b.counts.shifts} plantões · ${b.counts.places} locais · ${b.counts.templates} modelos · ${b.counts.series} recorrências</span></div>` : ''}
      <div class="cell"><span class="k">Verificação</span><span class="v ${ok ? 'ok' : 'late'}">${ok ? 'íntegro e válido' : 'rejeitado'}</span></div></div>
      ${ok ? `<p class="gfoot">Restaurar substitui tudo o que está no aparelho (${S.shifts.length} plantões hoje). A restauração é atômica e pode ser desfeita em Seus dados › Desfazer.</p>` : `<div class="ghead">Problemas</div><div class="group"><ul class="imp">${pv.errors.slice(0, 30).map(e => `<li>${esc(e)}</li>`).join('')}</ul></div><p class="gfoot">Nada foi alterado.</p>`}</div>`;
  }
  const conf = pv.conflicts || [], mode = im.mode || 'keep', ok = pv.valid?.length > 0 || (conf.length > 0 && mode === 'replace'), noAmt = (pv.valid || []).filter(s => s.noAmount).length;
  const chTxt = c => c.changes.map(x => `${x.field}: ${x.money ? brl(x.from) : esc(String(x.from)).slice(0, 24)} → ${x.money ? brl(x.to) : esc(String(x.to)).slice(0, 24)}`).join(' · ');
  return `<header class="nav"><div class="l"><a class="textb" href="#/dados">Cancelar</a></div><h1 tabindex="-1">Importar ${kind}</h1><div class="r"><button class="textb b" data-act="imp-confirm"${ok ? '' : ' aria-disabled="true"'}>Importar</button></div></header>
  <div class="gl">
    <div class="ghead">${esc(im.name)}</div>
    ${pv.error ? `<div class="group" role="status"><div class="cell"><span class="k">Não deu para ler</span><span class="v late wrap">${esc(pv.error)}</span></div></div>` : `<div class="group" role="status" aria-label="Resumo da importação">
      <div class="cell"><span class="k">Registros no arquivo</span><span class="v num">${pv.total}</span></div>
      <div class="cell"><span class="k">Vão entrar</span><span class="v"><span class="badge ok">${pv.valid.length}</span></span></div>
      <div class="cell"><span class="k">Duplicados (ignorados)</span><span class="v"><span class="badge">${pv.dup.length}</span></span></div>
      <div class="cell"><span class="k">Inválidos (ignorados)</span><span class="v"><span class="badge${pv.invalid.length ? ' warn' : ''}">${pv.invalid.length}</span></span></div>
      ${conf.length ? `<div class="cell"><span class="k">Conflitos</span><span class="v"><span class="badge warn">${conf.length}</span></span></div>` : ''}
      ${noAmt ? `<div class="cell"><span class="k">Sem valor</span><span class="v wrap">${noAmt} entram com R$ 0,00 (valor a preencher; fora das somas)</span></div>` : ''}
      ${(pv.valid || []).filter(s => !s.place).length ? `<div class="cell"><span class="k">Sem local</span><span class="v wrap">${(pv.valid || []).filter(s => !s.place).length} entram sem local${(pv.valid || []).some(s => !s.place && !s.expected_on) ? ' (previsão pela regra padrão: 30 dias após; ajuste depois)' : ''}</span></div>` : ''}
      ${(pv.valid || []).some(s => s.tzUnknown) ? `<div class="cell"><span class="k">Fuso desconhecido</span><span class="v wrap">${(pv.valid || []).filter(s => s.tzUnknown).length} eventos com fuso não reconhecido: horário tratado como de São Paulo</span></div>` : ''}
    </div>
    ${pv.newPlaces.length ? `<div class="ghead">Locais novos (serão criados)</div><div class="group"><ul class="imp">${pv.newPlaces.map(p => `<li><span>${esc(p.name)}</span><small>${pl(p.count, 'plantão', 'plantões')} · regra padrão: 30 dias após</small></li>`).join('')}</ul></div><p class="gfoot">Depois ajuste sigla, cor e regra em Ajustes › Locais.</p>` : ''}
    ${pv.invalid.length ? `<div class="ghead">Inválidos</div><div class="group"><ul class="imp">${pv.invalid.slice(0, 20).map(x => `<li><span class="n">linha ${x.line}</span><small>${esc(x.reason)}</small></li>`).join('')}${pv.invalid.length > 20 ? `<li><small>… e mais ${pv.invalid.length - 20}</small></li>` : ''}</ul></div>` : ''}
    ${conf.length ? `<div class="ghead">Conflitos (já existem aqui, com conteúdo diferente)</div><div class="group"><div class="cell"><span class="k">O que fazer</span><div class="seg" role="group" aria-label="Como tratar os conflitos"><button data-act="imp-mode" data-id="keep" aria-pressed="${mode === 'keep'}">Manter os meus</button><button data-act="imp-mode" data-id="replace" aria-pressed="${mode === 'replace'}">Substituir pelo arquivo</button></div></div><ul class="imp">${conf.slice(0, 10).map(c => `<li><span>${esc(c.title)} · ${dmy(c.start.slice(0, 10))}</span><small>${chTxt(c)}</small></li>`).join('')}${conf.length > 10 ? `<li><small>… e mais ${conf.length - 10}</small></li>` : ''}</ul></div><p class="gfoot">"Substituir" atualiza título, horário, valor e observação do plantão existente; a data em que você recebeu nunca é alterada por importação.</p>` : ''}
    ${pv.dup.length ? `<div class="ghead">Duplicados</div><div class="group"><ul class="imp">${pv.dup.slice(0, 10).map(x => `<li><span>${esc(x.title)}</span><small>${dmy(x.start.slice(0, 10))}${x.why ? ' · ' + x.why : ''}</small></li>`).join('')}${pv.dup.length > 10 ? `<li><small>… e mais ${pv.dup.length - 10}</small></li>` : ''}</ul></div>` : ''}`}
    <p class="gfoot">Nada é gravado até você tocar em Importar. Depois dá para desfazer.</p>
  </div>`;
}

/* ---------- importação / exportação (efeitos) ---------- */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
async function readPicked(kind, file) {
  S.imp = { kind, name: file.name, preview: null, raw: null };
  if (file.size > MAX_FILE_BYTES) { S.imp.preview = kind === 'backup' ? { ok: false, errors: [`arquivo com ${(file.size / 1048576).toFixed(1)} MB — o limite é 5 MB`] } : { error: `arquivo com ${(file.size / 1048576).toFixed(1)} MB — o limite é 5 MB`, valid: [], invalid: [], dup: [], newPlaces: [], total: 0 }; go('#/importar'); return; } /* M3 */
  try {
    const text = await file.text(); const data = { places: Object.values(S.places), templates: S.templates, series: S.series, shifts: S.shifts };
    if (kind === 'csv') S.imp.preview = csvPreview(text, data);
    else if (kind === 'ics') S.imp.preview = icsPreview(text, data);
    else { let obj = null; try { obj = JSON.parse(text); } catch (e) { obj = null; } S.imp.raw = obj; S.imp.preview = obj ? await backupVerify(obj) : { ok: false, errors: ['o arquivo não é um JSON válido'] }; }
  } catch (e) { S.imp.preview = { error: String(e.message || e), valid: [], invalid: [], dup: [], newPlaces: [], total: 0 }; }
  go('#/importar');
}
function confirmImport() {
  const im = S.imp; if (!im || !im.preview) return true;
  if (im.kind === 'backup') { if (!im.preview.ok) return true; const keys = im.syncKeys, c = restoreBackup(im.preview.data);
    /* r8 B-01: o backup no servidor só liga depois que a restauração está DURÁVEL; se a gravação falhar, nada é ativado */
    if (keys) (c ? c.done : Promise.reject(new Error('sem gravação'))).then(() => syncActivate(keys, { created: true }), () => { S.toast = { msg: 'A restauração não foi gravada; o backup no servidor não foi ativado.' }; renderToast(); });
    return true; }
  const pv = im.preview, conf = pv.conflicts || [], replace = im.mode === 'replace'; if (!pv.valid?.length && !(replace && conf.length)) return true;
  const createdPlaces = [], map = {}; let ci = Object.keys(S.places).length;
  for (const np of pv.newPlaces) { const id = uid(); const short = (np.name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).map(w => w[0] || '').join('').slice(0, 3) || np.name.slice(0, 3)).toUpperCase(); S.places[id] = { id, name: np.name, short, color: isColorKey(np.color) ? np.color : freeColor(ci++), rule: { ...DEFAULT_RULE }, archived: false, updated_at: nowIso() }; map[np.tempId] = id; createdPlaces.push(id); } /* R7 (G-R7-03): a cor do CSV semeia o local novo */
  const made = pv.valid.map(v => { const place = map[v.place] || v.place || null; const s = { id: uid(), title: v.title, place, start: v.start, end: v.end, minutes: v.minutes, amount_cents: v.amount_cents, expected_on: v.expected_on || (place ? ruleDate(place, v.start.slice(0, 10)) : v.expected_pending ? v.start.slice(0, 10) : ruleDateFor(DEFAULT_RULE, v.start.slice(0, 10))), /* sem local e sem previsão no arquivo: regra padrão declarada na prévia; R9: arquivo que diz "sem previsão" continua sem previsão */ paid_at: v.paid_at || null, note: v.note || '', color_override: isColorKey(v.color_override) ? v.color_override : null /* R7 (prebuild r1 #1) */, series: null, template: null, imported_at: nowIso(), updated_at: nowIso() }; if (v.ext_uid) s.ext_uid = v.ext_uid;
    for (const k of ['start_pending', 'end_pending', 'amount_zero']) if (v[k]) s[k] = true; if (v.expected_pending && !v.expected_on && !place) s.expected_pending = true; return s; });
  S.shifts.push(...made); const ids = new Set(made.map(s => s.id));
  const replacedBefore = []; if (replace) for (const c of conf) { const ex = byId(c.existingId); if (!ex) continue; replacedBefore.push([ex, JSON.stringify(ex)]); applyConflict(ex, { ...c.incoming, place: map[c.incoming.place] || c.incoming.place }, nowIso()); }
  const parts = [made.length ? pl(made.length, 'plantão importado', 'plantões importados') : '', replacedBefore.length ? pl(replacedBefore.length, 'plantão atualizado', 'plantões atualizados') : '', createdPlaces.length ? pl(createdPlaces.length, 'local criado', 'locais criados') : ''].filter(Boolean);
  S.toast = { msg: parts.join(' · ') + '.', undo: () => { S.shifts = S.shifts.filter(s => !ids.has(s.id)); for (const [ex, before] of replacedBefore) Object.assign(ex, JSON.parse(before)); for (const id of createdPlaces) delete S.places[id]; } };
  const first = (made.length ? made.map(s => day(s)) : replacedBefore.map(([ex]) => day(ex))).sort()[0]; S.imp = null; S.month = first.slice(0, 7); S.sel = first; persist(); go('#/calendario/' + first); return true;
}
function restoreBackup(data) {
  if (v8Active()) return restoreUnion(data); /* V8: nunca substitui a base compartilhada */
  const undo = { places: Object.values(S.places), templates: S.templates, series: S.series, shifts: [...S.shifts, ...S.trash], meta: { ...S.meta, restore_undo: null } };
  const d = JSON.parse(JSON.stringify(data));
  S.places = Object.fromEntries(d.places.map(p => [p.id, p])); S.templates = d.templates; S.series = d.series; S.shifts = d.shifts.filter(s => !s.deleted_at); S.trash = d.shifts.filter(s => !!s.deleted_at);
  S.meta = { ...META_DEFAULT(), ...S.meta, sample_loaded: d.shifts.some(s => s.sample), restore_undo: undo };
  S.imp = null; S.toast = { msg: `Backup restaurado: ${pl(S.shifts.length, 'plantão', 'plantões')}.`, btn: { label: 'Desfazer', act: 'restore-undo' } };
  S.month = TODAY.slice(0, 7); S.sel = TODAY; const c = persist(true); go('#/calendario'); return c;
}
function undoRestore() {
  const u = S.meta.restore_undo; if (!u) return;
  S.places = Object.fromEntries(u.places.map(p => [p.id, p])); S.templates = u.templates; S.series = u.series; S.shifts = u.shifts.filter(s => !s.deleted_at); S.trash = u.shifts.filter(s => !!s.deleted_at); S.meta = { ...u.meta, restore_undo: null };
  S.toast = { msg: 'Restauração desfeita.' }; persist(); go('#/calendario');
}
async function download(name, text, type) {
  const blob = new Blob([text], { type }); const file = new File([blob], name, { type });
  if (!Q.get('noshare') && navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return 'share'; } catch (e) { if (e.name === 'AbortError') return 'cancel'; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); return 'download';
}
const data4 = () => ({ places: Object.values(S.places), templates: S.templates, series: S.series, shifts: S.shifts });
async function doExport(kind) {
  const stamp = TODAY; let r;
  if (kind === 'csv') r = await download(`meus-plantoes-escala-${stamp}.csv`, '﻿' + csvExport(data4()), 'text/csv;charset=utf-8');
  else if (kind === 'ganhos') r = await download(`meus-plantoes-ganhos-${stamp}.csv`, '﻿' + csvExportGanhos(data4(), TODAY), 'text/csv;charset=utf-8');
  else if (kind === 'ics') r = await download(`meus-plantoes-agenda-${stamp}.ics`, icsExport(data4(), new Date(), { values: false }), 'text/calendar;charset=utf-8');
  else if (kind === 'icsv') r = await download(`meus-plantoes-agenda-valores-${stamp}.ics`, icsExport(data4(), new Date(), { values: true }), 'text/calendar;charset=utf-8');
  if (r !== 'cancel') { S.toast = { msg: { csv: 'Planilha da escala exportada.', ganhos: 'Planilha com ganhos exportada.', ics: 'Agenda sem valores exportada — abra no Calendário.', icsv: 'Agenda com valores exportada — abra no Calendário.' }[kind] }; renderToast(); }
}
async function doBackup() {
  const all = { places: Object.values(S.places), templates: S.templates, series: S.series, shifts: [...S.shifts, ...S.trash] };
  const b = await backupMake(all, APP_VERSION); const r = await download(`meus-plantoes-backup-${TODAY}.json`, JSON.stringify(b, null, 1), 'application/json');
  if (r !== 'cancel') { S.meta.last_backup_at = nowIso(); S.meta.last_backup_sha256 = b.sha256; S.toast = { msg: `Backup salvo: ${b.counts.shifts} plantões.` }; persist(); render(false); }
}
function loadSampleScript() { return new Promise((res, rej) => { if (window.PLANTOES_SAMPLE) return res(); const s = document.createElement('script'); s.src = 'sample.js'; s.onload = () => res(); s.onerror = () => rej(new Error('dados de exemplo indisponíveis')); document.head.appendChild(s); }); }
async function loadSample() {
  await loadSampleScript(); const D = JSON.parse(JSON.stringify(window.PLANTOES_SAMPLE));
  for (const p of D.places) if (!S.places[p.id]) S.places[p.id] = { ...p, sample: true };
  for (const t of D.templates) if (!tplById(t.id)) S.templates.push({ ...t, sample: true });
  for (const se of D.series) if (!seriesById(se.id)) S.series.push({ ...se, sample: true });
  const have = new Set(S.shifts.map(s => s.id)); for (const s of D.shifts) if (!have.has(s.id)) S.shifts.push({ ...s, sample: true });
  S.meta.sample_loaded = true; S.month = D.meta.today.slice(0, 7); S.sel = D.meta.today;
}
function removeSample() {
  for (const [id, p] of Object.entries(S.places)) if (p.sample) delete S.places[id];
  S.templates = S.templates.filter(t => !t.sample); S.series = S.series.filter(x => !x.sample); S.shifts = S.shifts.filter(s => !s.sample); S.trash = S.trash.filter(s => !s.sample); S.meta.sample_loaded = false;
  S.toast = { msg: 'Dados de exemplo removidos.' };
}

/* ---------- backup no servidor (R5_PLAN rev 6 §D) ----------
   A configuração fica no localStorage (nunca no IndexedDB de dados, nunca num backup); a frase-senha nunca é guardada.
   Uma volta por aparelho (navigator.locks), sempre sobre o estado DURÁVEL (IndexedDB) e só pela regra única de sync.js. */
const SYNC_KEY = 'mp-sync';
const SYNC_URL = (u => u && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(u) ? u : 'https://plantoes-sync.vksos.com')(Q.get('sync')); /* migração de domínios 06-08/11: marca .com; .tech continua permitido na CSP */
const SYNC_T = SYNC_URL.startsWith('http://127.'), SYNC_WIN = (SYNC_T && +Q.get('syncwin')) || WINDOW_S; /* tempos curtos só com servidor de teste em loopback */
const SYNC_TIMEOUT = (SYNC_T && +Q.get('synctimeout')) || 45000, SYNC_RETRY = (SYNC_T && +Q.get('syncretry')) || 30000;
const SYNC_OK = !!(globalThis.crypto?.subtle && globalThis.CompressionStream && navigator.locks);
const syncLoad = () => { try { return JSON.parse(localStorage.getItem(SYNC_KEY) || 'null'); } catch (e) { return null; } };
const syncSave = c => { try { const v = JSON.stringify(c); localStorage.setItem(SYNC_KEY, v); return localStorage.getItem(SYNC_KEY) === v; } catch (e) { return false; } }; /* gravação verificada */
const syncSaveSame = c => syncLoad()?.id === c.id && syncSave(c); /* r8 H-01: a volta nunca recria uma configuração desligada ou trocada */
let syncDirty = false, syncBusy = false, syncTimer = null, syncFails = 0;
function syncKick(delay = 3000) { if (v8Active()) { v8Kick(Math.min(delay, 1500)); return; } /* V8 ativo suspende o envio automático R5; /v1 e o histórico continuam */ if (!SYNC_OK || !syncLoad()) return; syncDirty = true; clearTimeout(syncTimer); syncTimer = setTimeout(syncRun, delay); }
function syncLater(ms) { clearTimeout(syncTimer); syncTimer = setTimeout(() => { syncDirty = true; syncRun(); }, ms); }
async function syncRun() {
  if (syncBusy) return; syncBusy = true; /* laço único: um gatilho durante a volta só marca dirty e a volta se repete */
  try {
    while (syncDirty) {
      syncDirty = false;
      const r = await navigator.locks.request('mp-sync', syncOnce);
      if (!r) break;
      if (r.again) { syncDirty = true; continue; }
      if (r.wait != null) { syncLater(Math.max(500, r.wait * 1000)); break; }
      if (r.retry) { syncLater(SYNC_RETRY * [1, 2, 4, 10][Math.min(syncFails++, 3)]); break; } /* 30 s, 1, 2, 5 min, depois a cada 5 min */
      syncFails = 0;
    }
  } finally { syncBusy = false; }
}
const byIdSort = a => [...a].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)); /* etiqueta independe da ordem de gravação */
async function syncOnce() {
  const cfg = syncLoad(); if (!cfg) return null; /* relido sob o lock: duas abas compartilham o mesmo pending */
  if (!db || !committer || committer.state !== 'saved') return { retry: true, error: 'local' }; /* nunca envia com gravação pendente ou em erro */
  let r;
  try {
    const raw = await readAll(db), b = await backupMake({ places: byIdSort(raw.places), templates: byIdSort(raw.templates), series: byIdSort(raw.series), shifts: byIdSort(raw.shifts) }, APP_VERSION);
    const snap = { tag: await tagOf(cfg.tagkey, b.sha256), seal: () => seal(cfg.key, b) };
    S.syncSt = { state: 'sending' }; syncPaint();
    r = await syncStep(cfg, snap, syncClient(cfg.url, cfg.id, cfg.token, { timeoutMs: SYNC_TIMEOUT }), syncSaveSame, { windowS: SYNC_WIN });
  } catch (e) { r = { retry: true, error: e.type === 'offline' ? 'offline' : 'server' }; }
  const needCode = st => ['enroll_bad', 'need_enroll'].includes(st?.error), before = needCode(S.syncSt);
  S.syncSt = { state: r.done ? 'ok' : r.wait != null ? 'wait' : r.again ? 'sending' : r.retry ? 'retry' : 'error', error: r.error, first: !!cfg.pending && cfg.pending.tag === null };
  if (S.view === 'data' && before !== needCode(S.syncSt)) render(false); else syncPaint(); /* o campo do código aparece/some com o estado */
  return r;
}
const SYNC_MSG = { offline: 'Sem conexão — envia sozinho ao voltar', server: 'Servidor indisponível — tenta de novo sozinho', rate: 'Servidor ocupado — tenta de novo sozinho', local: 'Aguardando a gravação no aparelho',
  too_large: 'Grande demais para o servidor — use o backup em arquivo', enroll_bad: 'Código de cadastro incorreto', need_enroll: 'Falta o código de cadastro', vault_gone: 'O servidor não tem mais este backup — desligue e ative de novo',
  persist: 'Não foi possível guardar o estado do backup neste aparelho', vault_limit: 'O servidor atingiu o limite de backups', auth: 'O servidor recusou a frase-senha' };
function syncStatus() {
  const c = syncLoad(), st = S.syncSt || {};
  if (st.state === 'sending') return ['Conferindo com o servidor…', ''];
  if (st.state === 'wait') return [st.first ? 'Preparando o primeiro envio…' : 'Conferindo o último envio…', ''];
  if (st.state === 'retry' || st.state === 'error') return [SYNC_MSG[st.error] || 'Erro no backup do servidor', 'late'];
  if (c?.last_ok_at) return [`Salvo · versão ${c.last_version} · ${dm(c.last_ok_at.slice(0, 10))} ${new Date(c.last_ok_at).toTimeString().slice(0, 5)}`, 'ok'];
  return [c?.pending ? 'Preparando o primeiro envio…' : 'Aguardando o primeiro envio', ''];
}
function syncPaint() { const el = document.getElementById('sync-state'); if (el) { const [t, k] = syncStatus(); el.className = 'v wrap ' + k; el.textContent = t; } }
function viewSyncGroup() {
  const head = '<div class="ghead">Backup no servidor</div>', c = syncLoad(), f = S.syncForm;
  if (!SYNC_OK) return `${head}<div class="group"><div class="cell"><span class="k">Indisponível neste navegador</span></div></div>`;
  if (c) {
    const [t, k] = syncStatus(), vs = S.syncVersions, needCode = ['enroll_bad', 'need_enroll'].includes(S.syncSt?.error);
    return `${head}<div class="group">
      <div class="cell"><span class="k">Situação</span><span class="v wrap ${k}" id="sync-state" role="status">${esc(t)}</span></div>${needCode ? '</div>' : ''}
      ${needCode ? `<form id="sf" class="group" novalidate><label class="cell plain"><input id="sync-code" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Código de cadastro do servidor" aria-label="Código de cadastro do servidor"></label><button class="cell accent" type="submit">Enviar com este código</button></form><div class="group">` : ''}
      <button class="cell accent" data-act="sync-now">Enviar agora</button>
      <button class="cell" data-act="sync-versions"><span class="k">Restaurar do servidor</span><span class="v">${ic('chev', 16, 2)}</span></button>
      ${vs ? (vs.error ? `<div class="cell"><span class="k">Versões</span><span class="v late wrap">${esc(vs.error)}</span></div>` : vs.list.map(v => `<button class="cell" data-act="sync-version" data-id="${v.version}"><span class="k">Versão ${v.version}</span><span class="v num">${dmy(v.saved_at.slice(0, 10))} ${new Date(v.saved_at).toTimeString().slice(0, 5)} ${ic('chev', 16, 2)}</span></button>`).join('')) : ''}
      <button class="cell danger" data-act="sync-off">Desligar neste aparelho</button></div>
      <p class="gfoot">Cópia cifrada no aparelho com a sua frase-senha, enviada sozinha a cada alteração. O servidor guarda as versões anteriores (as 30 mais novas e uma por dia por 90 dias).</p>`;
  }
  if (!f) return `${head}<div class="group"><button class="cell accent" data-act="sync-start">Ativar backup no servidor</button></div>
    <p class="gfoot">Uma cópia cifrada dos seus plantões fica no seu servidor e volta para qualquer aparelho com a mesma frase-senha.</p>`;
  if (f.step === 'busy') return `${head}<div class="group"><div class="cell"><span class="k">${esc(f.msg || 'Preparando…')}</span></div></div>`;
  if (f.step === 'empty') return `${head}<div class="group"><div class="cell"><span class="k" style="flex:1 1 auto;white-space:normal">Nenhum backup encontrado com essa frase-senha. Se você já tinha backup, confira a frase.</span></div>
    <button class="cell accent" data-act="sync-new">Começar backup novo</button><button class="cell" data-act="sync-other">Tentar outra frase</button><button class="cell" data-act="sync-cancel">Cancelar</button></div>`;
  if (f.step === 'exists') return `${head}<div class="group"><div class="cell"><span class="k" style="flex:1 1 auto;white-space:normal">Há um backup no servidor de ${dmy(f.latest.saved_at.slice(0, 10))} ${new Date(f.latest.saved_at).toTimeString().slice(0, 5)}.</span></div>
    <button class="cell accent" data-act="sync-restore-latest">Restaurar neste aparelho</button>${S.shifts.length || Object.keys(S.places).length ? '<button class="cell" data-act="sync-push">Enviar o deste aparelho como versão nova</button>' : ''}<button class="cell" data-act="sync-cancel">Cancelar</button></div>
    <p class="gfoot">${S.shifts.length ? 'Enviar o deste aparelho não apaga o do servidor: ele fica no histórico de versões.' : 'Este aparelho está vazio: restaure para continuar.'}</p>`;
  return `${head}<form id="sf" class="group" novalidate>${f.step === 'code'
    ? `<label class="cell plain"><input id="sync-code" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Código de cadastro do servidor" aria-label="Código de cadastro do servidor"></label>`
    : `<label class="cell plain"><input id="sync-p1" type="password" autocomplete="new-password" placeholder="Frase-senha (mínimo 12 caracteres)" aria-label="Frase-senha"></label>
       <label class="cell plain"><input id="sync-p2" type="password" autocomplete="new-password" placeholder="Repita a frase-senha" aria-label="Repita a frase-senha"></label>`}
    <button class="cell accent" type="submit">${f.step === 'code' ? 'Ativar' : 'Continuar'}</button><button class="cell" type="button" data-act="sync-cancel">Cancelar</button></form>
    ${f.err ? `<p class="gfoot late" role="alert">${esc(f.err)}</p>` : ''}
    <p class="gfoot">${f.step === 'code' ? 'O código aparece no terminal do servidor quando ele é instalado. Só é pedido ao criar o backup.' : 'Sem a frase-senha ninguém recupera os dados — nem o servidor. Guarde-a no app Senhas.'}</p>`;
}
const syncBusyForm = msg => { S.syncForm = { ...S.syncForm, step: 'busy', msg }; render(false); };
async function syncSubmit() {
  const f = S.syncForm;
  const live = syncLoad();
  if (live && !f) { /* backup já ligado: redigitar o código de cadastro */
    const code = (document.getElementById('sync-code')?.value || '').trim(); if (!code) return;
    live.enroll = code; if (!syncSave(live)) { S.syncSt = { state: 'error', error: 'persist' }; render(false); return; }
    S.syncSt = { state: 'sending' }; render(false); syncKick(0); return;
  }
  if (!f) return;
  if (f.step === 'code') {
    const code = (document.getElementById('sync-code')?.value || '').trim();
    if (!code) { S.syncForm = { ...f, err: 'Digite o código de cadastro.' }; render(false); return; }
    return syncActivate(f.keys, { enroll: code });
  }
  const p1 = document.getElementById('sync-p1')?.value || '', p2 = document.getElementById('sync-p2')?.value || '';
  if (p1.normalize('NFC').trim().length < 12) { S.syncForm = { step: 'pass', err: 'A frase-senha precisa de pelo menos 12 caracteres.' }; render(false); return; }
  if (p1 !== p2) { S.syncForm = { step: 'pass', err: 'As duas frases não são iguais.' }; render(false); return; }
  syncBusyForm('Preparando… (alguns segundos)');
  try {
    const keys = { url: SYNC_URL, ...(await deriveKeys(p1)) }, r = await syncClient(keys.url, keys.id, keys.token, { timeoutMs: SYNC_TIMEOUT }).meta();
    if (r.status === 200) S.syncForm = { step: 'exists', keys, latest: r.body };
    else if (r.status === 404) S.syncForm = S.shifts.length || Object.keys(S.places).length ? { step: 'code', keys } : { step: 'empty', keys };
    else S.syncForm = { step: 'pass', err: `O servidor respondeu ${r.status}. Tente de novo mais tarde.` };
  } catch (e) { S.syncForm = { step: 'pass', err: e.type === 'offline' ? 'Sem conexão com o servidor. Tente de novo com internet.' : String(e.message || e) }; }
  render(false);
}
/* ativar = criar a configuração com espera de um prazo antes do 1º envio (um PUT de configuração anterior ainda em voo morre antes) */
async function syncActivate(keys, { enroll = null, created = false } = {}) {
  try {
    const r = await syncClient(keys.url, keys.id, keys.token, { timeoutMs: SYNC_TIMEOUT }).meta();
    if (typeof r.body?.now !== 'number') throw new Error(`o servidor respondeu ${r.status}`);
    const cfg = { url: keys.url, id: keys.id, token: keys.token, key: keys.key, tagkey: keys.tagkey, pending: { tag: null, not_after: r.body.now + SYNC_WIN }, created: created || r.status === 200, enroll, last_ok_at: null, last_version: null };
    if (!syncSave(cfg)) throw new Error(SYNC_MSG.persist);
    S.syncForm = null; S.syncSt = { state: 'wait', first: true }; if (!S.toast) S.toast = { msg: 'Backup no servidor ativado.' };
    syncKick(0);
  } catch (e) { S.syncForm = { ...(S.syncForm || {}), step: enroll ? 'code' : 'pass', keys, err: e.type === 'offline' ? 'Sem conexão com o servidor.' : String(e.message || e) }; }
  if (S.view === 'data') render(false); else renderToast();
}
/* restaurar: decifra → backupVerify → a tela de restauração existente; ativação (se vier do fluxo de ativar) só depois de confirmar */
async function syncRestore(keys, n) {
  const fromActivation = !syncLoad();
  if (fromActivation) syncBusyForm('Baixando o backup…');
  try {
    const api = syncClient(keys.url, keys.id, keys.token, { timeoutMs: SYNC_TIMEOUT }), r = n == null ? await api.latest() : await api.version(n);
    if (r.status !== 200) throw new Error(`o servidor respondeu ${r.status}`);
    const obj = await openBlob(keys.key, r.body.blob), pv = await backupVerify(obj);
    S.imp = { kind: 'backup', name: `servidor · versão ${r.body.version}`, preview: pv, raw: obj, syncKeys: fromActivation ? keys : null };
    S.syncVersions = null; if (fromActivation) S.syncForm = null;
    go('#/importar');
  } catch (e) {
    const msg = e.type === 'offline' ? 'Sem conexão com o servidor.' : String(e.message || e);
    if (fromActivation) { S.syncForm = { ...S.syncForm, step: 'exists', err: msg }; render(false); } else { S.toast = { msg: 'Não foi possível restaurar: ' + msg }; renderToast(); }
  }
}
async function syncListVersions() {
  const c = syncLoad(); if (!c) return;
  try { const r = await syncClient(c.url, c.id, c.token, { timeoutMs: SYNC_TIMEOUT }).versions(); S.syncVersions = r.status === 200 ? { list: r.body.versions } : { error: r.status === 404 ? 'Nenhuma versão no servidor ainda.' : `O servidor respondeu ${r.status}.` }; }
  catch (e) { S.syncVersions = { error: 'Sem conexão com o servidor.' }; }
  render(false);
}

/* ---------- roteamento e render ---------- */
const $app = document.getElementById('app');
const TAB = { cal: 'cal', detail: 'cal', form: null, series: 'aj', serieslist: 'aj', pay: 'pay', settings: 'aj', places: 'aj', pform: 'aj', templates: 'aj', tform: 'aj', trash: 'aj', data: 'aj', import: null, privacy: 'aj' };
function parseHash() { let h = (location.hash || '').replace(/^#\/?/, ''); return h.includes('/') ? h.split('/') : h.split('~'); }
function route() {
  const [r = 'calendario', a, b] = parseHash();
  if (!['local', 'novo', 'editar'].includes(r)) S.formKeep = null; /* o formulário guardado só sobrevive à ida e volta do cadastro de local */
  if (!S.keep) S.toast = S.toast?.kind === 'save' ? S.toast : null; S.keep = false; S.sheet = null;
  switch (r) {
    case 'plantao': S.view = 'detail'; S.id = a; break;
    case 'novo': S.view = 'form'; S.form = S.formKeep && !S.formKeep.editId ? S.formKeep : newForm(isDateKey(a || '') ? a : S.sel, b); S.formKeep = null; break;
    case 'editar': { const s = byId(a); S.view = s ? 'form' : 'cal'; if (s) S.form = S.formKeep?.editId === a ? S.formKeep : formFrom(s); S.formKeep = null; break; }
    case 'serie': S.view = 'series'; S.seriesId = a; break;
    case 'recorrencias': S.view = 'serieslist'; break;
    case 'pagamentos': S.view = 'pay'; break;
    case 'ajustes': S.view = 'settings'; break;
    case 'locais': S.view = 'places'; break;
    case 'local': S.view = 'pform'; S.pform = a === 'novo' || !S.places[a] ? newPlaceForm() : placeForm(S.places[a]); break;
    case 'modelos': S.view = 'templates'; break;
    case 'modelo': S.view = 'tform'; S.tform = a === 'novo' || !tplById(a) ? newTplForm() : tplForm(tplById(a)); break;
    case 'lixeira': S.view = 'trash'; break;
    case 'dados': S.view = 'data'; break;
    case 'importar': S.view = 'import'; break;
    case 'privacidade': S.view = 'privacy'; break;
    case 'sincronizacao': S.view = 'sync2'; S.v8rev = null; v8LoadDevices(); break;
    default: S.view = 'cal'; if (isDateKey(a || '')) { S.sel = a; S.month = a.slice(0, 7); } if (b === 'siglas' || b === 'pontos') S.calMode = b;
  }
  render(true);
}
function go(h) { if (location.hash === h) route(); else { S.keep = true; location.hash = h; } }
const VIEWS = { detail: () => viewDetail(S.id), form: viewForm, series: viewSeries, serieslist: viewSeriesList, pay: viewPay, settings: viewSettings, places: viewPlaces, pform: viewPlaceForm, templates: viewTemplates, tform: viewTplForm, trash: viewTrash, data: viewData, import: viewImport, privacy: viewPrivacy, sync2: viewSync2, cal: viewCal };
function render(scrollTop) {
  if (fingers.size) { renderPending = true; return; } renderPending = false; toastPending = false; /* R9: nunca troca o DOM sob um dedo */
  const v = S.view;
  $app.innerHTML = (VIEWS[v] || viewCal)();
  document.body.className = (['form', 'series', 'serieslist', 'settings', 'places', 'pform', 'templates', 'tform', 'data', 'import', 'privacy', 'detail', 'pay', 'sync2'].includes(v) ? 'grouped ' : '') + (['form', 'pform', 'tform', 'import'].includes(v) || S.sheet ? 'noframe ' : '') + `view-${v} `; /* R7: detalhes e pagamentos em cards sobre o fundo agrupado */
  const t = TAB[v], tab = (id, href, icon, label) => `<a href="${href}"${t === id ? ' aria-current="page"' : ''}>${ic(icon, 24)}<span>${label}</span></a>`;
  document.getElementById('tabs').innerHTML = tab('cal', '#/calendario', 'cal', 'Calendário') + tab('pay', '#/pagamentos', 'wallet', 'Pagamentos') + tab('aj', '#/ajustes', 'gear', 'Ajustes');
  renderToast();
  if (scrollTop) window.scrollTo(0, 0);
  if (S.sheet) document.getElementById('sc-start')?.focus(); /* M1: foco entra na folha de escopo */
  if (v === 'import') document.querySelector('#app h1')?.focus(); /* M2: a prévia é anunciada */
  if (S.flash) { const li = document.querySelector(`li[data-shift="${CSS.escape(S.flash)}"]`); S.flash = null; if (li) { li.classList.add('flash'); setTimeout(() => li.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }), 60); } }
  if (S.pulse) { S.pulse = false; window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }); document.querySelector('.day.today')?.classList.add('pulse'); }
}
function renderToast() { if (fingers.size) { toastPending = true; return; } toastPending = false; const t = S.toast; document.getElementById('toast').innerHTML = t ? `<div class="toast${t.undo && t.btn ? ' two' : ''}"><span>${t.msg}</span>${t.undo ? '<button data-act="undo">Desfazer</button>' : ''}${t.btn ? `<button class="act2" data-act="${t.btn.act}">${esc(t.btn.label)}</button>` : ''}<button data-act="toastx" aria-label="Fechar">${ic('x', 16, 2.2)}</button></div>` : ''; }

/* F02: trocar de mês preservando o dia selecionado quando ele existe no destino (senão o último dia válido) */
function shiftMonth(n, animate) {
  const ym = addMonths(S.month + '-01', n).slice(0, 7), [y, m] = ym.split('-').map(Number), d = +S.sel.slice(8, 10);
  S.month = ym; S.sel = `${ym}-${pad(Math.min(d, dim(y, m)))}`; S.slide = animate ? n : 0;
}
/* R9 (§11) — paginação real da grade ([data-calswipe], zona separada das linhas da lista): esquerda = próximo mês, direita = anterior.
   Durante o gesto a grade acompanha o dedo 1:1 e os meses vizinhos entram ao lado como painéis INERTES (span, aria-hidden, sem data-act): o DOM em repouso
   é o de sempre. Ao soltar além do limiar o mês novo é desenhado na hora (estado e DOM síncronos — gestos seguidos não esperam nada) JÁ na posição do dedo,
   com o mês antigo de volta como painel inerte, e os dois deslizam até o encaixe (FLIP). Abaixo do limiar ou cancelado, volta ao lugar.
   calGen: cada animação tem a sua geração; limpeza de uma animação antiga nunca mexe na seguinte (pré-build r1 #6). prefers-reduced-motion: troca direta. */
let cg = null, calGen = 0;
function monthCells(ym) { const [y, m] = ym.split('-').map(Number), ws = S.meta.week_start ? 1 : 0, lead = (dow(ym + '-01') - ws + 7) % 7, cells = []; for (let i = lead; i > 0; i--) cells.push(addDays(ym + '-01', -i)); for (let d = 1; d <= dim(y, m); d++) cells.push(`${ym}-${pad(d)}`); while (cells.length < 42) cells.push(addDays(cells[cells.length - 1], 1)); return cells; }
const monthSel = (n) => { const ym = addMonths(S.month + '-01', n).slice(0, 7), [y, m] = ym.split('-').map(Number); return [ym, `${ym}-${pad(Math.min(+S.sel.slice(8, 10), dim(y, m)))}`]; };
function addGhost(z, ym, sel, off) {
  const g = z.querySelector('.grid:not(.ghost)'); if (!g) return;
  z.insertAdjacentHTML('beforeend', `<div class="grid ghost${S.calMode === 'siglas' ? ' siglas' : ''}" aria-hidden="true">${monthCells(ym).map(k => dayCell(k, k.startsWith(ym), sel).replace(/^<button class="(day[^"]*)"[^>]*>/, '<span class="$1">').replace(/<\/button>$/, '</span>')).join('')}</div>`);
  const el = z.lastElementChild; el.style.cssText = `left:${g.offsetLeft}px;width:${g.offsetWidth}px;top:${g.offsetTop}px;--off:${off}px`;
}
function calClean(z) { calGen++; if (!z) return; z.classList.remove('drag', 'snap'); z.style.removeProperty('--cx'); for (const g of z.querySelectorAll('.ghost')) g.remove(); }
function calSnap(z) { const gen = ++calGen; z.classList.remove('drag'); void z.offsetWidth; z.classList.add('snap'); z.style.setProperty('--cx', '0px'); const done = () => { if (gen === calGen) calClean(z); }; z.addEventListener('transitionend', done, { once: true }); setTimeout(done, 420); }
document.addEventListener('pointerdown', e => {
  if (!e.isPrimary || e.button > 0) return; const z = e.target.closest('[data-calswipe]'); if (!z || e.target.closest('li[data-shift]')) return;
  if (z.classList.contains('snap')) calClean(z); /* gesto seguido: a animação anterior termina já */
  cg = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, on: false, z, w: z.clientWidth };
});
document.addEventListener('pointermove', e => {
  const g = cg; if (!g || e.pointerId !== g.id) return; const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
  if (!g.on) {
    if (Math.abs(dx) <= 10 || Math.abs(dx) <= Math.abs(dy)) { if (Math.abs(dy) > 10) cg = null; return; }
    g.on = true; g.z.classList.add('drag'); try { g.z.setPointerCapture(e.pointerId); } catch (_) { }
    if (!reduced()) { addGhost(g.z, ...monthSel(-1), -g.w); addGhost(g.z, ...monthSel(1), g.w); }
  }
  g.dx = dx; if (!reduced()) g.z.style.setProperty('--cx', Math.max(-g.w, Math.min(g.w, dx)) + 'px');
});
function endCal(e, cancel) {
  const g = cg; if (!g || e.pointerId !== g.id) return; cg = null; if (!g.on) return;
  eat(null, g.id);
  if (cancel || Math.abs(g.dx) < 60) { if (reduced()) calClean(g.z); else calSnap(g.z); return; }
  const n = g.dx < 0 ? 1 : -1, from = Math.max(-g.w, Math.min(g.w, g.dx)), old = [S.month, S.sel];
  calClean(g.z); shiftMonth(n, false); render(false);
  const z = document.querySelector('[data-calswipe]'); if (!z || reduced()) return;
  z.classList.add('drag'); z.style.setProperty('--cx', (from + n * g.w) + 'px'); addGhost(z, old[0], old[1], -n * g.w); calSnap(z);
}
document.addEventListener('pointerup', e => endCal(e, false));
document.addEventListener('pointercancel', e => endCal(e, true));

/* ---------- ações ---------- */
function payShift(s, date) { const prev = s.paid_at; s.paid_at = date; s.updated_at = nowIso(); S.toast = { msg: `${esc(s.title)}: ${isExpense(s) ? 'pago' : 'recebido'} em ${dm(date)}.`, undo: () => { s.paid_at = prev; } }; }
function unpayShift(s) { const prev = s.paid_at; s.paid_at = null; s.updated_at = nowIso(); S.toast = { msg: `${isExpense(s) ? 'Pagamento' : 'Recebimento'} de ${dm(prev)} desfeito.`, undo: () => { s.paid_at = prev; } }; }
/* R9: só se recebe ou paga valor conhecido e diferente de zero; senão o caminho é completar o plantão */
const canSettle = s => amountKnown(s) && s.amount_cents !== 0;
function needValue(s) { closeOv(false); S.toast = { msg: `${esc(s.title)}: ${s.amount_zero ? 'sem valor a receber.' : 'informe o valor antes de marcar.'}`, ...(s.amount_zero ? {} : { btn: { label: 'Completar', act: 'complete' } }) }; S.completeId = s.id; render(false); return true; }
/* horário, valor e marcas de um plantão no formato do modelo de série (tpl) ou da exceção de uma data (overrides[k]) */
function tplBits(s, withAmount) { const o = { start: t0(s), end: t1(s) }, sp = diffDays(day(s), endDay(s)); if (s.start_pending) o.start_pending = true; if (s.end_pending) o.end_pending = true; else if (sp !== legacySpan(t0(s), t1(s))) o.end_days = sp; if (withAmount) { o.amount_cents = s.amount_cents; if (s.amount_zero) o.amount_zero = true; if (s.expected_pending) o.expected_pending = true; } return o; }
const NO_PERSIST = new Set(['complete', 'fdur', 'fkind', 'tkind', 'notice-x', 'imp-mode', 'week', 'day', 'today', 'pmonth', 'nmonth', 'open', 'more', 'edit', 'menu-close', 'delete', 'delete-cancel', 'pprev', 'pnext', 'cohort', 'filter', 'got', 'late', 'theme', 'calmode', 'tpl', 'fpaid', 'fcolor', 'tcolor', 'gocolor', 'save', 'occ', 'sheetx', 'toastx', 'pick', 'exp', 'backup', 'pcolor', 'pkind', 'parch', 'tarch', 'psave', 'tsave', 'imp-confirm', 'update', 'retry-save', 'sample', 'restore-undo', 'tempty']); /* estes gravam por conta própria (ou não mudam dados) */
const ACT = {
  day(k) { S.sel = k; S.month = k.slice(0, 7); },
  today() { S.pulse = S.sel === TODAY && S.month === TODAY.slice(0, 7); /* R9: já em hoje, o toque dá retorno (topo + destaque) em vez de parecer morto */ S.sel = TODAY; S.month = TODAY.slice(0, 7); },
  pmonth() { shiftMonth(-1, false); }, nmonth() { shiftMonth(1, false); },
  open(id) { go('#/plantao/' + id); return true; },
  pay(id) { const s = byId(id); if (!canSettle(s)) return needValue(s); payShift(s, TODAY); return done(id); },
  complete() { const id = S.completeId; S.completeId = null; S.toast = null; if (id && byId(id)) go('#/editar/' + id); return true; },
  unpay(id) { unpayShift(byId(id)); return done(id); },
  more(id) { openOv(menuSheet(byId(id)), id); return true; },
  edit(id) { closeOv(false); go('#/editar/' + id); return true; },
  'menu-close'() { closeOv(); return true; },
  delete(id) { closeOv(false); openOv(confirmBox(byId(id)), id); return true; },
  'delete-cancel'() { closeOv(); return true; },
  'delete-confirm'(id) { const scope = document.querySelector('[name=scope]:checked')?.value || 'one'; closeOv(false); doDelete(id, scope); return true; },
  pprev() { S.pay = addMonths(S.pay + '-01', -1).slice(0, 7); }, pnext() { S.pay = addMonths(S.pay + '-01', 1).slice(0, 7); },
  cohort(v) { S.cohort = v; }, filter(v) { S.filter = S.filter === v && v !== 'all' ? 'all' : v; }, got() { S.showGot = !S.showGot; },
  theme(v) { lsSet('mp-theme', v); applyTheme(); },
  'notice-x'() { lsSet(NOTICE_KEY, TODAY); S.toast = { msg: `Lembrete dispensado por ${NOTICE_DAYS} dias. O estado do backup fica em Ajustes.` }; },
  calmode(v) { S.calMode = v; lsSet('mp-cal', v); },
  week(v) { S.meta.week_start = +v; persist(); },
  tpl(id) { const f = readForm(), t = tplById(id); Object.assign(f, { tpl: id, title: t.title, place: t.place, ...tplTimes(t), amount: amtTxt(t), kind: t.amount_cents < 0 ? 'out' : 'in', expOverride: false, color: t.color_override || '' }); syncEnd(f); },
  fkind(k) { const f = readForm(); f.kind = k === 'out' ? 'out' : 'in'; },
  /* atalho de duração: término = início + N h (sem início, usa o padrão e o mostra no campo para conferência) */
  fdur(m) { const f = readForm(); if (!isTimeHM(f.start)) f.start = DEFAULT_START; const tot = toMin(f.start) + +m; f.end = `${pad(Math.floor(tot / 60) % 24)}:${pad(tot % 60)}`; f.end_days = Math.floor(tot / 1440); f.endAuto = true; syncEnd(f); }, /* A receber | A pagar: o teclado decimal do iPhone não tem sinal de menos */
  tkind(k) { const f = readTplForm(); f.kind = k === 'out' ? 'out' : 'in'; },
  fpaid() { const f = readForm(); f.paid = !f.paid; },
  /* R7: cor individual — atualização no lugar (F01: nenhum campo se perde) */
  fcolor(k) { const f = readForm(); f.color = k || ''; refreshForm(); document.querySelector(`#f-colors [data-id="${k || ''}"]`)?.focus({ preventScroll: true }); return true; },
  tcolor(k) { const f = readTplForm(); f.color = k || ''; refreshSwatches('tf-colors', f); const ft = document.getElementById('tf-colorfoot'); if (ft) ft.innerHTML = colorFoot(f); document.querySelector(`#tf-colors [data-id="${k || ''}"]`)?.focus({ preventScroll: true }); return true; },
  gocolor() { document.getElementById('f-colors')?.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); document.querySelector('#f-colors [aria-pressed="true"]')?.focus({ preventScroll: true }); return true; },
  late() { S.showLate = !S.showLate; },
  save() { submitForm(); return true; },
  occ(k) { S.sheet = { occ: k, scope: 'one' }; }, sheetx() { const k = S.sheet?.occ; S.sheet = null; render(false); document.querySelector(`[data-act="occ"][data-id="${k}"]`)?.focus({ preventScroll: true }); return true; },
  restore(k) { const se = seriesById(S.seriesId), tp = tplOf(se), o = se.overrides[k] || {};
    const tt = o.start ? { ...tp, ...o } : tp; /* exceção de horário da data, se houver; senão o modelo da série */
    const s = { id: uid(), template: se.template || null, series: se.id, ...mkShift({ title: tp.title, place: tp.place, ...tplTimes(tt), amount: amtTxt(tp), kind: tp.amount_cents < 0 ? 'out' : 'in', note: '', paid: false, date: k, expected: tp.place || tp.expected_pending ? '' : addDays(k, tp.exp_days || 0), color: o.color_override || tp.color_override || '' }, k, false), updated_at: nowIso() }; /* R7: restaurar leva a cor da exceção ou a semente da série */
    S.shifts.push(s); se.exdates = se.exdates.filter(x => x !== k); S.toast = { msg: `${dm(k)} restaurado na série.`, undo: () => { S.shifts = S.shifts.filter(x => x !== s); se.exdates.push(k); } }; },
  applyScope() { const se = seriesById(S.seriesId), { occ } = S.sheet, scope = document.querySelector('[name=scope]:checked')?.value || 'one';
    const st = document.getElementById('sc-start').value, en = document.getElementById('sc-end').value, at = document.getElementById('sc-amt').value.trim(), c = at ? parseCents(at) : 0;
    if ((st && !isTimeHM(st)) || (en && !isTimeHM(en)) || c == null) { S.toast = { msg: 'Confira início, fim e valor.' }; return; } /* R9: vazio = não alterar; início = fim = 24 h */
    const formOf = x => { const sp = diffDays(day(x), endDay(x)), untouched = (st || t0(x)) === t0(x) && (en || t1(x)) === t1(x), keep = !x.end_pending && (untouched || sp >= 2); /* E2E R9-13: mudar só o valor encurtava 36 h para 12 h */ return { title: x.title, place: x.place, start: st || (x.start_pending ? '' : t0(x)), end: en || (x.end_pending ? '' : t1(x)), end_days: keep ? diffDays(day(x), endDay(x)) : null, endDate: '', amount: at || (amountKnown(x) ? (isExpense(x) ? '-' : '') + amtTxt(x) : ''), kind: 'in', note: x.note, paid: false, expOverride: true, expected: x.expected_pending ? '' : x.expected_on, date: day(x) }; };
    const cs = document.getElementById('sc-color')?.value || ''; /* R7: '' mantém a cor de cada um; 'inherit' = do local/neutra; chave = cor nova */
    const colorFor = x => cs === '' ? (x.color_override || '') : cs === 'inherit' ? '' : cs;
    const keepException = x => scope !== 'one' && cs !== '' && !!se.overrides[day(x)]?.color_override; /* exceções de cor são preservadas nos escopos amplos (AC-R7-06) */
    const targets = scopeTargets(S.shifts, se.id, occ, scope); const snap = JSON.stringify({ t: targets, o: se.overrides, tpl: se.tpl });
    for (const x of targets) Object.assign(assignShift(x, mkShift({ ...formOf(x), color: keepException(x) ? (x.color_override || '') : colorFor(x) }, day(x), true)), { paid_at: null, updated_at: nowIso() });
    const x0 = targets[0]; /* referência para a exceção da data e para o modelo da série */
    if (scope === 'one') { const o = { ...(se.overrides[occ] || {}), ...(x0 ? tplBits(x0, false) : {}) }; if (x0) for (const k of ['start_pending', 'end_pending', 'end_days']) if (!(k in tplBits(x0, false))) delete o[k]; const k1 = colorFor(targets[0] || {}); if (k1) o.color_override = k1; else if (cs === 'inherit') delete o.color_override; se.overrides = { ...se.overrides, [occ]: o }; }
    if (scope === 'all' && x0) { const t = { ...tplOf(se) }; for (const k of ['start_pending', 'end_pending', 'end_days', 'amount_zero']) delete t[k]; se.tpl = { ...t, ...tplBits(x0, true), ...(cs === '' ? {} : { color_override: cs === 'inherit' ? null : cs }) }; se.overrides = Object.fromEntries(Object.entries(se.overrides).filter(([, o]) => o.color_override).map(([k, o]) => [k, { ...tplBits(x0, false), color_override: o.color_override }])); } /* R7: "Toda a série" zera exceções de horário, mas mantém as de cor (prebuild r1 #3) */
    S.sheet = null; S.toast = { msg: `${pl(targets.length, 'plantão alterado', 'plantões alterados')}. Recebidos intactos.`, undo: () => { const o = JSON.parse(snap); o.t.forEach(b => Object.assign(byId(b.id), b)); se.overrides = o.o; se.tpl = o.tpl; } };
    persist(); render(false); document.querySelector(`[data-act="occ"][data-id="${occ}"]`)?.focus({ preventScroll: true }); return true; },
  undo() { S.toast.undo(); S.toast = null; }, toastx() { S.toast = null; },
  /* locais e modelos */
  pcolor(k) { readPlaceForm().color = k; }, pkind(k) { readPlaceForm().kind = k; }, parch() { const f = readPlaceForm(); f.archived = !f.archived; }, psave() { savePlace(); return true; },
  tarch() { const f = readTplForm(); f.archived = !f.archived; }, tsave() { saveTpl(); return true; },
  /* lixeira */
  trestore(id) { const i = S.trash.findIndex(s => s.id === id); if (i < 0) return; const [s] = S.trash.splice(i, 1); delete s.deleted_at; s.updated_at = nowIso(); S.shifts.push(s); const se = s.series && seriesById(s.series); if (se) se.exdates = se.exdates.filter(x => x !== day(s));
    S.toast = { msg: `${esc(s.title)} de ${dm(day(s))} restaurado.`, undo: () => { S.shifts = S.shifts.filter(x => x !== s); s.deleted_at = nowIso(); S.trash.push(s); if (se) se.exdates.push(day(s)); } }; },
  tempty() { openOv(`<div class="dim"></div><div class="alert" role="alertdialog" aria-modal="true" aria-labelledby="al-t" aria-describedby="al-d"><h2 id="al-t">Esvaziar a lixeira?</h2><p id="al-d">${pl(S.trash.length, 'plantão será apagado', 'plantões serão apagados')} de vez. Não dá para desfazer.</p><div class="aacts"><button data-act="delete-cancel" data-first>Cancelar</button><button class="danger" data-act="tempty-confirm">Apagar</button></div></div>`, null); return true; },
  'tempty-confirm'() { closeOv(false); S.trash = []; S.toast = { msg: 'Lixeira esvaziada.' }; persist(); render(false); return true; },
  /* dados */
  pick(kind) { const inp = document.getElementById('pick-' + kind); if (inp) { inp.value = ''; inp.click(); } return true; },
  exp(kind) { doExport(kind); return true; },
  backup() { doBackup(); return true; },
  'imp-confirm'() { return confirmImport(); }, 'imp-mode'(v) { if (S.imp) S.imp.mode = v; },
  'restore-undo'() { closeOv(false); undoRestore(); return true; },
  sample() { if (v8Active()) { S.toast = { msg: 'Dados de exemplo ficam indisponíveis com a sincronização ativada.' }; renderToast(); return; } loadSample().then(() => { S.toast = { msg: 'Dados de exemplo carregados (fictícios). Remova em Ajustes › Seus dados.' }; persist(); go('#/calendario/' + S.sel); }).catch(e => { S.toast = { msg: String(e.message || e) }; renderToast(); }); return true; },
  'sample-remove'() { removeSample(); persist(); },
  'retry-save'() { committer?.retry(); return true; },
  update() { applyUpdate(); return true; },
  /* backup no servidor (R5) */
  'v8-start'() { S.v8form = { step: 'pass' }; render(false); document.getElementById('v8-p1')?.focus(); return true; },
  'v8-cancel'() { S.v8form = null; render(false); return true; },
  'v8-submit'() { v8Submit(); return true; },
  'v8-confirm'() { v8Confirm(); return true; },
  'v8-now'() { S.v8st = { ...S.v8st, state: 'syncing' }; v8Paint(); v8Kick(0); return true; },
  'v8-allowdel'() { v8Engine.allowDeletes(); v8Kick(0); return true; },
  'v8-off'() { navigator.locks.request('mp-sync2', async () => { const off = { ...(await v8Io.load()).state, active: false }; await v8Io.write([{ key: 's:state', value: off }], []); S.v8 = off; }).then(() => { S.v8st = null; S.toast = { msg: 'Sincronização pausada neste aparelho. Os dados continuam aqui.' }; render(false); }); return true; }, /* sob o lock: um ciclo em curso termina antes */
  'v8-resume'() { navigator.locks.request('mp-sync2', async () => { const on = { ...(await v8Io.load()).state, active: true }; await v8Io.write([{ key: 's:state', value: on }], []); S.v8 = on; }).then(() => { render(false); v8LoadDevices(); v8Kick(0); }); return true; },
  'v8-recover-local'() { readSync(db).then(r => v8Recover(r.find(x => x.key === 's:premigration').value)); return true; },
  'v8-snap'(id) { v8Api().snapshotGet(id).then(async r => v8Recover(await openSnapshot(S.v8.key, r.body.blob))).catch(() => { S.toast = { msg: 'Não foi possível abrir esta cópia.' }; renderToast(); }); return true; },
  'v8-revoke'(id) { if (S.v8rev !== id) { S.v8rev = id; render(false); return true; } S.v8rev = null; v8Api().revoke(id).then(() => { v8LoadDevices(); v8Kick(0); }).catch(() => { S.toast = { msg: 'Sem conexão: não foi possível desconectar agora.' }; renderToast(); }); return true; },
  'v8-keep'(id) { delete S.conflicts[id]; persist(); render(false); return true; },
  'v8-other'(id) { const c = S.conflicts[id]; if (!c) return true; const r = c.coll === 'places' ? S.places[c.rec] : c.coll === 'templates' ? tplById(c.rec) : shiftsAll().find(x => x.id === c.rec);
    if (r) { if (UNIT_FIELDS[c.field]) { for (const k of UNIT_FIELDS[c.field]) { if (c.other?.[k] == null) { if (k in r && !['start', 'end', 'minutes', 'amount_cents', 'expected_on'].includes(k)) delete r[k]; } else r[k] = c.other[k]; } } /* R9: unidade inteira (valor + marca), nunca metade */ else if (c.other == null) delete r[c.field]; else r[c.field] = c.other; r.updated_at = nowIso(); } delete S.conflicts[id]; persist(); render(false); return true; },
  'sync-start'() { S.syncForm = { step: 'pass' }; render(false); document.getElementById('sync-p1')?.focus(); return true; },
  'sync-cancel'() { S.syncForm = null; S.syncVersions = null; render(false); return true; },
  'sync-submit'() { syncSubmit(); return true; },
  'sync-new'() { S.syncForm = { ...S.syncForm, step: 'code' }; render(false); document.getElementById('sync-code')?.focus(); return true; },
  'sync-other'() { S.syncForm = { step: 'pass' }; render(false); return true; },
  'sync-restore-latest'() { syncRestore(S.syncForm.keys, null); return true; },
  'sync-push'() { syncActivate(S.syncForm.keys, { created: true }); return true; },
  'sync-now'() { syncKick(0); return true; },
  'sync-versions'() { syncListVersions(); return true; },
  'sync-version'(n) { const c = syncLoad(); if (c) syncRestore(c, +n); return true; },
  'sync-off'() { /* r8 H-01: pelo mesmo lock da volta — um envio em curso termina antes; depois dele nenhuma gravação recria a configuração */
    S.syncSt = { state: 'sending' }; syncPaint();
    navigator.locks.request('mp-sync', () => { try { localStorage.removeItem(SYNC_KEY); } catch (e) { } }).then(() => { clearTimeout(syncTimer); S.syncSt = null; S.syncVersions = null; S.toast = { msg: 'Backup no servidor desligado neste aparelho. Os dados no servidor continuam.' }; render(false); });
    return true; },
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (b.tagName === 'A') e.preventDefault();
  const act = b.dataset.act, r = ACT[act]?.(b.dataset.id);
  if (!NO_PERSIST.has(act) && r !== true) persist();
  if (r) return;
  render(false);
  (document.querySelector(`[data-act="${act}"]${b.dataset.id ? `[data-id="${b.dataset.id}"]` : ''}`) || $app).focus({ preventScroll: true });
});
document.addEventListener('submit', e => { if (e.target.id === 'sf') { e.preventDefault(); syncSubmit(); return; } if (['f', 'pf', 'tf'].includes(e.target.id)) { e.preventDefault(); if (e.target.id === 'f') submitForm(); else if (e.target.id === 'pf') savePlace(); else saveTpl(); } });
document.addEventListener('input', e => {
  const t = e.target; if (t.form?.id === 'f') { readForm(); refreshForm(); } /* R9: todos os campos reagem enquanto o valor muda (roda de hora, data), não só ao sair do campo — o que muda de tamanho muda antes do próximo toque */
  else if (t.id === 'pq') { const q = normTitleQ(t.value.trim()); let n = 0; for (const el of document.querySelectorAll('#places-list .cell')) { const show = !q || (el.dataset.q || '').includes(q); el.hidden = !show; if (show) n++; } const em = document.getElementById('pq-empty'); if (em) em.hidden = n > 0; } /* R7: busca de locais no lugar, sem re-render */
  else if (t.form?.id === 'pf' || t.form?.id === 'tf') { const f = t.form.id === 'pf' ? readPlaceForm() : readTplForm(); const e2 = t.form.id === 'pf' ? validatePlace(f) : validateTpl(f), ok = !Object.keys(e2).length; const st = document.getElementById(t.form.id + '-status'); if (st) { st.className = 'status-line ' + (ok ? 'ok' : 'warn'); st.innerHTML = ok ? `${ic('check', 14, 2.4)} Pronto para salvar` : `${ic('alert', 14, 2.2)} Falta: ${Object.values(e2).join(', ')}`; } const sv = document.querySelector('[data-act="psave"],[data-act="tsave"]'); if (sv) { if (ok) sv.removeAttribute('aria-disabled'); else sv.setAttribute('aria-disabled', 'true'); } if ((t.value || '').trim()) t.removeAttribute('aria-invalid'); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.form?.id === 'f' && t.name === 'place' && t.value === '__new') { t.value = ''; S.formKeep = readForm(); go('#/local/novo'); return; } /* R6: criar local sem perder o formulário em andamento */
  if (t.form?.id === 'f') { readForm(); refreshForm(); } /* F01: atualização no lugar — nenhum re-render durante a edição */
  else if (t.form?.id === 'pf') readPlaceForm(); else if (t.form?.id === 'tf') { const f = readTplForm(); if (t.name === 'place') { const dot = document.getElementById('tf-dot'); if (dot) { dot.style.cssText = placeSq(t.value); dot.classList.toggle('neutral', !(t.value && S.places[t.value])); } refreshSwatches('tf-colors', f); const ft = document.getElementById('tf-colorfoot'); if (ft) ft.innerHTML = colorFoot(f); } }
  else if (t.name === 'scope' && S.sheet) S.sheet.scope = t.value;
  else if (t.dataset.paid) { if (isDateKey(t.value)) { byId(t.dataset.paid).paid_at = t.value; persist(); render(false); } }
  else if (t.id?.startsWith('pick-') && t.files?.[0]) readPicked(t.id.slice(5), t.files[0]);
});
window.addEventListener('hashchange', route);

/* ---------- G2.1 · I1 reveal direto: gesto, ação em 1 toque, menu "⋯" e confirmação de exclusão ---------- */
const AW = 96;
let drag = null, swallow = null, openY = 0, OV = null;
const eat = (li, pid) => { swallow = { li, pid, t: performance.now() }; };
const openLi = () => document.querySelector('li[data-shift]:not([data-open=""])');
function setX(li, x) { li.style.setProperty('--x', x + 'px'); if (x) li.dataset.side = x < 0 ? 'pay' : 'delete'; }
function settle(li, side) {
  li.dataset.open = side; li.classList.remove('drag'); setX(li, side === 'pay' ? -AW : side ? AW : 0); clearTimeout(li._t);
  if (side) { li.classList.add('sl'); openY = scrollY; return; }
  li._t = setTimeout(() => { if (!li.dataset.open && !li.classList.contains('drag')) { li.classList.remove('sl'); li.style.minHeight = ''; delete li.dataset.side; } }, 220);
}
document.addEventListener('pointerdown', e => {
  if (!e.isPrimary || e.button > 0) return;
  swallow = null; const li = e.target.closest('li[data-shift]'), o = openLi();
  if (o && o !== li) { settle(o, ''); eat(null, e.pointerId); }
  const sf = e.target.closest('[data-swipe]');
  if (!sf || e.clientX <= 16) return;
  const op = sf.parentElement.dataset.open;
  drag = { li: sf.parentElement, sf, t: e.target, id: e.pointerId, x0: e.clientX, y0: e.clientY, base: op === 'pay' ? -AW : op ? AW : 0, x: 0, on: false };
});
document.addEventListener('pointermove', e => {
  const d = drag; if (!d || e.pointerId !== d.id) return;
  const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
  if (!d.on) {
    if (Math.abs(dx) <= 10 || Math.abs(dx) <= Math.abs(dy)) { if (Math.abs(dy) > 10) drag = null; return; }
    d.on = true; try { d.sf.setPointerCapture(e.pointerId); } catch (_) { }
    const o = openLi(); if (o && o !== d.li) settle(o, '');
    clearTimeout(d.li._t); d.li.style.minHeight = d.li.offsetHeight + 'px'; d.li.classList.add('drag', 'sl');
  }
  let x = d.base + dx; const ax = Math.abs(x);
  if (ax > AW) x = Math.sign(x) * (AW + Math.min(40, (ax - AW) * 0.3));
  d.x = x; setX(d.li, x);
});
document.addEventListener('touchmove', e => { if ((drag && drag.on) || (cg && cg.on)) e.preventDefault(); }, { passive: false });
function endDrag(e, cancel) {
  const d = drag; if (!d || e.pointerId !== d.id) return; drag = null;
  if (d.on) { eat(d.li, d.id); const x = cancel ? 0 : d.x; settle(d.li, x <= -0.4 * AW ? 'pay' : x >= 0.4 * AW ? 'delete' : ''); }
  else if (!cancel && d.li.dataset.open && !d.t.closest('[data-act="more"]')) { settle(d.li, ''); eat(d.li, d.id); }
}
document.addEventListener('pointerup', e => endDrag(e, false));
document.addEventListener('pointercancel', e => endDrag(e, true));
document.addEventListener('click', e => {
  const sw = swallow; swallow = null;
  if (!sw || !e.detail) return;
  const samePointer = e.pointerId === undefined || e.pointerId === -1 || e.pointerId === sw.pid, recent = performance.now() - sw.t < 700, sameLine = !sw.li || sw.li.contains(e.target);
  if (samePointer && recent && sameLine) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
addEventListener('scroll', () => { const o = openLi(); if (o && !drag && Math.abs(scrollY - openY) > 10) settle(o, ''); }, { passive: true });

const $ov = document.querySelector('.app').appendChild(document.createElement('div'));
const trigger = id => (id && id !== 'x' ? document.querySelector(`li[data-shift="${CSS.escape(id)}"] [data-act="more"]`) || document.querySelector(`.del[data-id="${CSS.escape(id)}"]`) : null) || document.querySelector('[data-act="tempty"]');
function openOv(html, id) { const o = openLi(); if (o) settle(o, ''); $ov.innerHTML = html; OV = id ?? 'x'; $ov.querySelector('[data-first]').focus(); }
function closeOv(focus = true) { if (OV === null) return; const id = OV; $ov.innerHTML = ''; OV = null; if (focus) trigger(id)?.focus({ preventScroll: true }); }
function done(id) { closeOv(false); persist(); render(false); (document.querySelector(`[data-act="more"][data-id="${CSS.escape(id)}"], .sw[data-id="${CSS.escape(id)}"]`) || $app).focus({ preventScroll: true }); return true; }
function menuSheet(s) {
  const it = (a, icon, t, c = '') => `<button class="mi${c}" data-act="${a}" data-id="${s.id}"${a === 'edit' ? ' data-first' : ''}>${ic(icon, 22, 2)}<span>${t}</span></button>`;
  return `<div class="dim"></div><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="mn-t" data-menu="${s.id}">
    <div class="handle"></div><h2 id="mn-t">${esc(s.title)}</h2><p class="sub num">${s.place ? esc(P(s.place).short) + ' · ' : ''}${dm(day(s))} · ${money(s)}</p>
    <div class="mlist">${it('edit', 'edit', pendingOf(s).length ? 'Completar' : 'Editar')}${s.paid_at ? it('unpay', 'undo', isExpense(s) ? 'Desfazer pagamento' : 'Desfazer recebimento') : s.amount_zero ? '' : it('pay', 'check', isExpense(s) ? 'Paguei' : 'Recebi')}${it('delete', 'trash', 'Apagar', ' danger')}</div>
    <button class="btn" data-act="menu-close">Cancelar</button></div>`;
}
function confirmBox(s) {
  const se = s.series && seriesById(s.series); const fol = se ? scopeTargets(S.shifts, se.id, day(s), 'following').length : 0, all = se ? scopeTargets(S.shifts, se.id, day(s), 'all').length : 0;
  const opt = (v, t, d, chk) => `<label class="radio"><input type="radio" name="scope" value="${v}"${chk ? ' checked' : ''}><span><b>${t}</b><small>${d}</small></span></label>`;
  return `<div class="dim"></div><div class="alert" role="alertdialog" aria-modal="true" aria-labelledby="al-t" aria-describedby="al-d">
    <h2 id="al-t">Apagar ${esc(s.title)} de ${dm(day(s))}?</h2>
    <p id="al-d">${esc(P(s.place).name)} · ${money(s)}. Vai para a lixeira: sai do calendário e dos totais${se ? `; é uma ocorrência da série “${esc(se.label)}”` : ''}.</p>
    ${se ? opt('one', 'Só este plantão', `${dm(day(s))} · o resto da série não muda.`, true) + opt('following', 'Este e os próximos', `${pl(fol, 'plantão não recebido', 'plantões não recebidos')} a partir de ${dm(day(s))}.`) + opt('all', 'Toda a série', `${pl(all, 'plantão não recebido', 'plantões não recebidos')}; recebidos ficam.`) : ''}
    <div class="aacts"><button data-act="delete-cancel" data-first>Cancelar</button><button class="danger" data-act="delete-confirm" data-id="${s.id}">Apagar</button></div></div>`;
}
/* apagar = lixeira (reversível); escopos de série só sobre não recebidos (SPEC §2.6) */
function doDelete(id, scope = 'one') {
  const s = byId(id); if (!s) return; const se = s.series && seriesById(s.series), k = day(s);
  const targets = se && scope !== 'one' ? scopeTargets(S.shifts, se.id, k, scope) : [s]; /* H1: nos escopos de série, recebidos nunca entram — nem a ocorrência tocada */
  if (!targets.length) { S.toast = { msg: 'Nada a apagar: plantões recebidos não entram nos escopos de série.' }; renderToast(); return; }
  const now = nowIso(), ids = new Set(targets.map(x => x.id)), removed = S.shifts.filter(x => ids.has(x.id));
  S.shifts = S.shifts.filter(x => !ids.has(x.id)); for (const x of removed) { x.deleted_at = now; S.trash.push(x); if (se) se.exdates.push(day(x)); }
  S.toast = { msg: removed.length > 1 ? `${pl(removed.length, 'plantão apagado', 'plantões apagados')} (na lixeira).` : `${esc(s.title)} de ${dm(k)} apagado.`, undo: () => { for (const x of removed) { delete x.deleted_at; S.trash = S.trash.filter(y => y !== x); S.shifts.push(x); if (se) se.exdates = se.exdates.filter(d => d !== day(x)); } } };
  persist();
  const f = () => (document.querySelector('ul.rows [data-act="open"]') || document.getElementById('dh') || $app).focus({ preventScroll: true });
  if (S.view === 'detail') { addEventListener('hashchange', f, { once: true }); go('#/calendario/' + k); } else { render(false); f(); }
}
$ov.addEventListener('click', e => { if (e.target.classList.contains('dim')) closeOv(); });
const focusable = el => !el.disabled && !el.hidden && el.getAttribute('aria-hidden') !== 'true' && el.getClientRects().length > 0; /* M2 */
document.addEventListener('keydown', e => {
  if (OV === null && S?.sheet) { /* M1: a folha de escopo se comporta como os outros diálogos */
    if (e.key === 'Escape') { e.preventDefault(); ACT.sheetx(); return; }
    if (e.key === 'Tab') { const f = [...document.querySelectorAll('.sheet button, .sheet input')].filter(focusable), i = f.indexOf(document.activeElement); if (f.length) { e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); } }
    return;
  }
  if (OV === null) { if (e.key === 'Escape' && openLi()) settle(openLi(), ''); return; }
  if (e.key === 'Escape') { e.preventDefault(); closeOv(); }
  else if (e.key === 'Tab') { const f = [...$ov.querySelectorAll('button, input')].filter(focusable), i = f.indexOf(document.activeElement); e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); }
});
window.addEventListener('hashchange', () => closeOv(false));

/* ---------- service worker: aviso de versão nova; ativação só sem gravação pendente ---------- */
let swReg = null;
async function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:' || Q.get('nosw')) return;
  try {
    swReg = await navigator.serviceWorker.register('./sw.js');
    const watch = w => { if (!w) return; w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) { S.update = w; S.toast = { msg: 'Nova versão pronta.', btn: { label: 'Atualizar', act: 'update' } }; renderToast(); } }); };
    if (swReg.waiting && navigator.serviceWorker.controller) { S.update = swReg.waiting; S.toast = { msg: 'Nova versão pronta.', btn: { label: 'Atualizar', act: 'update' } }; renderToast(); }
    swReg.addEventListener('updatefound', () => watch(swReg.installing)); watch(swReg.installing);
    const hadController = !!navigator.serviceWorker.controller; let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { /* H3/N1: aba já controlada recarrega quando um worker novo assume — mas nunca com gravação pendente ou em erro (recarrega assim que estiver 'saved'); a 1ª instalação não recarrega */
      if (!(updateApplied || hadController) || reloading) return; reloading = true;
      const tryReload = () => { if (!committer || committer.state === 'saved') return location.reload(); if (committer.state === 'error') { S.reloadWhenSaved = true; S.toast = { kind: 'save', msg: 'Nova versão ativa, mas há dados não gravados. Resolva para concluir.', btn: { label: 'Tentar de novo', act: 'retry-save' } }; renderToast(); return; } committer.whenIdle().then(tryReload); };
      tryReload(); });
  } catch (e) { console.warn('service worker indisponível:', e); }
}
let updateApplied = false;
async function applyUpdate() { const w = S.update || swReg?.waiting; if (!w) return; await committer?.whenIdle(); if (committer?.state === 'error') { S.toast = { msg: 'Há dados não gravados; resolva antes de atualizar.', btn: { label: 'Tentar de novo', act: 'retry-save' } }; renderToast(); return; } updateApplied = true; w.postMessage('SKIP_WAITING'); }


/* ---------- V8: sincronização entre aparelhos ---------- */
const V8_POLL = (SYNC_T && +Q.get('syncpoll')) || 20000;
const FIELD_NAMES = { valor: 'Valor', 'previsão': 'Previsão', amount_zero: 'Valor zero', title: 'Título', place: 'Local', 'horário': 'Horário', start: 'Início', end: 'Fim', amount_cents: 'Valor', expected_on: 'Previsão', paid_at: 'Recebido em', note: 'Observação', deleted_at: 'Excluído', color_override: 'Cor', name: 'Nome', short: 'Sigla', rule: 'Regra', archived: 'Arquivado', color: 'Cor' };
const shiftsAll = () => [...S.shifts, ...S.trash], byIdMap = a => Object.fromEntries(a.map(x => [x.id, x]));
const v8Active = () => !!S?.v8?.active && !!S.v8.token;
const fillObj = (t, v) => { for (const k of Object.keys(t)) delete t[k]; return Object.assign(t, v); };
function v8AddConflict(c) { const id = uid(); const r = c.coll === 'shifts' ? shiftsAll().find(x => x.id === c.rec) : null, t = r ? `${r.title} · ${dm(day(r))}` : c.rec; S.conflicts[id] = { id, at: nowIso(), label: t, ...c }; }
const v8AddConflicts = (cfs, coll, rec) => { if (v8Active()) cfs.forEach(c => v8AddConflict({ ...c, coll, rec })); };
const v8Host = {
  view: () => JSON.parse(JSON.stringify({ places: S.places, templates: byIdMap(S.templates), series: byIdMap(S.series), shifts: byIdMap(shiftsAll()), conflicts: S.conflicts })),
  put(coll, id, rec) {
    if (coll === 'conflicts') { if (rec) S.conflicts[id] = rec; else delete S.conflicts[id]; return; }
    if (coll === 'places') { if (!rec) delete S.places[id]; else if (S.places[id]) fillObj(S.places[id], rec); else S.places[id] = rec; return; }
    if (coll === 'templates' || coll === 'series') { const a = S[coll], i = a.findIndex(x => x.id === id); if (!rec) { if (i >= 0) a.splice(i, 1); } else if (i >= 0) fillObj(a[i], rec); else a.push(rec); return; }
    const cur = shiftsAll().find(x => x.id === id); S.shifts = S.shifts.filter(x => x.id !== id); S.trash = S.trash.filter(x => x.id !== id);
    if (rec) { const o = cur ? fillObj(cur, rec) : rec; (o.deleted_at ? S.trash : S.shifts).push(o); }
  },
  addConflict: v8AddConflict,
  revive(s) { const se = s?.series && seriesById(s.series); if (se) se.exdates = se.exdates.filter(x => x !== day(s)); },
  commit(patches) {
    S.shifts.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
    if (S.toast?.undo) S.toast = null; if (S.toastPending?.toast?.undo) S.toastPending = null; /* desfazer antigo reverteria o que veio de outro aparelho */
    const c = committer.commit(snapshot, patches);
    if (!['form', 'pform', 'tform', 'import'].includes(S.view) && !S.sheet && !S.keep) render(false); /* nunca redesenha por cima de edição aberta */
    return c.done;
  },
  durable: () => committer.state === 'saved',
  async refresh() { if (committer.state !== 'saved') return; const m = await readMeta(db); if ((m?.rev || 0) > committer.savedRev) await reloadFromOtherTab('silent'); },
  validate: () => validateDatasetV8({ places: Object.values(S.places), templates: S.templates, series: S.series, shifts: shiftsAll() }),
  rev: () => committer.rev,
};
const v8Io = {
  async load() { const rows = await readSync(db); return { state: rows.find(r => r.key === 's:state')?.value || null, shadow: new Map(rows.filter(r => r.key.startsWith('s:sh:')).map(r => [r.key.slice(5), r.value])), inflight: rows.filter(r => r.key.startsWith('s:if:')).map(r => r.value) }; },
  write: (puts, dels) => writeSync(db, puts, dels),
};
const v8Api = () => apiClient(SYNC_URL, () => S.v8?.token, { timeoutMs: SYNC_TIMEOUT });
let v8Engine = null, v8Timer = null, v8Busy = false, v8Again = false, v8Fails = 0;
/* dia em que a fila deixou de estar vazia neste aparelho: nasce quando o motor MEDE fila > 0 e some quando mede zero, em qualquer estado (ativo ou em pausa) */
function v8Since(n) { if (n > 0) { if (!isDateKey(lsGet(SINCE_KEY, ''))) lsSet(SINCE_KEY, TODAY); } else if (n === 0) { try { localStorage.removeItem(SINCE_KEY); } catch (e) { } } }
function v8Paint() {
  const st = S.v8st || {}, el = document.getElementById('v8-state'), sm = document.getElementById('v8-small'), [t, k] = v8Status();
  v8Since(st.pending);
  if (st.state && st.state !== 'syncing') S.v8fail = ['waiting', 'error', 'paused', 'confirm'].includes(st.state); /* R9 (E2E S05): uma nova tentativa ("syncing") não apaga nem acende o aviso crítico; só o desfecho muda */
  if (el) { el.className = 'v wrap ' + k; el.textContent = t; } if (sm) sm.textContent = t;
  document.getElementById('tabs')?.classList.toggle('v8-attn', v8Active() && ['waiting', 'error', 'confirm', 'paused'].includes(st.state) || Object.keys(S.conflicts || {}).length > 0);
  if (v8Active() && S.view === 'cal' && !S.sheet && (backupNotice() !== '') !== !!document.querySelector('.notice')) render(false); /* R9 (E2E S05): o aviso crítico aparece e some quando o estado da sincronização muda, sem esperar outra navegação */
}
const V8_ERR = { verify: 'A conferência encontrou diferenças', revoked: 'Este aparelho foi desconectado', unauthorized: 'Acesso recusado', invalid: 'Dados recebidos inconsistentes', quarantine: 'Registro ilegível recebido' };
function v8Status() {
  const st = S.v8st || {}, n = st.pending || 0, last = st.last_ok || S.v8?.last_ok;
  if (st.state === 'syncing') return ['Sincronizando…', ''];
  if (st.state === 'waiting') return [`Aguardando conexão${n ? ` · ${pl(n, 'alteração', 'alterações')}` : ''}`, 'late'];
  if (st.state === 'paused') return ['Sincronização pausada', 'late'];
  if (st.state === 'confirm') return [`Confirme a exclusão de ${st.deletes} registros`, 'late'];
  if (st.state === 'error') return [`Erro de sincronização: ${V8_ERR[st.reason] || st.reason}`, 'late'];
  if (!v8Active()) return [S.v8?.revoked ? 'Aparelho desconectado' : 'Desligada', ''];
  return [last ? `Sincronizado · ${dm(last.slice(0, 10))} ${new Date(last).toTimeString().slice(0, 5)}` : 'Sincronizado', 'ok'];
}
function v8Kick(delay = 1500) { if (!v8Engine || !v8Active()) return; clearTimeout(v8Timer); v8Timer = setTimeout(v8Run, delay); }
async function v8Run() {
  if (v8Busy) { v8Again = true; return; } v8Busy = true;
  try {
    const r = await navigator.locks.request('mp-sync2', () => v8Engine.cycle());
    if (r?.net || r?.later) { v8Fails++; v8Kick(SYNC_T ? 300 : [5, 15, 30, 60][Math.min(v8Fails - 1, 3)] * 1000); } else v8Fails = 0;
    if (r?.auth) { S.v8 = (await v8Io.load()).state; if (S.view === 'sync2') render(false); }
  } catch (e) { console.warn('sincronização falhou', e); S.v8st = { state: 'error', reason: String(e.message || e).slice(0, 80) }; v8Paint(); }
  finally { v8Busy = false; if (v8Again) { v8Again = false; v8Kick(0); } }
}
function v8Boot(raw) {
  S.conflicts = S.conflicts || {}; S.v8 = (raw.meta || []).find(m => m.key === 's:state')?.value || null;
  try { v8Engine = createEngine({ host: v8Host, io: v8Io, api: v8Api(), on: st => { S.v8st = st; v8Paint(); } }); } catch (e) { console.warn(e); }
  setInterval(() => { if (!document.hidden) v8Kick(0); }, V8_POLL); v8Kick(800);
}
const v8Fail = (err, step = 'pass') => { S.v8form = { ...S.v8form, step, err }; render(false); };
const v8Busyform = msg => { S.v8form = { ...S.v8form, step: 'busy', msg }; render(false); };
async function v8Submit() {
  const f = S.v8form; if (!f) return;
  const v = id => (document.getElementById(id)?.value || '');
  try {
    if (f.step === 'pass') {
      const p1 = v('v8-p1'), name = v('v8-name').trim();
      if (S.meta.sample_loaded) return v8Fail('Remova os dados de exemplo em Seus dados antes de ativar.');
      if (p1.trim().length < 12) return v8Fail('A frase-senha precisa de pelo menos 12 caracteres.');
      if (!name) return v8Fail('Dê um nome a este aparelho.');
      S.v8form = { ...f, p1, name, step: 'busy', msg: 'Conferindo…' }; render(false);
      const st = await v8Api().status(); if (st.status !== 200) throw new Error('servidor');
      if (!st.body.initialized) { S.v8form = { ...S.v8form, step: 'code', err: null }; render(false); return; }
      return v8Enroll(null, st.body.salt);
    }
    if (f.step === 'code') {
      if (v('v8-p2') !== f.p1) return v8Fail('As frases não são iguais.', 'code');
      const code = v('v8-code').trim(); if (!code) return v8Fail('Digite o código de cadastro do servidor.', 'code');
      return v8Enroll(code, newSalt());
    }
  } catch (e) { v8Fail(e.net ? 'Sem conexão com o servidor. Tente de novo com internet.' : 'Não foi possível continuar.', f.step === 'code' ? 'code' : 'pass'); }
}
async function v8Enroll(code, salt) {
  const f = S.v8form;
  try {
    v8Busyform('Protegendo a frase-senha…');
    const keys = await deriveKeysV2(f.p1, salt), old = (await v8Io.load()), device_id = old.state?.device_id || uid2();
    v8Busyform('Registrando este aparelho…');
    const r = await v8Api().enroll({ proof: keys.proof, device_id, name: f.name, ...(code ? { code, salt } : {}) });
    if (r.status !== 200) return v8Fail(r.body.error === 'bad_proof' ? 'Frase-senha diferente da usada nos outros aparelhos.' : r.body.error === 'enroll_required' ? 'Código de cadastro incorreto.' : r.body.error === 'enroll_throttled' ? 'Muitas tentativas. Aguarde uma hora.' : 'O servidor recusou o cadastro.', code ? 'code' : 'pass');
    const state = { active: false, token: r.body.token, key: keys.key, device_id, name: f.name, cursor: 0, epoch: r.body.epoch };
    await v8Io.write([{ key: 's:state', value: state }], [...old.shadow.keys()].map(k => 's:sh:' + k).concat(old.inflight.map(i => 's:if:' + i.op_id)));
    S.v8 = state;
    await committer.whenIdle();
    v8Busyform('Guardando uma cópia antes de mudar qualquer coisa…');
    const copy = { at: nowIso(), places: Object.values(S.places), templates: S.templates, series: S.series, shifts: shiftsAll() };
    await v8Io.write([{ key: 's:premigration', value: copy }], []);
    if (copy.shifts.length || copy.places.length) { const blob = await sealSnapshot(state.key, copy); /* ponytail: cópia inteira até ~7,5 MiB (dezenas de milhares de plantões); acima fica só a cópia local */ if (blob.length < 7.5 * 1024 * 1024) { const s = await v8Api().snapshot(`pré-migração · ${f.name}`, blob); if (s.status !== 201) throw new Error('snapshot'); } }
    await v8Preview();
  } catch (e) { v8Fail(e.net ? 'Sem conexão com o servidor. Nada foi alterado.' : e.auth ? 'Acesso recusado.' : 'Não foi possível preparar a ativação. Nada foi alterado.', code ? 'code' : 'pass'); }
}
async function v8Preview() { v8Busyform('Comparando este aparelho com o servidor…'); const pv = await v8Engine.preview(S.v8); S.v8form = { step: 'preview', pv, name: S.v8form.name }; render(false); }
async function v8Confirm() {
  const f = S.v8form; if (f?.step !== 'preview') return;
  try {
    await committer.whenIdle();
    if (committer.state !== 'saved') return v8Fail('Há dados não gravados neste aparelho. Resolva antes de ativar.', 'preview');
    if (committer.rev !== f.pv.rev) { await v8Preview(); S.v8form.err = 'Seus dados mudaram. Confira a nova comparação.'; render(false); return; } /* prévia presa à revisão */
    const before = v8Host.view(); v8Busyform('Unindo os dados…');
    const st = await v8Engine.union(S.v8, f.pv); S.v8 = st.state; /* verifyPending fica gravado junto da união */
    const moved = v8Engine.untouched(before, f.pv);
    if (moved.length) throw Object.assign(new Error('untouched'), { verify: moved });
    S.v8form = null; S.toast = { msg: 'Dados unidos. Enviando e conferindo.' }; S.v8st = { state: 'syncing' }; render(false); v8LoadDevices(); v8Kick(0); /* só o ciclo publica "sincronizado", depois da conferência */
  } catch (e) {
    const off = { ...S.v8, active: false }; S.v8 = off; await v8Io.write([{ key: 's:state', value: off }], []).catch(() => { });
    S.v8form = { step: 'failed', err: e.verify ? `A conferência encontrou ${e.verify.length} registro(s) diferente(s). Sincronização parada; a cópia anterior está preservada.` : 'A ativação não terminou. Sincronização parada; a cópia anterior está preservada.' }; render(false);
  }
}
async function v8LoadDevices() {
  try { S.v8pre = (await readSync(db)).some(r => r.key === 's:premigration'); } catch (e) { }
  if (v8Active()) { try { const [r, s] = await Promise.all([v8Api().devices(), v8Api().snapshots()]); S.v8dev = r.body; S.v8snaps = s.body.snapshots || []; } catch (e) { S.v8dev = { error: true }; } }
  if (S.view === 'sync2') render(false);
}
/* recuperação das cópias de antes da ativação: com sincronização ligada só acrescenta; pausada, restaura com Desfazer */
function v8Recover(copy) { const d = { places: copy.places, templates: copy.templates, series: copy.series, shifts: copy.shifts }; if (v8Active()) restoreUnion(d); else restoreBackup(d); }
const v8Backups = () => (S.v8pre || S.v8snaps?.length) ? `<div class="ghead">Cópias de antes da ativação</div><div class="group">${S.v8pre ? '<button class="cell" data-act="v8-recover-local">Recuperar a cópia deste aparelho</button>' : ''}${(S.v8snaps || []).map(x => `<button class="cell" data-act="v8-snap" data-id="${x.id}"><span class="k">${esc(x.label)}</span><span class="v num">${dm(x.at.slice(0, 10))}</span></button>`).join('')}</div><p class="gfoot">${v8Active() ? 'Com a sincronização ligada, recuperar só acrescenta o que faltar.' : 'Sincronização pausada: recuperar substitui os dados deste aparelho, com opção de desfazer.'}</p>` : '';
const v8Val = v => v == null ? 'vazio' : typeof v === 'object' ? (v.start ? (v.end_pending ? `${String(v.start).slice(11, 16) || v.start} · término a definir` : `${v.start}–${v.end}`) : 'amount_cents' in v ? (v.amount_cents === 0 ? (v.amount_zero ? 'sem valor' : 'a preencher') : v.amount_cents < 0 ? `a pagar ${brl(-v.amount_cents)}` : brl(v.amount_cents)) : 'expected_on' in v ? (v.expected_pending ? 'sem previsão' : dmy(v.expected_on)) : JSON.stringify(v).slice(0, 40)) : /cents/.test(String(v)) ? v : String(v);
function v8ConflictCell(c) {
  const name = FIELD_NAMES[c.field] || c.field, money = c.field === 'amount_cents', fmt = v => money && v != null ? brl(v) : esc(v8Val(v));
  const body = c.kind === 'received_wins' ? 'Apagado em um aparelho e recebido em outro: ficou como recebido.' : c.kind === 'deleted_edited' ? 'Editado em um aparelho e apagado em outro: ficou na lixeira, com a edição.' : c.kind === 'recreated' ? 'Excluído em um aparelho e alterado em outro: a alteração foi mantida.' : `${esc(name)}: ficou <b>${fmt(c.kept)}</b>; o outro valor era <b>${fmt(c.other)}</b>.`;
  const canUse = c.kind === 'field' && !c.field.includes('.') && (c.coll === 'shifts' || c.coll === 'places' || c.coll === 'templates'); /* v8Val já formata as unidades valor e previsão */
  return `<div class="cell" style="flex-wrap:wrap"><span class="k" style="flex:1 1 100%;white-space:normal"><span class="kt">${esc(c.label || c.rec)}<small>${body}</small></span></span>${canUse ? `<button class="textb" data-act="v8-other" data-id="${c.id}">Usar o outro</button>` : ''}<button class="textb b" data-act="v8-keep" data-id="${c.id}">${canUse ? 'Manter' : 'Entendi'}</button></div>`;
}
function viewSync2() {
  const f = S.v8form, head = `<header class="nav"><div class="l"><a class="circ" href="#/ajustes" aria-label="Voltar">${ic('left')}</a></div><h1>Sincronização</h1><div class="r"></div></header><div class="gl">`, end = '</div>';
  if (f?.step === 'busy') return `${head}<div class="group"><div class="cell"><span class="k">${esc(f.msg)}</span></div></div>${end}`;
  if (f?.step === 'failed') return `${head}<p class="gfoot late" role="alert">${esc(f.err)}</p><div class="group"><button class="cell" data-act="v8-cancel">Fechar</button></div>${end}`;
  if (f?.step === 'preview') {
    const c = f.pv.cmp, row = (k, v, cls = '') => `<div class="cell"><span class="k">${k}</span><span class="v num ${cls}">${v}</span></div>`;
    return `${head}<div class="ghead">Antes de ativar</div><div class="group">${row('Iguais nos dois', c.equal)}${row('Só neste aparelho', c.onlyLocal)}${row('Só no servidor', c.onlyServer)}${row('Diferentes', c.divergent, c.divergent ? 'late' : '')}${row('Possíveis duplicados', c.dupes, c.dupes ? 'late' : '')}</div>
    <div class="ghead">Plantões e valores</div><div class="group">${row('Neste aparelho', `${c.local.count} · ${brl(c.local.cents)}`)}${row('Recebido aqui', brl(c.local.paid))}${row('No servidor', `${c.server.count} · ${brl(c.server.cents)}`)}${row('Recebido no servidor', brl(c.server.paid))}</div>
    ${f.err ? `<p class="gfoot late" role="alert">${esc(f.err)}</p>` : ''}
    <div class="group" style="margin-top:20px"><button class="cell accent" data-act="v8-confirm">Unir e ativar</button><a class="cell" href="#/dados">Exportar um backup antes</a><button class="cell" data-act="v8-cancel">Cancelar</button></div>
    <p class="gfoot">Nada é apagado. O que só existe aqui sobe, o que só existe no servidor desce. Diferenças viram conflitos para você revisar. Possíveis duplicados ficam os dois. Uma cópia de antes já foi guardada.</p>${end}`;
  }
  if (f) return `${head}<div class="group">${f.step === 'code'
    ? `<label class="cell plain"><input id="v8-p2" type="password" autocomplete="new-password" placeholder="Repita a frase-senha" aria-label="Repita a frase-senha"></label><label class="cell plain"><input id="v8-code" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Código de cadastro do servidor" aria-label="Código de cadastro"></label>`
    : `<label class="cell plain"><input id="v8-p1" type="password" autocomplete="current-password" placeholder="Frase-senha" aria-label="Frase-senha"></label><label class="cell plain"><input id="v8-name" type="text" autocomplete="off" maxlength="40" placeholder="Nome deste aparelho" aria-label="Nome deste aparelho" value="${esc(f.name || (/iPhone/.test(navigator.userAgent) ? 'iPhone' : /Mac/.test(navigator.userAgent) ? 'Mac' : 'Computador'))}"></label>`}
    <button class="cell accent" data-act="v8-submit">Continuar</button><button class="cell" data-act="v8-cancel">Cancelar</button></div>
    ${f.err ? `<p class="gfoot late" role="alert">${esc(f.err)}</p>` : ''}
    <p class="gfoot">${f.step === 'code' ? 'Primeira ativação: o código de cadastro aparece no servidor. Ele não será pedido nos próximos aparelhos.' : 'A mesma frase-senha em todos os aparelhos. Ela nunca sai deste aparelho, e sem ela ninguém lê seus dados, nem o servidor.'}</p>${end}`;
  if (!v8Active()) return `${head}<div class="ghead">Seus plantões em todos os aparelhos</div><div class="group">${S.v8?.token && S.v8?.key ? '<button class="cell accent" data-act="v8-resume">Retomar neste aparelho</button>' : `<button class="cell accent" data-act="v8-start">${S.v8?.revoked ? 'Reconectar este aparelho' : 'Ativar neste aparelho'}</button>`}</div>
    <p class="gfoot">Um plantão criado em qualquer aparelho aparece nos outros sozinho. Os dados vão cifrados e continuam disponíveis sem internet.</p>${v8Backups()}${end}`;
  const [t, k] = v8Status(), cf = Object.values(S.conflicts), d = S.v8dev, st = S.v8st || {};
  const devs = !d ? '<div class="cell"><span class="k">Carregando…</span></div>' : d.error ? '<div class="cell"><span class="k">Sem conexão para listar</span></div>' : d.devices.map(x => `<div class="cell"><span class="k"><span class="kt">${esc(x.name)}${x.id === d.you ? ' · este' : ''}<small>${x.revoked_at ? 'desconectado' : x.last_seen ? `visto ${dm(x.last_seen.slice(0, 10))} ${new Date(x.last_seen).toTimeString().slice(0, 5)}` : ''}</small></span></span>${x.revoked_at ? '' : `<button class="textb danger" data-act="v8-revoke" data-id="${x.id}">${S.v8rev === x.id ? 'Confirmar' : 'Desconectar'}</button>`}</div>`).join('');
  return `${head}<div class="ghead">Situação</div><div class="group"><div class="cell"><span class="k">Estado</span><span class="v wrap ${k}" id="v8-state" role="status">${esc(t)}</span></div>
    ${st.state === 'confirm' ? '<button class="cell danger" data-act="v8-allowdel">Confirmar a exclusão em todos os aparelhos</button>' : ''}<button class="cell accent" data-act="v8-now">Sincronizar agora</button></div>
    <p class="gfoot">Sincroniza ao abrir o app, ao voltar para ele e ao recuperar a conexão. No iPhone, com o app fechado, nada é enviado até ele ser aberto.</p>
    ${cf.length ? `<div class="ghead">Conflitos</div><div class="group">${cf.map(v8ConflictCell).join('')}</div>` : ''}
    <div class="ghead">Aparelhos</div><div class="group">${devs}</div>
    <div class="group" style="margin-top:20px"><button class="cell danger" data-act="v8-off">Pausar neste aparelho</button></div>${v8Backups()}${end}`;
}
/* restauração com sincronização ligada: edição local que só acrescenta o que falta; o atual nunca é substituído */
function restoreUnion(d) {
  const snap = JSON.stringify({ places: S.places, templates: S.templates, series: S.series, shifts: S.shifts, trash: S.trash }); let added = 0, kept = 0;
  const addIf = (has, push, r) => { if (r.sample) return; if (has(r.id)) { kept++; return; } push(JSON.parse(JSON.stringify(r))); added++; };
  for (const p of d.places) addIf(id => !!S.places[id], x => { S.places[x.id] = x; }, p);
  for (const t of d.templates) addIf(id => !!tplById(id), x => S.templates.push(x), t);
  for (const se of d.series) addIf(id => !!seriesById(id), x => S.series.push(x), se);
  const all = new Set(shiftsAll().map(s => s.id));
  for (const s of d.shifts) addIf(id => all.has(id), x => (x.deleted_at ? S.trash : S.shifts).push(x), s);
  if (v8Host.validate().length) { const o = JSON.parse(snap); Object.assign(S, o); S.toast = { msg: 'Este backup não combina com os dados atuais; nada foi alterado.' }; S.imp = null; renderToast(); return null; }
  S.shifts.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  S.imp = null; S.toast = { msg: `Backup unido: ${pl(added, 'registro novo', 'registros novos')}, ${pl(kept, 'mantido como está', 'mantidos como estão')}.` };
  const c = persist(); go('#/calendario'); return c;
}

/* ---------- arranque ---------- */
async function boot() {
  let raw = { places: [], templates: [], series: [], shifts: [], meta: [] }, dbError = null;
  try { db = await openDB(); raw = await readAll(db); } catch (e) { dbError = e; }
  hydrate(raw);
  committer = createCommitter((data, expectRev, patches) => db ? writeAll(db, data, expectRev, patches) : Promise.reject(dbError || new Error('banco indisponível')), onSaveState, S.meta.rev || 0); /* expectRev: a revisão gravada precisa ser a que esta aba conhece (duas abas) */ /* B2: revisão durável continua da persistida */
  if (S.meta.schema_version > 2) { S.toast = { kind: 'save', msg: `Estes dados foram gravados por uma versão mais nova do app (esquema ${S.meta.schema_version}). Atualize o app antes de editar.` }; }
  if (dbError) onSaveState({ state: 'error', error: dbError, rev: 0, savedRev: 0 });
  const empty = !raw.shifts.length && !raw.places.length;
  if (empty && Q.get('sample')) { try { await loadSample(); persist(); } catch (e) { console.warn(e); } }
  addEventListener('pagehide', () => committer.flushNow()); document.addEventListener('visibilitychange', () => { if (document.hidden) committer.flushNow(); else { tick(); checkOtherTab(); syncKick(); } }); addEventListener('focus', checkOtherTab);
  addEventListener('online', () => syncKick(1000)); syncKick(1000); /* R5: abertura do app e volta da rede */
  try { S.storage = { supported: !!navigator.storage?.persist, persisted: navigator.storage?.persist ? await navigator.storage.persist() : null }; } catch (e) { S.storage = { supported: true, persisted: null, error: String(e.message || e) }; } /* M5: resultado observável em Seus dados */
  Object.defineProperty(window, '__mp', { enumerable: true, writable: false, configurable: false, value: Object.freeze({
    contract: 'g21-1', today: TODAY, version: APP_VERSION,
    shift: id => { const s = byId(id); return s ? JSON.parse(JSON.stringify(s)) : null; },
    shifts: () => S.shifts.map(s => ({ id: s.id, start: s.start, end: s.end, place: s.place, amount_cents: s.amount_cents, expected_on: s.expected_on, paid_at: s.paid_at, series: s.series })),
    series: id => { const se = seriesById(id); return se ? JSON.parse(JSON.stringify(se)) : null; },
    cohort: (ym, by) => { const c = cohort(ym, by); return { count: c.count, total: c.total, received: c.received, pending: c.pending }; },
    overdue: () => sum(overdue()), selfCheck,
    open: () => document.querySelector('li[data-shift][data-open]:not([data-open=""])')?.dataset.shift || null,
    save: () => ({ state: committer.state, rev: committer.rev, savedRev: committer.savedRev }), sync: () => ({ st: S.syncSt, busy: syncBusy, cfg: (({ key, token, tagkey, ...c }) => c)(syncLoad() || {}) }), sync2: () => ({ active: v8Active(), st: S.v8st || null, conflicts: Object.values(S.conflicts), device: S.v8?.device_id || null }), idle: () => committer.whenIdle(), trash: () => S.trash.map(s => s.id), meta: () => JSON.parse(JSON.stringify(S.meta)),
  }) });
  v8Boot(raw);
  route();
  registerSW();
}
function tick() { swReg?.update().catch(() => { }); /* ao voltar ao app, procura versão nova (PWA no iPhone raramente reinicia do zero) */ if (TODAY_FIXED) return; const t = todayKey(); if (t !== TODAY) { TODAY = t; render(false); } }
setInterval(tick, 60000);
boot().catch(e => { $app.innerHTML = `<p class="empty">Não foi possível abrir o app: ${esc(String(e.message || e))}</p>`; console.error(e); });
