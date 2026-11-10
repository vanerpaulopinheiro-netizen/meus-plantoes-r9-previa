# Meus Plantões — app (B1)

PWA local-first para plantões e recebimentos. Sem conta: tudo fica no aparelho (IndexedDB) e só sai nos arquivos que o dono
exportar ou, se ele ativar, como cópia cifrada no aparelho (frase-senha) para o servidor do dono (`../server/`, R5). Base visual e de interação: identidade G2/G2.1 aprovada e congelada em 23/10/2026.

## Rodar

Módulos ES e service worker não funcionam por `file://`. Sirva a pasta por HTTP:

```bash
node tools/serve.mjs 8787 .
```

Abra `http://127.0.0.1:8787/`. Parâmetros só para testes: `?sample=1` (carrega os dados fictícios quando o banco está vazio),
`?today=YYYY-MM-DD` (fixa o "hoje"), `?nosw=1` (sem service worker), `?noshare=1` (exportar sempre baixa, nunca abre a folha de compartilhar).

## Estrutura

| Arquivo | Papel |
|---|---|
| `index.html` | casca + CSP (`default-src 'self'`), manifesto, ícones |
| `styles.css` | tokens e componentes congelados (G2/G2.1) + bloco "B1: produto" |
| `src/core.js` | regras puras: datas, centavos, previsão, coortes, recorrência, validação (testado em `node:test`) |
| `src/store.js` | IndexedDB + fila única de commits (revisão monotônica, sucesso só em `transaction.complete`, estado "não gravado" com nova tentativa, verificação da revisão na transação contra outra aba) |
| `src/codecs.js` | CSV escala / CSV com ganhos / ICS sem ou com valores / backup JSON (SHA-256, validação estrita); duplicatas e conflitos na importação |
| `src/app.js` | interface (telas, gestos G2.1, F01/F02, cadastros, lixeira, portabilidade, PWA) |
| `src/sync.js` | backup no servidor: PBKDF2 → AES-GCM com gzip, etiqueta HMAC, cliente HTTP e a regra única `step` (R5_PLAN rev 6) |
| `sw.js` | precache atômico por versão; atualização só com aceite do usuário |
| `sample.js` | dados de exemplo (fictícios) |
| `tools/serve.mjs`, `tools/stamp.mjs`, `tools/icons.mjs` | servidor local, carimbo de versão, ícones |

## Testes

```bash
node --test test/*.test.mjs
```

```bash
node test/e2e.mjs
```

Unitários (`node:test`, 26 casos): datas, centavos, previsão, coortes, recorrência, validação estrita, fila de gravação (atrasos,
inversão, falha, conflito com outra aba), codecs CSV/ICS/backup, conflitos de importação, migração. E2E (Playwright Chromium,
`PW_PATH` apontando para o pacote `playwright`, 23 cenários): o próprio servidor local é iniciado; cobre primeiro uso,
persistência entre reinícios, lixeira, escopos de série, exportar/importar reais (CSV, ICS sem/com valores, backup), conflitos
de importação, falha de gravação, restauração abortada, duas abas concorrentes, offline, atualização N→N+1 com duas abas,
semana na segunda, 320/430 px, modelos, assets/manifesto/service worker, totais financeiros após mutações e plantão noturno na
virada do ano. Contra a versão publicada: `node test/e2e.mjs <saida> --url=https://host/caminho/` (pula só o cenário que altera
arquivos no disco). O harness G2.1 roda sobre o produto em modo produto:

```bash
node ../g21/tools/g21_test.mjs . <saida> --product --base-url=http://127.0.0.1:8787/ --base=../design/prototype
```

## Publicar

Antes de empacotar: `node tools/stamp.mjs` (grava a versão em `src/version.js` e no cache do `sw.js`). Depois copie a pasta
inteira (menos `test/` e `tools/`) para qualquer hospedagem estática HTTPS (GitHub Pages, Cloudflare Pages, pasta estática na VPS).
No iPhone: abrir no Safari → Compartilhar → Adicionar à Tela de Início. O app funciona offline após a primeira carga.

## Limites declarados

- Compatibilidade com o CSV real do Plantãozinho = `NOT_TESTED` até existir uma exportação real como fixture (o formato documentado está implementado).
- O iOS pode apagar dados de sites sob pressão de espaço: faça backup (Ajustes › Seus dados); o app avisa após 7 dias.
- Safari/VoiceOver físicos só se provam no piloto; aqui há Chromium (harness/E2E) e WebKit do Playwright (sonda).
