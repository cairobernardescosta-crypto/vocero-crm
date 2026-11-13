# Plano

1. Tabelas aditivas por organização para estado, chats e mensagens.
2. Adaptador carregado somente com a flag ativa.
3. API autenticada e eventos SSE existentes.
4. Página e uma única entrada condicional na navegação.
5. Validar flag, isolamento, tipos, lint e build.

## Decisão arquitetural local

Nesta instalação Windows de processo único, o adaptador usa o processo Node persistente do Next e autenticação em diretório por organização. A instrumentação recupera sessões conectadas no boot e uma trava consultiva no PostgreSQL impede duas instâncias, inclusive entre processos. Isso evita IPC e um segundo serviço sem perder as garantias operacionais locais. O CRM continua funcional quando o adaptador falha. Antes de escalar horizontalmente, o conector deve ser extraído para um único processo dedicado.
