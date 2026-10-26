# Roadmap — WME Alert System

Plano de execução em fases, da primeira versão da biblioteca até a primeira versão pública.
Base: v0.1.0 (ainda sem git e não publicada). Revisado em 2026-10-25.

Contexto técnico completo em `AGENTS.md`. Os números de linha mudam com o tempo; localize pelo nome do método (`grep -n "^    (async )\?nomeDoMetodo("`).

## Tabela de execução

| Fase | Título | Modelo | Esforço | Depende de | Status |
|---|---|---|---|---|---|
| 1 | Pesquisa e plano: bundle do WME, SDK, scripts existentes | **Opus 5.5** | alto | — | ✅ Concluída (2026-10-25) |
| 2a | Núcleo da biblioteca: bootstrap/singleton, API, filas de diálogos e snackbars, sininho (estratégias A/B), changelog, extras, aba | **Opus 5.5** | xhigh | 1 | 🧪 Implementada (v0.1.0), aguardando teste no WME |
| 2b | Traduções dos textos da biblioteca (44 idiomas) | Sonnet 5.5 (agente `i18n-translator`) | baixo | 2a | 🧪 Implementada, falta revisão de pt-BR/pt-PT/es pelo usuário e conferir no navegador |
| 2c | Ferramentas e contexto: `check.mjs`, `i18n.mjs`, `.claude/`, AGENTS/CLAUDE, readme, script de exemplo | Sonnet 5.5 | médio | 2a | ✅ Concluída (`node scripts/check.mjs` passa) |
| 3a | Passo 0: captura no console do WME (cache do sininho, requests de exclusão/leitura, contador, `lonLat`) e registro no AGENTS.md §4 | Usuário + Sonnet 5.5 | baixo | 2a | ✅ Concluída (2026-10-25): formato e `type` do item, sem estado de "lida", DELETE (confere com o `requestPattern`) e `lonLat` `{ lon, lat }` registrados no AGENTS.md §4. O efeito do refetch nos itens injetados só se vê na 3b |
| 3b | Ajustar o sininho nativo e o `map.confirm` conforme a captura | **Opus 5.5** | alto | 3a | 🧪 Implementada (2026-10-25): sem estado de "lida" (contador = nº de itens), só o DELETE é tratado, `lonLat` validado na área visível (fora dela → diálogo). Falta conferir no WME: refetch, reload e lixeira sem DELETE real |
| 4 | Revisão completa do código (agente `wme-reviewer`) e correções | **Opus 5.5** | alto | 3b | ✅ Concluída (2026-10-25): 2 passadas do `wme-reviewer`, nenhum achado crítico/alto aberto, `check.mjs` limpo. O que depende do WME foi para o AGENTS §4 "Pending" e para o checklist da 5a |
| 5a | Teste manual no WME (skill `test-in-wme`, checklist completo, tema claro/escuro, Beta) | Usuário + Sonnet 5.5 | baixo | 4 | ✅ Concluída (2026-10-25), via CDP no Opera GX. OK: startup/singleton, diálogos, snackbars, sininho (query e dom), changelog, `map.confirm`, `inline.alert`, aba/mute, textos es/ar, Beta, dark mode (script de terceiros), `@require` pelo Tampermonkey, sincronização entre abas. Corrigido durante o teste: `map.confirm` sem `lonLat` derrubava o WME (SDK async). Não reproduzido: diálogo nativo do WME aberto com o nosso na fila |
| 5b | Correções dos problemas encontrados no teste | **Opus 5.5** | alto | 5a | ✅ Concluída (2026-10-25): × no RTL, `alarming` removido do `map.confirm`, textos da lib no sininho retraduzidos, aba oculta só documentada; revisão do `wme-reviewer` corrigida e conferida ao vivo no Beta. Seções Dialogs, Extras e i18n do checklist: 21/21 no Beta |
| 6 | Git: `git init`, `.gitignore`, primeiro commit, branches `main`/`development` | Haiku 5.5 | baixo | 2c | ⏳ Pendente (só com OK do usuário) |
| 7a | `CHANGELOG.md` no repositório (sem aviso ao usuário final) e checagem no `check.mjs` | Sonnet 5.5 | baixo | 5b | ✅ Concluída |
| 7b | Release 1.0.0 da biblioteca no Greasy Fork (tipo "library"), `devVersion = false` | Sonnet 5.5 | baixo | 7a, 6 | ⏳ Pendente (publicação feita pelo usuário) |

**Legenda de status:** ⏳ Pendente · 🚧 Em andamento · 🧪 Implementada, aguardando teste no WME · ✅ Concluída (critério de aceite verificado) · ⏸️ Adiada (decisão do usuário; nada depende dela) · ⛔ Bloqueada (dizer o motivo).

**Critério geral dos modelos:**
- **Opus 5.5**: arquitetura que as outras fases herdam, internals do WME (fiber do React, React Query, interceptação de requests), filas assíncronas e bugs sem causa óbvia.
- **Sonnet 5.5**: features e correções com escopo claro, migrações seguindo um padrão já definido, documentação, traduções pelo agente `i18n-translator`.
- **Haiku 5.5**: tarefas mecânicas (git, repetir uma migração já feita num script quase idêntico).
- **Usuário**: tudo que exige o WME logado (capturas no console e teste manual). O modelo indicado ao lado só registra e interpreta o resultado.

Toda fase que mexe em texto de UI usa a skill `i18n`. Toda fase de código termina com `node scripts/check.mjs`, o agente `wme-reviewer` e o teste da skill `test-in-wme`. **Ao final de cada fase, atualize a coluna Status** com o estado em que ela ficou.

---

## Fase 1 — Pesquisa e plano

**Modelo:** Opus 5.5 · **Esforço:** alto · **Status:** ✅ Concluída (2026-10-25)

- Leitura do bundle de produção do WME v2.374: `wz-dialog`, `wz-snackbar`, sininho em React + React Query, `W.map.showConfirmationDialog`, `W.app.showSnackbar`.
- SDK (produção v2.374, beta v2.376): nenhum módulo de diálogo, snackbar ou notificação.
- Reaproveitamento do código dos scripts do autor (`wazeChatPlus.js`: `openDialog`, `showSnackbar`, changelog, i18n e utilitários).
- Decisões do usuário registradas no AGENTS.md §2: só UI nativa, SDK primeiro, filas FIFO, changelog por script (diálogo agrupado ou sininho), fallback do sininho com markup nativo e distribuição via `@require`.

## Fase 2 — Primeira versão da biblioteca

### 2a — Núcleo

**Modelo:** Opus 5.5 · **Esforço:** xhigh · **Status:** 🧪 Implementada (v0.1.0), aguardando teste no WME

Tudo em `wmeAlertSystem.js` (detalhes no AGENTS.md §3):
- bootstrap com singleton entre cópias (a versão mais nova inicia);
- API `register()` e o cliente congelado de cada script;
- fila de diálogos (`wz-dialog`) e fila de snackbars (`wz-snackbar`);
- sininho com estratégia `query` (React Query) e fallback `dom`;
- changelog unificado;
- `map.confirm` e `inline.alert`;
- aba "Alert System".

**Critério de aceite:** checklist da skill `test-in-wme` sem falhas (feito na Fase 5).

### 2b — Traduções

**Modelo:** Sonnet 5.5 (agente `i18n-translator`) · **Esforço:** baixo · **Status:** 🧪 Implementada

- 28 chaves em 44 idiomas. en-AU e en-GB usam o `default`.
- Falta a revisão de pt-BR, pt-PT e es pelo usuário e conferir os textos no navegador.

### 2c — Ferramentas e contexto

**Modelo:** Sonnet 5.5 · **Esforço:** médio · **Status:** ✅ Concluída

- `scripts/check.mjs` e `scripts/i18n.mjs`.
- Hook PostToolUse, agentes (`wme-reviewer`, `wme-sdk-researcher`, `i18n-translator`) e skills (`i18n`, `test-in-wme`).
- AGENTS.md, CLAUDE.md, readme.md e `examples/consumer.user.js`.

## Fase 3 — Confirmar e ajustar os internals do WME

### 3a — Captura no console (Passo 0)

**Modelo:** usuário (captura) + Sonnet 5.5 (registro) · **Esforço:** baixo · **Status:** ✅ Concluída (2026-10-25)

O usuário roda o snippet do AGENTS.md §4 no WME logado e cola a saída:
1. Onde está o `QueryClient` e qual o formato de `getQueryData(['notifications'])`, com um item completo.
2. Qual `type` exibe título, mensagem, remetente e botão. Hoje a lib usa `COUNTRY_MEETUP`.
3. Qual campo controla o contador (lida/não lida) e o que acontece com o item injetado num refetch.
4. As requisições de exclusão e de leitura, vistas na aba Network ao clicar na lixeira e ao abrir a notificação.
5. O formato de `lonLat` aceito por `W.map.showConfirmationDialog`.

O modelo registra os resultados no AGENTS.md §4 e remove a lista de pendências.

**Critério de aceite:** os 5 pontos respondidos e registrados.

### 3b — Ajuste do código

**Modelo:** Opus 5.5 · **Esforço:** alto · **Status:** 🧪 Implementada (2026-10-25), aguardando teste no WME

Feito:
- `nativeNotification` (`type: 'COUNTRY_MEETUP'`, `requestPattern`), `readNativeList` e `toNativeNotification` já batiam com a captura: só a documentação mudou (o cache é um array puro).
- Sem estado de "lida", como no sininho nativo: saíram `isRead`, `markNotificationRead` e `getUnreadCount`. O contador do fallback `dom` passou a ser o nº de itens (`getNotificationCount`), e `notification.list()` não devolve mais `isRead`.
- `onOwnNotificationRequest` só age no DELETE; o resto é só respondido.
- `confirmOnMap`: `lonLat` validado (números finitos, dentro de `Map.getMapExtent()`); ponto inválido ou fora da tela → `dialog.confirm`, porque o WME não mostra nada e a promessa nunca resolve.

Falta (só no WME com a biblioteca carregada):
- Se o React Query não for alcançável, confirmar que o fallback `dom` assume e que o seletor do popup está certo.

**Critério de aceite:**
- A notificação injetada aparece no sininho nativo, com contador e detalhes.
- Ela sobrevive a refetch e reload.
- A lixeira não gera DELETE real ao servidor.

## Fase 4 — Revisão do código

**Modelo:** Opus 5.5 · **Esforço:** alto · **Status:** ✅ Concluída (2026-10-25)

Agente `wme-reviewer` sobre o arquivo inteiro, mais as correções. Pontos de atenção:
- promessas que nunca resolvem e filas que travam;
- a escolha da versão no singleton quando os scripts carregam fora de ordem;
- a interceptação de `fetch`/XHR afetando requisições que não são nossas;
- vazamento de estado interno pelo cliente;
- escape de HTML.

**Critério de aceite:** nenhum achado crítico aberto; `node scripts/check.mjs` limpo.

Feito (1ª passada: 1 alto, 9 médios, 13 baixos; 2ª passada sobre as correções: 3 médios e 6 baixos, todos corrigidos):
- **`ready()` sempre resolve:** espera do `SDK_INITIALIZED` sem prazo (antes eram 12 s); cada etapa do `initialize` no seu próprio `try`; se a cópia mais nova lançar ao ser criada, a próxima mais nova assume.
- **Filas:**
  - diálogo fechado antes de aparecer não é mais exibido;
  - actions que não são objeto são ignoradas;
  - watchdogs (`watchActiveDialog`, `watchActiveSnackbar`) liberam a fila quando o elemento sai da página;
  - falha ao mostrar um snackbar não trava mais a fila;
  - o observer do snackbar acompanha o elemento recriado.
- **Notificações:**
  - id completo `was-<scriptId>.<id>`, sem colisão entre scripts;
  - `data` guardado e devolvido como cópia JSON (`TypeError` se não serializável);
  - `list()` sem itens expirados.
- **Changelog:**
  - `loader` com timeout de 15 s;
  - falha no carregamento não marca a versão como vista;
  - o botão do sininho mostra todas as versões desde a última vista.
- **Interceptação:** `fetch(new URL(...))` reconhecido; XHR reaproveitado volta ao normal (e só os que respondemos).
- **Singleton:**
  - `__wmeAlertSystem` não guarda mais o core (só com `devVersion`) e não é enumerável;
  - `isVersionGreater` entende `v` inicial e pré-release;
  - `scriptId` `__proto__` recusado; `Object.hasOwn` nos mapas por script;
  - storage corrompido não quebra o `register()`.

Ficou para o teste no WME (AGENTS §4 "Pending" e checklist da skill `test-in-wme`):
- se o sininho nativo e o balão do mapa renderizam o texto como HTML;
- se o botão do item nativo é um `<a>`;
- se mexer no mapa fecha o balão sem resolver a promessa;
- a origem do `closeSnackbars`;
- a ordem de carga de dois consumidores com versões diferentes.

## Fase 5 — Teste no WME

### 5a — Teste manual

**Modelo:** usuário (teste) + Sonnet 5.5 (roteiro e registro) · **Esforço:** baixo · **Status:** ✅ Concluída (2026-10-25)

Checklist completo da skill `test-in-wme`:
- WME de produção e Beta, tema claro e escuro;
- dois consumidores com versões diferentes da biblioteca;
- idiomas pt-BR, es e ar.

### 5b — Correções

**Modelo:** Opus 5.5 · **Esforço:** alto · **Status:** ✅ Concluída (2026-10-25)

Corrigir o que falhar na 5a e repetir só as seções afetadas do checklist.

Feito (decisões do usuário em 2026-10-25):
- **RTL:** diálogos com × ganham `padding-right: 24px` no `wz-dialog-header`. Medido no Beta: o × fica a 16–40 px da borda direita nas duas direções, e o título agora termina a 48 px dela. O seletor é `[dismissible]:not([dismissible="false"])`, porque o Stencil reflete o atributo vazio.
- **Aba oculta:** não contornado, só documentado no readme e no AGENTS §3. A promessa já resolve na hora.
- **`alarming` no `map.confirm`:** removido da API, já que o balão ignora. O readme indica `dialog.confirm(…, { alarming: true })` para botão vermelho.
- **Idioma das notificações:**
  - os textos da lib (aviso de changelog, botão "Abrir" padrão) guardam `textKeys` e são traduzidos na exibição (`getNotificationText`);
  - os textos dos scripts ficam como vieram;
  - chave desconhecida ou placeholder faltando → usa o texto guardado.
  - O `check.mjs` também valida as chaves de `textKeys`.
- **`wme-reviewer`** (inclui o `map.confirm` sem `lonLat` da 5a): nenhum achado bloqueante. Corrigido:
  - fallback do `getNotificationText`;
  - assinatura da mesclagem com botão/link/timestamp;
  - log do `map.confirm` quando o método falta;
  - centro do mapa validado como um `lonLat` explícito.
- **Conferido ao vivo no Beta v2.376-1** (métodos novos aplicados ao core rodando, sem reload):
  - medidas do RTL e do LTR, e o caso sem ×;
  - retradução en → pt-BR no cache nativo;
  - `alarming` não repassado;
  - centro do mapa sem promessa;
  - mesclagem sem loop.
- **Checklist (seções afetadas) no Beta v2.376-1**, código novo carregado pelo Tampermonkey e cliques reais via CDP: 21/21.
  - Diálogos: fila em ordem; OK, × e Esc; confirm true/false; `close(id)` antes de aparecer; "Sent by".
  - i18n: ar com RTL (título termina antes do ×), pt-BR e es; aviso de changelog en → es no sininho.
  - Extras: balão do mapa (aplicar, cancelar, 2ª chamada, fora da tela → diálogo, conteúdo como texto) e `inline.alert`.
  - Não reproduzido: diálogo nativo do WME aberto com o nosso na fila (ficou no `@TODO` do arquivo).

**Critério de aceite:** checklist inteiro aprovado pelo usuário.

## Fase 6 — Git

**Modelo:** Haiku 5.5 · **Esforço:** baixo · **Status:** ⏳ Pendente (só com OK do usuário)

- `git init`, `.gitignore`, primeiro commit em pt-BR, branch `development` para o trabalho e `main` para as versões publicadas.
- Depois disso, adotar as skills `finish-change` e `release` dos outros projetos, adaptadas.

## Fase 7 — Primeira versão pública

### 7a — Changelog da biblioteca

**Modelo:** Sonnet 5.5 · **Esforço:** baixo · **Status:** ✅ Concluída

Decisão do usuário (2026-10-25): a biblioteca **não** avisa o usuário final das próprias atualizações (quem a consome são os scripters, o usuário não precisa saber dela). Sem npoint e sem auto-registro; o histórico fica no repositório.

- `CHANGELOG.md` na raiz (formato Keep a Changelog, em inglês como o `readme.md`, para os scripters), com uma seção por versão; mudanças que quebram a API pública marcadas como **Breaking**.
- `check.mjs` passa a validar que existe uma seção para a versão atual (`VERSION`).
- Remover do `AGENTS.md`/`CLAUDE.md` qualquer menção a changelog próprio da lib, se houver, e listar o `CHANGELOG.md` na tabela de arquivos do `AGENTS.md` §1.

### 7b — Release 1.0.0

**Modelo:** Sonnet 5.5 · **Esforço:** baixo · **Status:** ⏳ Pendente (publicação feita pelo usuário)

- `devVersion = false` e `node scripts/check.mjs --release`.
- Versão 1.0.0 no cabeçalho e no `VERSION`.
- Publicação no Greasy Fork como biblioteca.
- Anotar no readme a URL versionada do `@require`.

**Critério de aceite:** um script de teste com o `@require` publicado funciona no WME.
