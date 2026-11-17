# Matriz de capacidades do WhatsApp no CRM

Baseline auditada em 15/11/2026. A implementação Baileys usa `@whiskeysockets/baileys` **6.7.24** (`package.json:36`). Esta matriz descreve o que o CRM executa hoje; a existência de um tipo ou método no SDK não conta como implementação.

## Legenda

- **APROVADA**: fluxo existente e coberto por evidência local; quando não há teste real, isso é indicado.
- **PARCIAL**: existe, mas não cobre todo o comportamento ou depende do histórico entregue pelo WhatsApp.
- **NÃO IMPLEMENTADA**: o SDK pode oferecer meios, porém o CRM não implementa o fluxo.
- **NÃO SUPORTADA**: indisponível ou deliberadamente ignorada no conector atual.
- **NÃO TESTADA**: não houve validação real autorizada de ponta a ponta.

## Matriz auditada

| Funcionalidade | Baileys no CRM | Cloud API no CRM | Evidência e limite |
|---|---|---|---|
| QR e conexão | APROVADA no código; NÃO TESTADA em E2E nesta baseline | Não se aplica ao pareamento Baileys | `src/server/baileys/connector.ts:399-418,509-516`; UI em `src/components/baileys/baileys-client.tsx:74-77,106` |
| Sessão cifrada | APROVADA | Credenciais cifradas em fluxo próprio | `src/server/baileys/auth-state.ts:34-110`; `tests/unit/baileys-auth-state.test.ts` |
| Reconexão exponencial | APROVADA no código; NÃO TESTADA com queda real | Não auditada nesta fase | `src/server/baileys/connector.ts:536-555` |
| Recuperação após reinício | APROVADA no código; NÃO TESTADA em E2E | Não auditada nesta fase | `src/server/baileys/connector.ts:609-630` |
| Histórico inicial | PARCIAL | Não auditada nesta fase | `messaging-history.set` em `src/server/baileys/connector.ts:446-506`; limitado ao histórico que o WhatsApp entrega ao dispositivo vinculado |
| Recebimento de texto ao vivo | APROVADA no código; NÃO TESTADA até a UI com dispositivo real | Fluxo existente fora deste baseline | `messages.upsert` usa persistência idempotente, retry limitado e log sanitizado; o refresh SSE agora expõe falha e retry na interface |
| Envio de texto | APROVADA no código; NÃO TESTADA com destinatário autorizado | Implementada em fluxo separado | `src/server/baileys/connector.ts:632-667`; API aceita texto em `src/app/api/baileys/route.ts:14-19` |
| Deduplicação | APROVADA para `provider_id` | Existente em modelos próprios | Índice único em `src/lib/db/schema.ts:1472-1474`; inserção idempotente em `src/server/baileys/connector.ts:349-369` |
| Ordem cronológica | APROVADA no backend | Não auditada nesta fase | Ordenação do histórico em `src/server/baileys/connector.ts:488-492`; atividade protegida por timestamp em `:371-378` |
| Imagem, áudio, vídeo, documento e figurinha recebidos | PARCIAL | Implementação própria fora deste baseline | Download/armazenamento em `src/server/baileys/connector.ts:297-339`; renderização em `src/components/inbox/message-thread.tsx:67-190`; mídia histórica sem chave pode ficar indisponível |
| Envio de mídia e áudio | APROVADA no código para imagem, vídeo, áudio/voz e documento; NÃO TESTADA em E2E | Existe em rotas/componentes da API oficial | Endpoint multipart reutiliza validação, converte WebM de voz para Ogg e envia payloads nativos; sticker/GIF continuam ocultos |
| GIF específico | NÃO IMPLEMENTADA | Não auditada nesta fase | O conector não distingue GIF de vídeo |
| Estados enviada/entregue/lida | APROVADA no código; NÃO TESTADA em E2E | Existe em fluxo próprio, fora deste baseline | Listeners `messages.update` e `message-receipt.update` atualizam apenas mensagens de saída, com progressão monotônica; `tests/unit/baileys-receipts.test.ts` |
| Marcar como lida | APROVADA no código; NÃO TESTADA em E2E | Não auditada nesta fase | Quando conectado, chama `readMessages` para mensagens recebidas recentes e depois zera o contador local |
| Resposta citada/encaminhamento | NÃO IMPLEMENTADA | Implementada em componentes da bandeja oficial | `quotable=false` e ausência de handlers em `src/components/baileys/baileys-client.tsx:30,104` |
| Reações, edição e exclusão remota | NÃO IMPLEMENTADA | Não auditada nesta fase | Reações/protocol messages são descartadas em `src/server/baileys/message-content.ts:29-38` |
| Contatos, nome e foto | PARCIAL | Não auditada nesta fase | `contacts.upsert` e `profilePictureUrl` em `src/server/baileys/connector.ts:91-116,425-432`; foto remota sem cache local |
| Grupos, título, foto e participantes | PARCIAL | Grupos não são equivalentes ao fluxo Cloud API | Eventos atualizam metadados e o painel exibe foto, título, membros enriquecidos e papéis; descrição e ações administrativas não foram implementadas |
| Atualizações de grupo/participantes | APROVADA no código; NÃO TESTADA em E2E | Não auditada nesta fase | Listeners `groups.upsert`, `groups.update` e `group-participants.update` atualizam título, foto, participantes e admins; descrição ainda não possui campo persistente |
| Localização e contato compartilhado | NÃO IMPLEMENTADA; fallback de conteúdo não suportado | Não auditada nesta fase | `src/server/baileys/message-content.ts:57-65` |
| Arquivar, fixar e silenciar | NÃO IMPLEMENTADA | Não auditada nesta fase | Sem campos, handlers ou ações Baileys no CRM |
| Busca e filtros básicos | PARCIAL | APROVADA na bandeja principal | Busca/não lidas reutilizam `ConversationList`; sem busca paginada no conteúdo das mensagens |
| Paginação/virtualização | PARCIAL | Não auditada nesta fase | Paginação keyset implementada para chats (50) e mensagens (100), com desempate por ID e mesclagem no frontend; virtualização ainda não foi implementada |
| Pipeline/etapas CRM | APROVADA, local | APROVADA, local | `set_stage` em `src/server/baileys/connector.ts:681-701`; não é função remota do WhatsApp |
| Etiquetas, notas e responsável CRM | PARCIAL no modo Baileys | Implementadas na bandeja principal | Recursos comerciais são locais e não devem ser apresentados como dados do WhatsApp |
| Status, canais e comunidades | NÃO SUPORTADA pela implementação atual | NÃO IMPLEMENTADA neste CRM | Status/newsletters são ignorados em `src/server/baileys/connector.ts:82-84`; nenhum controle deve ser exibido |
| Chamadas e videoconferência | NÃO SUPORTADA pela implementação atual | NÃO IMPLEMENTADA | Sem evento, persistência ou ação funcional no CRM |
| Enquetes e eventos | NÃO IMPLEMENTADA | NÃO IMPLEMENTADA | Sem handlers e sem modelo persistente; não exibir controles |
| Teste real ponta a ponta | NÃO TESTADA | Testes existentes usam mock | Não há teste Baileys com dispositivo real, destinatário autorizado, QR, mídia, grupo ou SSE completo |

## Prioridades confirmadas

### P0 — integridade e experiência básica

1. **Implementado:** não ocultar o histórico persistido quando a conexão estiver offline; exibir aviso de reconexão sem esvaziar a lista.
2. **Implementado:** não engolir falhas de `messages.upsert` ou de refresh SSE; registrar erro sanitizado e oferecer recuperação segura.
3. **Implementado:** separar “envio remoto confirmado” de “falha ao persistir localmente” para evitar reenvio humano e duplicação.
4. Homologar recebimento → persistência → SSE → tela aberta com dispositivo e conversa autorizados.

### P1 — recursos suportáveis após o P0

1. **Implementado no código; E2E pendente:** recibos via eventos reais e marcação remota como lida.
2. **Parcialmente implementado:** atualizações de grupos/participantes; nomes dos membros e descrição persistente continuam pendentes.
3. **Implementado:** paginação incremental de chats/mensagens; virtualização continua pendente.
4. **Implementado no código; E2E pendente:** envio de imagem, vídeo, áudio/voz e documento com validação, persistência e retry idempotente.
5. Retry/checkpoint de histórico e mídia sem chave, sem apagar ou reinicializar sessão.

### P2 — acabamento e desempenho

1. Painel de detalhes de contato/grupo e cache protegido de avatar.
2. Acessibilidade da busca, retorno de foco e estados de erro/retry.
3. Arquivar/fixar/silenciar, resposta citada, encaminhamento e busca interna somente após provar suporte remoto e backend completo.

## Testes e evidências pendentes

Os testes automatizados atuais cobrem autenticação cifrada e extração básica de conteúdo (`tests/unit/baileys-auth-state.test.ts`, `tests/unit/baileys-message-content.test.ts`). Os scripts E2E existentes utilizam `/api/dev/wa-mock` e **não comprovam Baileys**. Permanecem obrigatoriamente **NÃO TESTADOS** até execução autorizada:

- recebimento ao vivo sem recarregar;
- atualização simultânea da lista e da conversa aberta;
- envio real para conversa de teste autorizada;
- mídia recebida e exibida;
- grupo, participantes e foto;
- queda/reconexão e reinício do backend;
- ausência de duplicatas após reconexão.

Referência técnica do evento de mensagens: documentação oficial do Baileys, `messages.upsert`, que exige processar todos os itens do array: <https://github.com/WhiskeySockets/baileys.wiki-site/blob/main/docs/socket/receiving-updates.md>.
