# 027 — Conector Baileys opcional (fork local)

## Problema e comportamento

Com `BAILEYS_ENABLED=on`, usuários autenticados veem uma única entrada **Baileys / WhatsApp Web**, podem parear por QR, consultar conversas persistidas e enviar manualmente texto. Sem a flag, UI e API respondem como inexistentes.

## Critérios de aceitação

- Sessão isolada por organização e persistida em `BAILEYS_DATA_DIR`.
- Eventos deduplicados por organização + ID do provedor.
- API autenticada; conectar/desconectar exige papel configurador.
- Falha do conector não afeta CRM nem Meta.
- Nenhum envio automático, broadcast ou teste real.

## Fora de escopo

Mídias, automações, campanhas e unificação com a Bandeja oficial.

## Constitution check e divergência

Baileys é opcional, desligado por padrão e isolado, mas diverge da regra original de `AGENTS.md` que admite somente a API oficial. Esta é uma decisão explícita do fork; não se afirma conformidade integral com a política upstream. Permanecem obrigatórios isolamento, idempotência, autenticação e ausência de automação.
