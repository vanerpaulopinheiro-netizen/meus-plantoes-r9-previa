/* core.js — regras puras do Meus Plantões: datas (texto YYYY-MM-DD, aritmética em UTC), dinheiro em centavos inteiros,
   previsão de recebimento, coortes, recorrência, validação do formulário e do conjunto de dados. Sem DOM; testado em node:test.
   Fuso: America/Sao_Paulo sem horário de verão desde 2019 → offset fixo -03:00 (guardado no texto ISO de cada plantão). */
export const TZ = 'America/Sao_Paulo', OFFSET = '-03:00', OFFSET_MIN = -180;

/* ---------- datas ---------- */
export const pad = n => String(n).padStart(2, '0');
export const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const WDL = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const WDS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const cap = s => s[0].toUpperCase() + s.slice(1);
export const utc = k => { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export const addDays = (k, n) => { const d = utc(k); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export function addMonths(k, n, day) { let [y, m, d] = k.split('-').map(Number); m += n - 1; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12 + 1; return `${y}-${pad(m)}-${pad(Math.min(day ?? d, dim(y, m)))}`; }
export const dow = k => utc(k).getUTCDay();
export const diffDays = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
export const dm = k => `${k.slice(8, 10)}/${k.slice(5, 7)}`;
export const dmy = k => `${dm(k)}/${k.slice(0, 4)}`;
export const wdm = k => `${WD[dow(k)]} ${dm(k)}`;
export const monthOf = k => MESES[+k.slice(5, 7) - 1];
export const dayLong = k => `${WDS[dow(k)]}, ${+k.slice(8, 10)} de ${monthOf(k)}`;
export const dayFull = k => `${cap(WDL[dow(k)])}, ${+k.slice(8, 10)} de ${monthOf(k)} de ${k.slice(0, 4)}`;
export const hrs = m => (m % 60 ? `${Math.floor(m / 60)}h${pad(m % 60)}` : `${m / 60} h`);
export const toMin = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
export const pl = (n, s, p) => `${n} ${n === 1 ? s : p}`;
export const sum = list => list.reduce((a, s) => a + s.amount_cents, 0);
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const isDateKey = k => typeof k === 'string' && /^\d{4}-\d\d-\d\d$/.test(k) && addDays(k, 0) === k; /* 2026-02-30 não passa */
export const isTimeHM = t => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
export const isoLocal = (k, hm) => `${k}T${hm}:00${OFFSET}`;
export const isIsoLocal = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d-03:00$/.test(v) && isDateKey(v.slice(0, 10)) && isTimeHM(v.slice(11, 16));
/* hoje no fuso do app (o relógio do aparelho pode estar em outro fuso) */
export function todayKey(now = new Date(), tz = TZ) { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
export const nowIso = (now = new Date()) => now.toISOString();
export const uid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

export const day = s => s.start.slice(0, 10);
export const endDay = s => s.end.slice(0, 10);
export const t0 = s => s.start.slice(11, 16);
export const t1 = s => s.end.slice(11, 16);
export const night = s => endDay(s) > day(s);
export const minutesOf = (start, end) => Math.round((Date.parse(end) - Date.parse(start)) / 60000);

/* ---------- dinheiro ---------- */
export const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const brl = c => BRL.format(c / 100);
export const centsTxt = c => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); /* 1.380,00 */
/* teto de um plantão: R$ 10 milhões em centavos, nos dois sentidos; fora disso (ou não finito, não inteiro) o valor é inválido em todos os caminhos.
   R9: valor negativo = despesa (a pagar). O sinal é sempre explícito: "-" (ou "−") no texto, ou kind 'out' no formulário. */
export const MAX_CENTS = 1e9;
export const safeCents = c => Number.isSafeInteger(c) && Math.abs(c) <= MAX_CENTS ? c : null;
export function parseCents(v) {
  v = String(v ?? '').trim(); const neg = /^[-−]/.test(v); if (neg) v = v.slice(1).trim();
  v = v.replace(/^R\$\s*/, ''); if (!v || !/^[\d.,]+$/.test(v) || v.length > 20) return null;
  v = v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(v) ? v.replace(/\./g, '') : v;
  const n = Number(v); if (!Number.isFinite(n)) return null; const c = safeCents(Math.round(n * 100)); return c == null ? null : neg && c ? -c : c;
}
/* valor decimal com ponto (CSV): "1234.5" → 123450; aceita também vírgula brasileira; nunca devolve não finito/inseguro */
export function parseDecimalCents(v) { v = String(v ?? '').trim(); if (!v || v.length > 20) return null; if (/^-?\d+(\.\d+)?$/.test(v)) return safeCents(Math.round(Number(v) * 100)); return parseCents(v); }
export const decimalTxt = c => (c / 100).toFixed(2);

/* ---------- previsão de recebimento (regra do local) ---------- */
/* R9: paleta por espectro. As dez chaves da R4 (w1…w10) mantêm chave, nome e hex — nada que já está pintado muda. w11…w15 completam o espectro.
   PAL = par claro/escuro de cada chave (fonte única; app.js e codecs.js importam daqui; espelho em design/tokens.json). */
export const LEGACY_PALETTE = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w9', 'w10'];
export const PALETTE = [...LEGACY_PALETTE, 'w11', 'w12', 'w13', 'w14', 'w15'];
export const PAL = { w1: ['#34C759', '#30D158'], w2: ['#2FA4C0', '#40C8E0'], w3: ['#AF52DE', '#BF5AF2'], w4: ['#FF9500', '#FF9F0A'], w5: ['#E0395F', '#FF375F'], w6: ['#007AFF', '#0A84FF'], w7: ['#FFCC00', '#FFD60A'], w8: ['#5856D6', '#5E5CE6'], w9: ['#00C7BE', '#63E6E2'], w10: ['#A2845E', '#AC8E68'], w11: ['#A3281A', '#F53634'], w12: ['#FA5B15', '#FF7E24'], w13: ['#0FBFDA', '#64E6F5'], w14: ['#ED77A1', '#FE6FB0'], w15: ['#4C5366', '#B5BAC7'] };
export const PAL_NAMES = { w1: 'Verde', w2: 'Azul-água', w3: 'Roxo', w4: 'Laranja', w5: 'Rosa', w6: 'Azul', w7: 'Amarelo', w8: 'Índigo', w9: 'Menta', w10: 'Marrom', w11: 'Vermelho', w12: 'Laranja-escuro', w13: 'Ciano', w14: 'Rosa-claro', w15: 'Grafite' };
/* âncoras: uma por família (duas em Neutros), com ΔE00 ≥ 20 entre si nos dois temas (r9/tools/paleta_busca.mjs; teste R9-14). O 1º de cada família é a âncora. */
export const SPECTRUM = [{ name: 'Vermelho', keys: ['w11'] }, { name: 'Laranja', keys: ['w12', 'w4'] }, { name: 'Amarelo', keys: ['w7'] }, { name: 'Verde', keys: ['w1', 'w9'] }, { name: 'Ciano', keys: ['w13', 'w2'] }, { name: 'Azul', keys: ['w6', 'w8'] }, { name: 'Violeta', keys: ['w3'] }, { name: 'Rosa', keys: ['w14', 'w5'] }, { name: 'Neutros', keys: ['w15', 'w10'] }];
/* cor sugerida para local novo: a 1ª âncora ainda sem uso (verde primeiro, como sempre foi) */
export const DEFAULT_COLORS = ['w1', 'w6', 'w3', 'w7', 'w12', 'w13', 'w14', 'w11', 'w10', 'w15'];
/* pares que se confundem em ponto de 6 px (ΔE00 < 20 em algum tema; r9/evidence/paleta-depois.json). Só para AVISAR em Locais — nada é trocado sozinho. */
const CLOSE = new Set(['w9|w13', 'w2|w13', 'w5|w11', 'w2|w9', 'w4|w12', 'w6|w8', 'w5|w14', 'w3|w8', 'w8|w15', 'w4|w7', 'w4|w10']);
export const colorsClose = (a, b) => a === b || CLOSE.has(`${a}|${b}`) || CLOSE.has(`${b}|${a}`);
export const ANCHORS = ['w11', 'w12', 'w7', 'w1', 'w13', 'w6', 'w3', 'w14', 'w10', 'w15'];
export const isColorKey = k => typeof k === 'string' && PALETTE.includes(k);
/* R7: cor efetiva de um plantão (ou modelo) = cor individual válida > cor do local > neutra (null). Modelo materializado: a cor
   exibida vem sempre do próprio registro; `series.tpl.color_override` é só a semente de ocorrências novas/restauradas. */
export function effectiveColor(s, placeOf) { if (isColorKey(s?.color_override)) return s.color_override; const p = s?.place ? placeOf(s.place) : null; return p && isColorKey(p.color) ? p.color : null; }
/* R6 (adendo R1.1): plantão sem local não tem regra — a previsão é a informada pelo usuário, nunca inventada */
export function ruleDateFor(rule, k) { return !rule ? null : rule.kind === 'days_after' ? addDays(k, rule.days) : addMonths(k, 1, rule.day); }
export function ruleTxtFor(rule) { return !rule ? 'sem local: previsão informada por você' : rule.kind === 'days_after' ? `${rule.days} dias após o plantão` : `dia ${rule.day} do mês seguinte`; }
export const validRule = r => !!r && (r.kind === 'days_after' ? Number.isInteger(r.days) && r.days >= 0 && r.days <= 366 : r.kind === 'fixed_day' && Number.isInteger(r.day) && r.day >= 1 && r.day <= 31);

/* ---------- coortes (regras normativas do SPEC §2) ---------- */
/* 'worked' = mês do início · 'cash' = mês da previsão (expected_on) · 'paid' = mês do recebimento. Cada plantão entra uma vez por recorte. */
export function cohortOf(shifts, ym, by) {
  /* R9: sem previsão (expected_pending) o plantão não "cai" em mês nenhum até ser pago; aí vale a data do pagamento */
  /* auditoria MP-R9-002: zero confirmado não "cai" nem é "recebido" em mês nenhum, mesmo que uma mescla concorrente tenha deixado paid_at nele */
  const key = s => by === 'worked' ? day(s) : s.amount_zero ? '' : by === 'paid' ? (s.paid_at || '') : s.expected_pending ? (s.paid_at || '') : s.expected_on;
  const list = shifts.filter(s => key(s).startsWith(ym));
  /* total/received/pending = RECEITAS (iguais às de antes quando não há despesa); expense = despesas em módulo; net = receitas − despesas */
  const t = { count: list.length, minutes: 0, total: 0, received: 0, pending: 0, expense: { count: 0, total: 0, paid: 0, pending: 0 }, net: 0, byPlace: {}, list };
  for (const s of list) {
    const b = t.byPlace[s.place || ''] ||= { count: 0, total: 0, received: 0, pending: 0, expense: 0 }; /* '' = sem local (R6) */
    t.minutes += workedMin(s); b.count++;
    if (s.amount_cents < 0) { const v = -s.amount_cents; t.expense.count++; t.expense.total += v; t.expense[s.paid_at ? 'paid' : 'pending'] += v; b.expense += v; }
    else { const k = s.paid_at ? 'received' : 'pending'; t.total += s.amount_cents; t[k] += s.amount_cents; b.total += s.amount_cents; b[k] += s.amount_cents; }
  }
  t.net = t.total - t.expense.total;
  return t;
}
/* atrasados = receitas com valor e previsão reais; despesas vencidas ficam à parte (nunca "recebimento atrasado") */
const due = (s, today) => !s.paid_at && !s.expected_pending && s.expected_on < today;
export const overdueOf = (shifts, today) => shifts.filter(s => s.amount_cents > 0 && due(s, today)).sort((a, b) => a.expected_on.localeCompare(b.expected_on));
export const overduePay = (shifts, today) => shifts.filter(s => s.amount_cents < 0 && due(s, today)).sort((a, b) => a.expected_on.localeCompare(b.expected_on));

/* ---------- recorrência ---------- */
export const MAX_OCC = 500; /* M4: teto de ocorrências por recorrência; gera uma a mais para o chamador detectar o excesso */
export function occurrences(freq, iv, from, until) {
  const out = [], d0 = +from.slice(8, 10);
  for (let i = 0; i <= MAX_OCC; i++) {
    const k = freq === 'daily' ? addDays(from, i * iv) : freq === 'weekly' ? addDays(from, 7 * i * iv) : freq === 'monthly' ? addMonths(from, i * iv, d0) : addMonths(from, 12 * i * iv, d0);
    if (k > until) break; out.push(k);
  }
  return out;
}
export const REP = { none: 'Não repete', daily: 'Todo dia', weekly: 'Toda semana', biweekly: 'A cada 2 semanas', monthly: 'Todo mês', yearly: 'Todo ano' };
export const seriesLabel = (repeat, d) => ({ daily: 'Todo dia', weekly: `Toda ${WDL[dow(d)].replace('-feira', '')}`, biweekly: `${cap(WD[dow(d)])} sim, ${WD[dow(d)]} não`, monthly: `Todo dia ${+d.slice(8)}`, yearly: `Todo ano em ${dm(d)}` })[repeat];
export const seriesFreq = repeat => ({ freq: repeat === 'biweekly' ? 'weekly' : repeat, interval: repeat === 'biweekly' ? 2 : 1 });
export const freqTxt = se => se.freq === 'weekly' && se.interval === 2 ? 'A cada 2 semanas' : se.freq === 'weekly' ? 'Toda semana' : se.freq === 'monthly' ? 'Todo mês' : se.freq === 'daily' ? 'Todo dia' : 'Todo ano';
/* alvos de um escopo numa série: recebidos nunca entram (SPEC §2.6) */
export function scopeTargets(shifts, seriesId, occ, scope) {
  const all = shifts.filter(x => x.series === seriesId && !x.paid_at);
  return scope === 'one' ? all.filter(x => day(x) === occ) : scope === 'following' ? all.filter(x => day(x) >= occ) : all;
}

/* ---------- R9: pendências, sinal e fim independente ---------- */
/* Marcas gravadas só quando verdadeiras; a estrutura antiga (start, end, minutes, expected_on, amount_cents) continua sempre presente:
   start_pending = hora de início é o padrão, não confirmada · end_pending = término desconhecido (end = início + 1 min, minutes 1, nunca somado)
   expected_pending = sem previsão (expected_on = dia do plantão, fora de "cai no mês" e de atrasados) · amount_zero = valor zero confirmado
   (valor 0 sem a marca continua "a preencher", como já era para importados). */
export const DEFAULT_START = '07:00', MAX_SPAN_DAYS = 31;
export const FLAGS = ['start_pending', 'end_pending', 'expected_pending', 'amount_zero'];
export const amountKnown = s => s.amount_cents !== 0 || s.amount_zero === true;
export const isExpense = s => s.amount_cents < 0;
export const workedMin = s => (s.end_pending ? 0 : s.minutes);
/* o que falta saber: 'start' | 'end' | 'value' | 'expected' (previsão não se aplica a valor zero nem ao que já foi pago) */
export function pendingOf(s) { const p = []; if (s.start_pending) p.push('start'); if (s.end_pending) p.push('end'); if (!amountKnown(s)) p.push('value'); if (s.expected_pending && !s.amount_zero && !s.paid_at) p.push('expected'); return p; }
export const addMin = (iso, n) => { const d = new Date(Date.parse(iso) + (n + OFFSET_MIN) * 60000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00${OFFSET}`; };
/* valor do formulário: vazio = desconhecido; kind 'out' (A pagar) dá o sinal; "-" digitado também vale. null = ilegível */
export function formCents(f) { const t = String(f.amount ?? '').trim(); if (!t) return { cents: 0, known: false }; const c = parseCents(t); if (c == null) return null; return { cents: f.kind === 'out' && c > 0 ? -c : c, known: true }; }
/* dias entre o início e o fim: a data de término do formulário manda; sem ela vale a regra de sempre (fim ≤ início ⇒ dia seguinte; iguais ⇒ 24 h) */
export const legacySpan = (st, en) => (toMin(en) <= toMin(st) ? 1 : 0);
export function spanOf(f) { const st = f.start || DEFAULT_START; return f.endDate && isDateKey(f.endDate) && isDateKey(f.date) ? diffDays(f.date, f.endDate) : f.end_days != null ? f.end_days : legacySpan(st, f.end); }
/* copia para um plantão existente o resultado de mkShift, removendo as marcas que deixaram de valer */
export function editShift(orig, made) { const n = { ...orig, ...made }; for (const k of FLAGS) if (!(k in made)) delete n[k]; return n; }
export function assignShift(target, made) { Object.assign(target, made); for (const k of FLAGS) if (!(k in made)) delete target[k]; return target; }

/* ---------- formulário de plantão ---------- */
/* R9: só título e data são obrigatórios. O que for informado continua validado. */
export function validateForm(f) {
  const e = {};
  if (!f.title.trim()) e.title = 'título'; if (!isDateKey(f.date)) e.date = 'data';
  if ((f.start && !isTimeHM(f.start)) || (f.end && !isTimeHM(f.end))) e.time = 'horário';
  else if (f.end && f.endDate) {
    if (!isDateKey(f.endDate)) e.time = 'data de término';
    else if (isDateKey(f.date)) { const st = f.start || DEFAULT_START; if (f.endDate < f.date || (f.endDate === f.date && f.end <= st)) e.time = 'término (antes do início)'; else if (diffDays(f.date, f.endDate) > MAX_SPAN_DAYS) e.time = `término (no máximo ${MAX_SPAN_DAYS} dias depois)`; }
  }
  const a = formCents(f); if (!a) e.amount = 'valor';
  if (f.expected && !isDateKey(f.expected)) e.expected = 'previsão';
  if (f.paid && !isDateKey(f.paidAt)) e.paidAt = a && a.cents < 0 ? 'data do pagamento' : 'data do recebimento';
  if (f.paid && a && (!a.known || a.cents === 0)) e.paid = 'valor (para marcar como recebido ou pago)';
  if (f.repeat !== 'none' && (!isDateKey(f.until) || (f.date && f.until < f.date))) e.until = 'até quando repete';
  else if (f.repeat !== 'none' && isDateKey(f.date) && repDates(f).length > MAX_OCC) e.until = `período longo demais (máximo ${MAX_OCC} plantões por recorrência)`; /* M4 */
  return e;
}
export function repDates(f) { const { freq, interval } = seriesFreq(f.repeat); return f.repeat === 'none' || !f.until || !f.date || f.until < f.date ? [f.date] : occurrences(freq, interval, f.date, f.until); }
/* monta o plantão de um formulário para a data k; `first` = ocorrência que leva previsão sobrescrita e recebimento; `rule` = regra do local */
export function mkShift(f, k, first, rule) {
  const st = f.start || DEFAULT_START, start = isoLocal(k, st), a = formCents(f) || { cents: 0, known: false };
  const end = f.end ? isoLocal(addDays(k, spanOf(f)), f.end) : addMin(start, 1);
  /* sem regra (sem local): a 1ª ocorrência leva a data informada; as repetições ficam à mesma distância; sem data informada não há previsão (nunca inventada) */
  const off = isDateKey(f.date) && isDateKey(f.expected) ? diffDays(f.date, f.expected) : null, noExp = !rule && off == null;
  const s = { title: f.title.trim(), place: f.place || null, start, end, minutes: minutesOf(start, end), amount_cents: a.cents,
    expected_on: rule ? (first && f.expOverride && f.expected ? f.expected : ruleDateFor(rule, k)) : noExp ? k : first ? f.expected : addDays(k, off), paid_at: first && f.paid ? f.paidAt : null, note: (f.note || '').trim(),
    color_override: isColorKey(f.color) ? f.color : null /* R7: cor individual; '' = herda do local (ou neutra) */ };
  if (!f.start) s.start_pending = true; if (!f.end) s.end_pending = true; if (noExp) s.expected_pending = true; if (a.known && a.cents === 0) s.amount_zero = true;
  return s;
}

/* ---------- R9: o que a versão V8 (1.0.0+4c8a7b259c) não representa ----------
   Decide o envelope da sincronização (v 2), o schema do backup (2) e o aviso local. !needsV2(r) ⇒ o validador da V8 aceita r (teste R9-08). */
const newColor = k => k != null && !LEGACY_PALETTE.includes(k), flagged = o => !!o && FLAGS.some(k => o[k]);
const legacyTimes = s => isIsoLocal(s.start) && isIsoLocal(s.end) && s.end.slice(0, 10) === addDays(s.start.slice(0, 10), legacySpan(s.start.slice(11, 16), s.end.slice(11, 16)));
const tplNew = t => !!t && (t.amount_cents < 0 || flagged(t) || newColor(t.color_override) || t.end_days != null);
export function needsV2(coll, r) {
  if (!r) return false;
  if (coll === 'places') return newColor(r.color);
  if (coll === 'shifts') return r.amount_cents < 0 || flagged(r) || newColor(r.color_override) || !legacyTimes(r);
  if (coll === 'templates') return tplNew(r) || r.start === r.end;
  if (coll === 'series') return tplNew(r.tpl) || (!!r.tpl && r.tpl.start === r.tpl.end) /* série de 24 h: só o R9 a cria e edita */ || Object.values(r.overrides || {}).some(o => o && (o.end_days != null || newColor(o.color_override) || flagged(o) || o.start === o.end));
  /* conflito sincronizado: na forma da V8 quando nenhuma marca do R9 está em jogo (merge.js unitConflict); senão só o R9 sabe mostrar e resolver */
  if (coll === 'conflicts') return /(^|\.)(valor|previsão)$/.test(r.field || '') || [r.kept, r.other].some(v => conflictValueNew(r, v));
  return false;
}
/* valor guardado num conflito (o que ficou ou o outro): cor nova, valor negativo, horário que a V8 não reproduz, marca do R9, ou um registro inteiro (conflito de recriação) */
function conflictValueNew(c, v) {
  if (v == null) return false;
  if (typeof v === 'string') return /color/.test(c.field || '') && PALETTE.includes(v) && newColor(v);
  if (typeof v === 'number') return /amount_cents$/.test(c.field || '') && v < 0;
  if (typeof v !== 'object') return false;
  if (flagged(v) || v.end_days != null || v.amount_cents < 0 || newColor(v.color_override) || newColor(v.color)) return true;
  if (typeof v.start === 'string' && typeof v.end === 'string') return v.start.length > 5 ? !legacyTimes(v) : v.start === v.end; /* ISO de plantão ou HH:MM de modelo */
  return v.id != null && ['places', 'templates', 'series', 'shifts'].includes(c.coll) && needsV2(c.coll, v);
}
/* conflitos entram: um conflito que só o R9 interpreta também pede schema 2 (pré-build r2 #3) */
export const datasetNeedsV2 = d => ['places', 'templates', 'series', 'shifts', 'conflicts'].some(c => (d[c] || []).some(r => needsV2(c, r)));

/* ---------- identidade e duplicidade na importação (SPEC §3) ---------- */
export const normTitle = t => String(t || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
export const dupKeyCsv = s => `${s.start}|${s.end}|${s.place}|${s.amount_cents}`;
export const dupKeyIcs = s => `${s.start}|${s.end}|${s.place}|${normTitle(s.title)}`;

/* ---------- validação estrutural e referencial do conjunto (backup/importação) — lista vazia = válido ---------- */
export const SCHEMA_VERSION = 1, SCHEMA_MAX = 2; /* 1 = representável pela V8; 2 = usa recurso do R9 (needsV2). O R9 lê os dois. */
/* ids seguros: só caracteres que não quebram atributos HTML, seletores nem URLs (UUID, p029, sn1…) */
export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const optStr = (v, max = 2000) => v == null || (typeof v === 'string' && v.length <= max);
const optBool = v => v == null || typeof v === 'boolean';
const optIso = v => v == null || (typeof v === 'string' && !Number.isNaN(Date.parse(v)));
const optDays = v => v == null || (Number.isInteger(v) && v >= 0 && v <= MAX_SPAN_DAYS), optFlags = o => FLAGS.every(k => optBool(o[k]));
export function validateDataset(d) {
  const errs = [], push = m => { if (errs.length < 50) errs.push(m); };
  if (!d || typeof d !== 'object' || Array.isArray(d)) return ['conjunto de dados ausente'];
  for (const k of ['places', 'templates', 'series', 'shifts']) if (!Array.isArray(d[k])) push(`${k}: lista ausente`);
  if (errs.length) return errs;
  const uniq = (coll, name) => { const seen = new Set(); for (const r of coll) { if (!r || typeof r !== 'object' || Array.isArray(r)) { push(`${name}: registro inválido`); continue; } if (typeof r.id !== 'string' || !ID_RE.test(r.id)) { push(`${name}: id ausente ou inválido${typeof r.id === 'string' ? ` (${r.id.slice(0, 20)})` : ''}`); continue; } if (seen.has(r.id)) push(`${name}: id duplicado ${r.id}`); seen.add(r.id); } return seen; };
  const P = uniq(d.places, 'locais'), T = uniq(d.templates, 'modelos'), SE = uniq(d.series, 'séries'); uniq(d.shifts, 'plantões');
  for (const p of d.places) { if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 120) push(`local ${p.id}: nome ausente ou longo demais`); if (typeof p.short !== 'string' || !p.short.trim() || p.short.length > 8) push(`local ${p.id}: sigla ausente ou longa demais`); if (!validRule(p.rule)) push(`local ${p.id}: regra de recebimento inválida`); if (!PALETTE.includes(p.color)) push(`local ${p.id}: cor fora da paleta`); if (!optBool(p.archived) || !optBool(p.sample) || !optIso(p.updated_at)) push(`local ${p.id}: campos auxiliares inválidos`); }
  const optColor = v => v == null || isColorKey(v); /* R7: cor individual opcional (chave da paleta); ausente = herda */
  for (const t of d.templates) { if (!P.has(t.place)) push(`modelo ${t.id}: local inexistente`); if (!isTimeHM(t.start) || !isTimeHM(t.end) || !optDays(t.end_days)) push(`modelo ${t.id}: horário inválido`); /* R9: início = fim é 24 h */ if (!optFlags(t)) push(`modelo ${t.id}: marcas inválidas`); if (safeCents(t.amount_cents) == null) push(`modelo ${t.id}: valor inválido`); if (typeof t.title !== 'string' || !t.title.trim() || t.title.length > 120) push(`modelo ${t.id}: título ausente ou longo demais`); if (!optBool(t.archived) || !optBool(t.sample)) push(`modelo ${t.id}: campos auxiliares inválidos`); if (!optColor(t.color_override)) push(`modelo ${t.id}: cor fora da paleta`); }
  for (const se of d.series) {
    if (!['daily', 'weekly', 'monthly', 'yearly'].includes(se.freq)) push(`série ${se.id}: frequência inválida`); if (!Number.isInteger(se.interval) || se.interval < 1 || se.interval > 52) push(`série ${se.id}: intervalo inválido`);
    if (!isDateKey(se.starts_on) || !isDateKey(se.until) || se.until < se.starts_on) push(`série ${se.id}: período inválido`);
    else if (occurrences(se.freq, se.interval, se.starts_on, se.until).length > MAX_OCC) push(`série ${se.id}: período longo demais`); /* M4 */ if (!Array.isArray(se.exdates) || se.exdates.some(x => !isDateKey(x))) push(`série ${se.id}: datas puladas inválidas`);
    if (typeof se.label !== 'string' || !se.label.trim() || se.label.length > 80) push(`série ${se.id}: rótulo ausente`);
    if (!se.overrides || typeof se.overrides !== 'object' || Array.isArray(se.overrides) || Object.entries(se.overrides).some(([k, o]) => !isDateKey(k) || !o || typeof o !== 'object' || !isTimeHM(o.start) || !isTimeHM(o.end) || !optColor(o.color_override) || !optDays(o.end_days))) push(`série ${se.id}: exceções (overrides) inválidas`); /* R7: toda exceção mantém start/end; cor é opcional */
    if (se.tpl) { if (!se.tpl || typeof se.tpl !== 'object' || (se.tpl.place != null && !P.has(se.tpl.place)) || !isTimeHM(se.tpl.start) || !isTimeHM(se.tpl.end) || safeCents(se.tpl.amount_cents) == null || typeof se.tpl.title !== 'string' || !se.tpl.title.trim() || !optColor(se.tpl.color_override) || !optDays(se.tpl.end_days) || !optFlags(se.tpl)) push(`série ${se.id}: modelo embutido inválido`); } else if (!T.has(se.template)) push(`série ${se.id}: modelo inexistente`);
    if (!optBool(se.sample) || !optIso(se.created_at)) push(`série ${se.id}: campos auxiliares inválidos`);
  }
  for (const s of d.shifts) {
    if (s.place != null && !P.has(s.place)) push(`plantão ${s.id}: local inexistente`); /* null = sem local (R6) */
    if (!isIsoLocal(s.start) || !isIsoLocal(s.end)) push(`plantão ${s.id}: data/hora inválida`); else if (s.end <= s.start) push(`plantão ${s.id}: fim antes do início`); else if (Number.isInteger(s.minutes) && s.minutes !== minutesOf(s.start, s.end)) push(`plantão ${s.id}: duração não bate com início e fim`);
    if (safeCents(s.amount_cents) == null) push(`plantão ${s.id}: valor inválido`);
    if (!isDateKey(s.expected_on)) push(`plantão ${s.id}: previsão inválida`); if (s.paid_at != null && !isDateKey(s.paid_at)) push(`plantão ${s.id}: data de recebimento inválida`);
    if (s.series != null && !SE.has(s.series)) push(`plantão ${s.id}: série inexistente`); if (s.template != null && s.template !== '' && !T.has(s.template)) push(`plantão ${s.id}: modelo inexistente`);
    if (typeof s.title !== 'string' || !s.title.trim() || s.title.length > 160) push(`plantão ${s.id}: título ausente ou longo demais`); if (!Number.isInteger(s.minutes) || s.minutes <= 0) push(`plantão ${s.id}: duração inválida`);
    if (!optStr(s.note, 4000) || !optStr(s.ext_uid, 300) || !optIso(s.deleted_at) || !optIso(s.updated_at) || !optIso(s.imported_at) || !optBool(s.sample)) push(`plantão ${s.id}: campos auxiliares inválidos`);
    if (!optColor(s.color_override)) push(`plantão ${s.id}: cor fora da paleta`);
    if (!optFlags(s)) push(`plantão ${s.id}: marcas inválidas`); else if (s.end_pending && isIsoLocal(s.start) && s.end !== addMin(s.start, 1)) push(`plantão ${s.id}: término pendente com fim informado`);
  }
  return errs;
}
