window.PLANTOES_SAMPLE = {
 "meta": {
  "synthetic": true,
  "locale": "pt-BR",
  "currency": "BRL",
  "timezone": "America/Sao_Paulo (-03:00)",
  "today": "2026-10-20",
  "rule_month": "plantão pertence ao dia/mês do início",
  "note": "Dados 100% fictícios para o torneio de interface. Nenhum dado real."
 },
 "places": [
  {
   "id": "w1",
   "name": "Hospital Aurora",
   "short": "AUR",
   "color": "w1",
   "rule": {
    "kind": "days_after",
    "days": 30
   },
   "archived": false
  },
  {
   "id": "w2",
   "name": "UPA Vila Nova",
   "short": "UPA",
   "color": "w2",
   "rule": {
    "kind": "fixed_day",
    "day": 10
   },
   "archived": false
  },
  {
   "id": "w3",
   "name": "Central de Regulação",
   "short": "REG",
   "color": "w3",
   "rule": {
    "kind": "days_after",
    "days": 60
   },
   "archived": false
  },
  {
   "id": "w4",
   "name": "Clínica Horizonte",
   "short": "HOR",
   "color": "w4",
   "rule": {
    "kind": "days_after",
    "days": 15
   },
   "archived": false
  },
  {
   "id": "w5",
   "name": "Base Móvel Litoral",
   "short": "BML",
   "color": "w5",
   "rule": {
    "kind": "days_after",
    "days": 45
   },
   "archived": false
  }
 ],
 "templates": [
  {
   "id": "t1",
   "title": "Diurno 12h",
   "place": "w1",
   "start": "07:00",
   "end": "19:00",
   "amount_cents": 115000,
   "archived": false
  },
  {
   "id": "t2",
   "title": "Noturno 12h",
   "place": "w1",
   "start": "19:00",
   "end": "07:00",
   "amount_cents": 138000,
   "archived": false
  },
  {
   "id": "t3",
   "title": "Plantão dia",
   "place": "w2",
   "start": "07:00",
   "end": "19:00",
   "amount_cents": 98000,
   "archived": false
  },
  {
   "id": "t4",
   "title": "Plantão noite",
   "place": "w2",
   "start": "19:00",
   "end": "07:00",
   "amount_cents": 112000,
   "archived": false
  },
  {
   "id": "t5",
   "title": "Regulação 6h",
   "place": "w3",
   "start": "13:00",
   "end": "19:00",
   "amount_cents": 54000,
   "archived": false
  },
  {
   "id": "t6",
   "title": "Ambulatório 4h",
   "place": "w4",
   "start": "08:00",
   "end": "12:00",
   "amount_cents": 42000,
   "archived": false
  },
  {
   "id": "t7",
   "title": "Base 12h",
   "place": "w5",
   "start": "07:00",
   "end": "19:00",
   "amount_cents": 125000,
   "archived": false
  }
 ],
 "series": [
  {
   "id": "s1",
   "template": "t5",
   "freq": "weekly",
   "interval": 1,
   "starts_on": "2026-09-02",
   "until": "2026-12-30",
   "label": "Toda quarta",
   "exdates": [
    "2026-09-30",
    "2026-10-14"
   ],
   "overrides": {
    "2026-10-28": {
     "start": "14:00",
     "end": "20:00"
    }
   }
  },
  {
   "id": "s2",
   "template": "t2",
   "freq": "weekly",
   "interval": 2,
   "starts_on": "2026-09-12",
   "until": "2026-11-28",
   "label": "Sábado sim, sábado não",
   "exdates": [],
   "overrides": {}
  },
  {
   "id": "s3",
   "template": "t7",
   "freq": "monthly",
   "interval": 1,
   "starts_on": "2026-08-31",
   "until": "2026-11-30",
   "label": "Todo dia 31 (último dia válido)",
   "exdates": [],
   "overrides": {}
  }
 ],
 "shifts": [
  {
   "id": "p001",
   "title": "Base 12h",
   "place": "w5",
   "template": "t7",
   "series": "s3",
   "start": "2026-08-31T07:00:00-03:00",
   "end": "2026-08-31T19:00:00-03:00",
   "minutes": 720,
   "amount_cents": 125000,
   "expected_on": "2026-10-15",
   "paid_at": "2026-10-15",
   "note": ""
  },
  {
   "id": "p002",
   "title": "Regulação 6h",
   "place": "w3",
   "template": "t5",
   "series": "s1",
   "start": "2026-09-02T13:00:00-03:00",
   "end": "2026-09-02T19:00:00-03:00",
   "minutes": 360,
   "amount_cents": 54000,
   "expected_on": "2026-11-01",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p003",
   "title": "Diurno 12h",
   "place": "w1",
   "template": "t1",
   "series": null,
   "start": "2026-09-08T07:00:00-03:00",
   "end": "2026-09-08T19:00:00-03:00",
   "minutes": 720,
   "amount_cents": 115000,
   "expected_on": "2026-10-08",
   "paid_at": "2026-10-08",
   "note": ""
  },
  {
   "id": "p004",
   "title": "Regulação 6h",
   "place": "w3",
   "template": "t5",
   "series": "s1",
   "start": "2026-09-09T13:00:00-03:00",
   "end": "2026-09-09T19:00:00-03:00",
   "minutes": 360,
   "amount_cents": 54000,
   "expected_on": "2026-11-08",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p005",
   "title": "Noturno 12h",
   "place": "w1",
   "template": "t2",
   "series": "s2",
   "start": "2026-09-12T19:00:00-03:00",
   "end": "2026-09-13T07:00:00-03:00",
   "minutes": 720,
   "amount_cents": 138000,
   "expected_on": "2026-10-12",
   "paid_at": "2026-10-12",
   "note": ""
  },
  {
   "id": "p006",
   "title": "Plantão dia",
   "place": "w2",
   "template": "t3",
   "series": null,
   "start": "2026-09-15T07:00:00-03:00",
   "end": "2026-09-15T19:00:00-03:00",
   "minutes": 720,
   "amount_cents": 98000,
   "expected_on": "2026-10-10",
   "paid_at": "2026-10-10",
   "note": ""
  },
  {
   "id": "p007",
   "title": "Regulação 6h",
   "place": "w3",
   "template": "t5",
   "series": "s1",
   "start": "2026-09-16T13:00:00-03:00",
   "end": "2026-09-16T19:00:00-03:00",
   "minutes": 360,
   "amount_cents": 54000,
   "expected_on": "2026-11-15",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p008",
   "title": "Ambulatório 4h",
   "place": "w4",
   "template": "t6",
   "series": null,
   "start": "2026-09-22T08:00:00-03:00",
   "end": "2026-09-22T12:00:00-03:00",
   "minutes": 240,
   "amount_cents": 42000,
   "expected_on": "2026-10-07",
   "paid_at": "2026-10-07",
   "note": ""
  },
  {
   "id": "p009",
   "title": "Regulação 6h",
   "place": "w3",
   "template": "t5",
   "series": "s1",
   "start": "2026-09-23T13:00:00-03:00",
   "end": "2026-09-23T19:00:00-03:00",
   "minutes": 360,
   "amount_cents": 54000,
   "expected_on": "2026-11-22",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p010",
   "title": "Plantão noite",
   "place": "w2",
   "template": "t4",
   "series": null,
   "start": "2026-09-24T19:00:00-03:00",
   "end": "2026-09-25T07:00:00-03:00",
   "minutes": 720,
   "amount_cents": 112000,
   "expected_on": "2026-10-10",
   "paid_at": null,
   "note": "Pagamento não caiu na data prevista"
  },
  {
   "id": "p011",
   "title": "Noturno 12h",
   "place": "w1",
   "template": "t2",
   "series": "s2",
   "start": "2026-09-26T19:00:00-03:00",
   "end": "2026-09-27T07:00:00-03:00",
   "minutes": 720,
   "amount_cents": 138000,
   "expected_on": "2026-10-26",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p012",
   "title": "Base 12h",
   "place": "w5",
   "template": "t7",
   "series": "s3",
   "start": "2026-09-30T07:00:00-03:00",
   "end": "2026-09-30T19:00:00-03:00",
   "minutes": 720,
   "amount_cents": 125000,
   "expected_on": "2026-11-14",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p013",
   "title": "Ambulatório 4h",
   "place": "w4",
   "template": "t6",
   "series": null,
   "start": "2026-10-01T08:00:00-03:00",
   "end": "2026-10-01T12:00:00-03:00",
   "minutes": 240,
   "amount_cents": 42000,
   "expected_on": "2026-10-16",
   "paid_at": "2026-10-16",
   "note": ""
  },
  {
   "id": "p014",
   "title": "Diurno 12h",
   "place": "w1",
   "template": "t1",
   "series": null,
   "start": "2026-10-02T07:00:00-03:00",
   "end": "2026-10-02T19:00:00-03:00",
   "minutes": 720,
   "amount_cents": 115000,
   "expected_on": "2026-11-01",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p015",
   "title": "Plantão dia",
   "place": "w2",
   "template": "t3",
   "series": null,
   "start": "2026-10-05T07:00:00-03:00",
   "end": "2026-10-05T19:00:00-03:00",
   "minutes": 720,
   "amount_cents": 98000,
   "expected_on": "2026-11-10",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p016",
   "title": "Ambulatório 4h",
   "place": "w4",
   "template": "t6",
   "series": null,
   "start": "2026-10-06T08:00:00-03:00",
   "end": "2026-10-06T12:00:00-03:00",
   "minutes": 240,
   "amount_cents": 42000,
   "expected_on": "2026-10-21",
   "paid_at": "2026-10-19",
   "note": "Pago antes do previsto"
  },
  {
   "id": "p017",
   "title": "Ambulatório 4h",
   "place": "w4",
   "template": "t6",
   "series": null,
   "start": "2026-10-07T08:00:00-03:00",
   "end": "2026-10-07T12:00:00-03:00",
   "minutes": 240,
   "amount_cents": 42000,
   "expected_on": "2026-10-22",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p018",
   "title": "Regulação 6h",
   "place": "w3",
   "template": "t5",
   "series": "s1",
   "start": "2026-10-07T13:00:00-03:00",
   "end": "2026-10-07T19:00:00-03:00",
   "minutes": 360,
   "amount_cents": 54000,
   "expected_on": "2026-12-06",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p019",
   "title": "Plantão noite",
   "place": "w2",
   "template": "t4",
   "series": null,
   "start": "2026-10-08T19:00:00-03:00",
   "end": "2026-10-09T07:00:00-03:00",
   "minutes": 720,
   "amount_cents": 112000,
   "expected_on": "2026-11-10",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p020",
   "title": "Diurno 12h",
   "place": "w1",
   "template": "t1",
   "series": null,
   "start": "2026-10-09T07:00:00-03:00",
   "end": "2026-10-09T19:00:00-03:00",
   "minutes": 720,
   "amount_cents": 115000,
   "expected_on": "2026-11-08",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p021",
   "title": "Noturno 12h",
   "place": "w1",
   "template": "t2",
   "series": "s2",
   "start": "2026-10-10T19:00:00-03:00",
   "end": "2026-10-11T07:00:00-03:00",
   "minutes": 720,
   "amount_cents": 138000,
   "expected_on": "2026-11-09",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p022",
   "title": "Plantão dia",
   "place": "w2",
   "template": "t3",
   "series": null,
   "start": "2026-10-12T07:00:00-03:00",
   "end": "2026-10-12T19:00:00-03:00",
   "minutes": 720,
   "amount_cents": 98000,
   "expected_on": "2026-11-10",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p023",
   "title": "Ambulatório 4h",
   "place": "w4",
   "template": "t6",
   "series": null,
   "start": "2026-10-13T08:00:00-03:00",
   "end": "2026-10-13T12:00:00-03:00",
   "minutes": 240,
   "amount_cents": 42000,
   "expected_on": "2026-10-28",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p024",
   "title": "Diurno 12h",
   "place": "w1",
   "template": "t1",
   "series": null,
   "start": "2026-10-15T07:00:00-03:00",
   "end": "2026-10-15T19:00:00-03:00",
   "minutes": 720,
   "amount_cents": 115000,
   "expected_on": "2026-11-14",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p025",
   "title": "Plantão noite",
   "place": "w2",
   "template": "t4",
   "series": null,
   "start": "2026-10-16T19:00:00-03:00",
   "end": "2026-10-17T07:00:00-03:00",
   "minutes": 720,
   "amount_cents": 112000,
   "expected_on": "2026-11-10",
   "paid_at": null,
   "note": "Troca com colega"
  },
  {
   "id": "p026",
   "title": "Plantão dia",
   "place": "w2",
   "template": "t3",
   "series": null,
   "start": "2026-10-19T07:00:00-03:00",
   "end": "2026-10-19T19:00:00-03:00",
   "minutes": 720,
   "amount_cents": 98000,
   "expected_on": "2026-11-10",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p027",
   "title": "Diurno 12h",
   "place": "w1",
   "template": "t1",
   "series": null,
   "start": "2026-10-20T07:00:00-03:00",
   "end": "2026-10-20T19:00:00-03:00",
   "minutes": 720,
   "amount_cents": 115000,
   "expected_on": "2026-11-19",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p028",
   "title": "Plantão noite",
   "place": "w2",
   "template": "t4",
   "series": null,
   "start": "2026-10-20T19:00:00-03:00",
   "end": "2026-10-21T07:00:00-03:00",
   "minutes": 720,
   "amount_cents": 112000,
   "expected_on": "2026-11-10",
   "paid_at": null,
   "note": "Dobra: dia no Aurora, noite na UPA"
  },
  {
   "id": "p029",
   "title": "Ambulatório 4h",
   "place": "w4",
   "template": "t6",
   "series": null,
   "start": "2026-10-21T08:00:00-03:00",
   "end": "2026-10-21T12:00:00-03:00",
   "minutes": 240,
   "amount_cents": 42000,
   "expected_on": "2026-11-05",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p030",
   "title": "Regulação 6h",
   "place": "w3",
   "template": "t5",
   "series": "s1",
   "start": "2026-10-21T13:00:00-03:00",
   "end": "2026-10-21T19:00:00-03:00",
   "minutes": 360,
   "amount_cents": 54000,
   "expected_on": "2026-12-20",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p031",
   "title": "Plantão noite",
   "place": "w2",
   "template": "t4",
   "series": null,
   "start": "2026-10-21T19:00:00-03:00",
   "end": "2026-10-22T07:00:00-03:00",
   "minutes": 720,
   "amount_cents": 112000,
   "expected_on": "2026-11-10",
   "paid_at": null,
   "note": "Três no mesmo dia"
  },
  {
   "id": "p032",
   "title": "Ambulatório 4h",
   "place": "w4",
   "template": "t6",
   "series": null,
   "start": "2026-10-22T08:00:00-03:00",
   "end": "2026-10-22T12:00:00-03:00",
   "minutes": 240,
   "amount_cents": 42000,
   "expected_on": "2026-11-06",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p033",
   "title": "Diurno 12h",
   "place": "w1",
   "template": "t1",
   "series": null,
   "start": "2026-10-23T07:00:00-03:00",
   "end": "2026-10-23T19:00:00-03:00",
   "minutes": 720,
   "amount_cents": 115000,
   "expected_on": "2026-11-22",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p034",
   "title": "Noturno 12h",
   "place": "w1",
   "template": "t2",
   "series": "s2",
   "start": "2026-10-24T19:00:00-03:00",
   "end": "2026-10-25T07:00:00-03:00",
   "minutes": 720,
   "amount_cents": 138000,
   "expected_on": "2026-11-23",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p035",
   "title": "Plantão dia",
   "place": "w2",
   "template": "t3",
   "series": null,
   "start": "2026-10-26T07:00:00-03:00",
   "end": "2026-10-26T19:00:00-03:00",
   "minutes": 720,
   "amount_cents": 98000,
   "expected_on": "2026-11-10",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p036",
   "title": "Ambulatório 4h",
   "place": "w4",
   "template": "t6",
   "series": null,
   "start": "2026-10-27T08:00:00-03:00",
   "end": "2026-10-27T12:00:00-03:00",
   "minutes": 240,
   "amount_cents": 42000,
   "expected_on": "2026-11-11",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p037",
   "title": "Ambulatório 4h",
   "place": "w4",
   "template": "t6",
   "series": null,
   "start": "2026-10-28T08:00:00-03:00",
   "end": "2026-10-28T12:00:00-03:00",
   "minutes": 240,
   "amount_cents": 42000,
   "expected_on": "2026-11-12",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p038",
   "title": "Regulação 6h",
   "place": "w3",
   "template": "t5",
   "series": "s1",
   "start": "2026-10-28T14:00:00-03:00",
   "end": "2026-10-28T20:00:00-03:00",
   "minutes": 360,
   "amount_cents": 54000,
   "expected_on": "2026-12-27",
   "paid_at": null,
   "note": "Ocorrência editada (só esta)"
  },
  {
   "id": "p039",
   "title": "Diurno 12h",
   "place": "w1",
   "template": "t1",
   "series": null,
   "start": "2026-10-29T07:00:00-03:00",
   "end": "2026-10-29T19:00:00-03:00",
   "minutes": 720,
   "amount_cents": 115000,
   "expected_on": "2026-11-28",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p040",
   "title": "Plantão noite",
   "place": "w2",
   "template": "t4",
   "series": null,
   "start": "2026-10-30T19:00:00-03:00",
   "end": "2026-10-31T07:00:00-03:00",
   "minutes": 720,
   "amount_cents": 112000,
   "expected_on": "2026-11-10",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p041",
   "title": "Base 12h",
   "place": "w5",
   "template": "t7",
   "series": "s3",
   "start": "2026-10-31T07:00:00-03:00",
   "end": "2026-10-31T19:00:00-03:00",
   "minutes": 720,
   "amount_cents": 125000,
   "expected_on": "2026-12-15",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p042",
   "title": "Plantão noite",
   "place": "w2",
   "template": "t4",
   "series": null,
   "start": "2026-10-31T19:00:00-03:00",
   "end": "2026-11-01T07:00:00-03:00",
   "minutes": 720,
   "amount_cents": 112000,
   "expected_on": "2026-11-10",
   "paid_at": null,
   "note": "Vira o mês: 31/10 19h → 01/11 07h"
  },
  {
   "id": "p043",
   "title": "Diurno 12h",
   "place": "w1",
   "template": "t1",
   "series": null,
   "start": "2026-11-03T07:00:00-03:00",
   "end": "2026-11-03T19:00:00-03:00",
   "minutes": 720,
   "amount_cents": 115000,
   "expected_on": "2026-12-03",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p044",
   "title": "Regulação 6h",
   "place": "w3",
   "template": "t5",
   "series": "s1",
   "start": "2026-11-04T13:00:00-03:00",
   "end": "2026-11-04T19:00:00-03:00",
   "minutes": 360,
   "amount_cents": 54000,
   "expected_on": "2027-01-03",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p045",
   "title": "Plantão dia",
   "place": "w2",
   "template": "t3",
   "series": null,
   "start": "2026-11-06T07:00:00-03:00",
   "end": "2026-11-06T19:00:00-03:00",
   "minutes": 720,
   "amount_cents": 98000,
   "expected_on": "2026-12-10",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p046",
   "title": "Noturno 12h",
   "place": "w1",
   "template": "t2",
   "series": "s2",
   "start": "2026-11-07T19:00:00-03:00",
   "end": "2026-11-08T07:00:00-03:00",
   "minutes": 720,
   "amount_cents": 138000,
   "expected_on": "2026-12-07",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p047",
   "title": "Regulação 6h",
   "place": "w3",
   "template": "t5",
   "series": "s1",
   "start": "2026-11-11T13:00:00-03:00",
   "end": "2026-11-11T19:00:00-03:00",
   "minutes": 360,
   "amount_cents": 54000,
   "expected_on": "2027-01-10",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p048",
   "title": "Plantão noite",
   "place": "w2",
   "template": "t4",
   "series": null,
   "start": "2026-11-12T19:00:00-03:00",
   "end": "2026-11-13T07:00:00-03:00",
   "minutes": 720,
   "amount_cents": 112000,
   "expected_on": "2026-12-10",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p049",
   "title": "Regulação 6h",
   "place": "w3",
   "template": "t5",
   "series": "s1",
   "start": "2026-11-18T13:00:00-03:00",
   "end": "2026-11-18T19:00:00-03:00",
   "minutes": 360,
   "amount_cents": 54000,
   "expected_on": "2027-01-17",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p050",
   "title": "Noturno 12h",
   "place": "w1",
   "template": "t2",
   "series": "s2",
   "start": "2026-11-21T19:00:00-03:00",
   "end": "2026-11-22T07:00:00-03:00",
   "minutes": 720,
   "amount_cents": 138000,
   "expected_on": "2026-12-21",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p051",
   "title": "Regulação 6h",
   "place": "w3",
   "template": "t5",
   "series": "s1",
   "start": "2026-11-25T13:00:00-03:00",
   "end": "2026-11-25T19:00:00-03:00",
   "minutes": 360,
   "amount_cents": 54000,
   "expected_on": "2027-01-24",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p052",
   "title": "Base 12h",
   "place": "w5",
   "template": "t7",
   "series": "s3",
   "start": "2026-11-30T07:00:00-03:00",
   "end": "2026-11-30T19:00:00-03:00",
   "minutes": 720,
   "amount_cents": 125000,
   "expected_on": "2027-01-14",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p053",
   "title": "Regulação 6h",
   "place": "w3",
   "template": "t5",
   "series": "s1",
   "start": "2026-12-02T13:00:00-03:00",
   "end": "2026-12-02T19:00:00-03:00",
   "minutes": 360,
   "amount_cents": 54000,
   "expected_on": "2027-01-31",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p054",
   "title": "Regulação 6h",
   "place": "w3",
   "template": "t5",
   "series": "s1",
   "start": "2026-12-09T13:00:00-03:00",
   "end": "2026-12-09T19:00:00-03:00",
   "minutes": 360,
   "amount_cents": 54000,
   "expected_on": "2027-02-07",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p055",
   "title": "Regulação 6h",
   "place": "w3",
   "template": "t5",
   "series": "s1",
   "start": "2026-12-16T13:00:00-03:00",
   "end": "2026-12-16T19:00:00-03:00",
   "minutes": 360,
   "amount_cents": 54000,
   "expected_on": "2027-02-14",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p056",
   "title": "Regulação 6h",
   "place": "w3",
   "template": "t5",
   "series": "s1",
   "start": "2026-12-23T13:00:00-03:00",
   "end": "2026-12-23T19:00:00-03:00",
   "minutes": 360,
   "amount_cents": 54000,
   "expected_on": "2027-02-21",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p057",
   "title": "Regulação 6h",
   "place": "w3",
   "template": "t5",
   "series": "s1",
   "start": "2026-12-30T13:00:00-03:00",
   "end": "2026-12-30T19:00:00-03:00",
   "minutes": 360,
   "amount_cents": 54000,
   "expected_on": "2027-02-28",
   "paid_at": null,
   "note": ""
  },
  {
   "id": "p058",
   "title": "Noturno 12h",
   "place": "w1",
   "template": "t2",
   "series": null,
   "start": "2026-12-31T19:00:00-03:00",
   "end": "2027-01-01T07:00:00-03:00",
   "minutes": 720,
   "amount_cents": 138000,
   "expected_on": "2027-01-30",
   "paid_at": null,
   "note": "Vira o ano"
  }
 ],
 "expected": {
  "today": "2026-10-20",
  "overdue_ids": [
   "p010"
  ],
  "overdue_cents": 112000,
  "months": {
   "2026-09": {
    "month": "2026-09",
    "worked_in_month": {
     "count": 11,
     "minutes": 6000,
     "total": 984000,
     "received": 393000,
     "pending": 591000,
     "by_place": {
      "w3": {
       "count": 4,
       "total": 216000,
       "received": 0,
       "pending": 216000
      },
      "w1": {
       "count": 3,
       "total": 391000,
       "received": 253000,
       "pending": 138000
      },
      "w2": {
       "count": 2,
       "total": 210000,
       "received": 98000,
       "pending": 112000
      },
      "w4": {
       "count": 1,
       "total": 42000,
       "received": 42000,
       "pending": 0
      },
      "w5": {
       "count": 1,
       "total": 125000,
       "received": 0,
       "pending": 125000
      }
     }
    },
    "expected_in_month": {
     "count": 0,
     "minutes": 0,
     "total": 0,
     "received": 0,
     "pending": 0,
     "by_place": {}
    },
    "cash_received_in_month_cents": 0
   },
   "2026-10": {
    "month": "2026-10",
    "worked_in_month": {
     "count": 30,
     "minutes": 16680,
     "total": 2653000,
     "received": 84000,
     "pending": 2569000,
     "by_place": {
      "w4": {
       "count": 8,
       "total": 336000,
       "received": 84000,
       "pending": 252000
      },
      "w1": {
       "count": 8,
       "total": 966000,
       "received": 0,
       "pending": 966000
      },
      "w2": {
       "count": 10,
       "total": 1064000,
       "received": 0,
       "pending": 1064000
      },
      "w3": {
       "count": 3,
       "total": 162000,
       "received": 0,
       "pending": 162000
      },
      "w5": {
       "count": 1,
       "total": 125000,
       "received": 0,
       "pending": 125000
      }
     }
    },
    "expected_in_month": {
     "count": 11,
     "minutes": 5520,
     "total": 936000,
     "received": 602000,
     "pending": 334000,
     "by_place": {
      "w5": {
       "count": 1,
       "total": 125000,
       "received": 125000,
       "pending": 0
      },
      "w1": {
       "count": 3,
       "total": 391000,
       "received": 253000,
       "pending": 138000
      },
      "w2": {
       "count": 2,
       "total": 210000,
       "received": 98000,
       "pending": 112000
      },
      "w4": {
       "count": 5,
       "total": 210000,
       "received": 126000,
       "pending": 84000
      }
     }
    },
    "cash_received_in_month_cents": 602000
   },
   "2026-11": {
    "month": "2026-11",
    "worked_in_month": {
     "count": 10,
     "minutes": 5760,
     "total": 942000,
     "received": 0,
     "pending": 942000,
     "by_place": {
      "w1": {
       "count": 3,
       "total": 391000,
       "received": 0,
       "pending": 391000
      },
      "w3": {
       "count": 4,
       "total": 216000,
       "received": 0,
       "pending": 216000
      },
      "w2": {
       "count": 2,
       "total": 210000,
       "received": 0,
       "pending": 210000
      },
      "w5": {
       "count": 1,
       "total": 125000,
       "received": 0,
       "pending": 125000
      }
     }
    },
    "expected_in_month": {
     "count": 27,
     "minutes": 16080,
     "total": 2539000,
     "received": 0,
     "pending": 2539000,
     "by_place": {
      "w3": {
       "count": 4,
       "total": 216000,
       "received": 0,
       "pending": 216000
      },
      "w5": {
       "count": 1,
       "total": 125000,
       "received": 0,
       "pending": 125000
      },
      "w1": {
       "count": 8,
       "total": 966000,
       "received": 0,
       "pending": 966000
      },
      "w2": {
       "count": 10,
       "total": 1064000,
       "received": 0,
       "pending": 1064000
      },
      "w4": {
       "count": 4,
       "total": 168000,
       "received": 0,
       "pending": 168000
      }
     }
    },
    "cash_received_in_month_cents": 0
   }
  }
 }
};
