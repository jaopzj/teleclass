# Autenticação: contas, sessões e vínculo do Telegram

Duas autenticações independentes:

| | Plataforma (Teleaula) | Telegram |
|---|---|---|
| Para quê | Saber quem está usando (progresso, anotações) | Ler canais e tocar vídeos |
| Credencial | Usuário + senha | Telefone + código (+ senha 2FA) |
| Onde fica | `users` (hash scrypt) e `auth_sessions` (SHA-256 do token) em `data/teleaula.db` | `data/sessions/<id do usuário>.session` (Telethon) e `telegram_accounts` |
| Duração | Cookie de 30 dias, renovado com o uso | Até ser encerrada no Telegram ou desvinculada |

Sair do Teleaula **não** desconecta o Telegram. Desvincular o Telegram **não** apaga a conta.

## Fluxo na interface

1. **Conta**: nome de usuário (com checagem de disponibilidade) e senha. Ao criar, a pessoa já fica logada.
2. **Telefone**: país + número, normalizado para E.164 (`+5511912345678`).
3. **Código**: a tela segue o método que o Telegram escolheu (app, SMS, ligação, palavra/frase por SMS, e-mail, Fragment...). Reenvio com contagem regressiva, usando o próximo método oferecido.
4. **Senha 2FA**: só aparece se a conta do Telegram tiver verificação em duas etapas (mostra a dica, se houver).
5. **Pronto**: conta vinculada.

Se o cadastro for interrompido, a pessoa volta ao telefone no próximo login (ou à etapa do código, se o fluxo ainda estiver ativo). Se o Telegram revogar a sessão, a API responde `telegram_reauth_required` e o app leva à reconexão.

## Erros

Todas as rotas respondem erros como:

```json
{ "detail": "mensagem para a pessoa", "code": "codigo_estavel", "field": "campo", "retry_after": 120 }
```

`field` e `retry_after` são opcionais. Códigos principais:

| code | HTTP | Quando |
|---|---|---|
| `not_authenticated` | 401 | Sem sessão válida |
| `invalid_credentials` | 401 | Usuário ou senha errados (mesma resposta nos dois casos) |
| `invalid_username`, `weak_password` | 422 | Regras de cadastro |
| `username_taken` | 409 | Nome em uso |
| `rate_limited` | 429 | Muitas tentativas (`retry_after` em segundos) |
| `invalid_phone` | 422 | Formato inválido ou recusado pelo Telegram |
| `phone_in_use` | 409 | Telefone já vinculado a outro usuário |
| `telegram_in_use` | 409 | Conta do Telegram já vinculada a outro usuário |
| `code_format` / `code_invalid` | 422 | Código fora do formato / incorreto (`attempts_left`) |
| `code_expired` | 410 | Código expirou: pedir outro |
| `password_invalid` | 422 | Senha 2FA incorreta (`attempts_left`) |
| `too_many_attempts` | 429 | 5 códigos ou senhas erradas: o fluxo é encerrado |
| `link_expired` | 410 | Fluxo inexistente ou parado há mais de 10 min |
| `resend_too_soon` / `resend_limit` | 429 | Reenvio antes da hora / reenvios esgotados |
| `telegram_flood_wait` / `telegram_flood` | 429 | Limite imposto pelo Telegram |
| `phone_not_registered` | 422 | Número sem conta no Telegram |
| `email_setup_required` | 422 | O Telegram exige e-mail de login configurado no app oficial |
| `telegram_timeout` | 504 | O Telegram não respondeu em 25 s |
| `telegram_unavailable` | 503 | Sem conexão com o Telegram |
| `telegram_not_configured` | 503 | `TG_API_ID`/`TG_API_HASH` ausentes ou inválidos |
| `telegram_not_linked` | 409 | Usuário ainda sem Telegram vinculado |
| `telegram_reauth_required` | 401 | Sessão do Telegram revogada ou ausente |

## Endpoints

### Plataforma (`/api/auth`)

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/api/auth/session` | | `{user, telegram}` (ambos `null` sem login) |
| GET | `/api/auth/username-availability?username=` | | `{username, available, reason}` |
| POST | `/api/auth/register` | `{username, password}` | 201 `{user, telegram}` + cookie |
| POST | `/api/auth/login` | `{username, password}` | `{user, telegram}` + cookie novo |
| POST | `/api/auth/logout` | | 204, apaga a sessão e o cookie |
| GET | `/api/auth/me` | | `{user, telegram}` (401 sem login) |

### Telegram (`/api/telegram`, exige login)

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/api/telegram/status` | | `TelegramStatus` |
| POST | `/api/telegram/link/phone` | `{phone}` | `LinkFlow` (etapa `code`) |
| POST | `/api/telegram/link/resend` | | `LinkFlow` |
| POST | `/api/telegram/link/code` | `{code}` | `LinkFlow` (etapa `password`) ou `{step: "done", account}` |
| POST | `/api/telegram/link/password` | `{password}` | `{step: "done", account}` |
| DELETE | `/api/telegram/link` | | 204, descarta o fluxo |
| POST | `/api/telegram/unlink` | `{password}` (senha do Teleaula) | `TelegramStatus` |

```ts
TelegramStatus = { configured, linked, needs_reauth, account: {name, username, phone, linked_at} | null, flow: LinkFlow | null, fast_crypto }
LinkFlow = { step: "code" | "password", phone /* mascarado */, delivery: {method, input, length, ...},
             next_method, can_resend, resend_in, code_expired, attempts_left, password_hint, expires_in }
```

`delivery.input`: `digits` (com `length`), `text` (palavra/frase do SMS), `phone` (número que ligou) ou `phone_tail` (últimos dígitos).

## Segurança

- **Senhas** em scrypt (N=2^14, r=8, p=1, sal de 16 bytes); login com usuário inexistente gasta o mesmo tempo (hash fictício) e responde a mesma mensagem.
- **Sessão** em cookie `HttpOnly`, `SameSite=Strict` (`Secure` sob HTTPS). O banco guarda só o SHA-256 do token. Login gera um token novo; logout o apaga.
- **CSRF**: além do `SameSite`, pedidos que alteram dados com `Origin` de outro site recebem 403.
- **Limites**: login (8 falhas por usuário+IP e 30 por IP em 15 min), cadastro (5 por IP por hora), disponibilidade de nome (60/min), pedidos de código (5 por usuário em 15 min), 5 códigos ou senhas 2FA erradas por fluxo, reenvio só depois do prazo do Telegram, desvincular (5 senhas erradas em 15 min).
- **Fluxo do Telegram** preso ao usuário logado (um usuário não enxerga nem conclui o fluxo de outro), em memória (`StringSession`) até concluir, com expiração de 10 min sem atividade. O `phone_code_hash`, o código e a senha 2FA nunca voltam ao navegador nem vão para logs.
- **Telefone** guardado só como HMAC-SHA256 (chave em `data/secret.key`, criada na primeira execução) e em versão mascarada.
- **Vínculo único**: um telefone e uma conta do Telegram pertencem a no máximo um usuário. Se a conta já for de outro usuário, a autorização recém-criada é encerrada no Telegram.
- **Arquivos de sessão** com permissão 600 (em sistemas que suportam) em `data/sessions/`, que está no `.gitignore`.

## Biblioteca de cursos e streaming

Os snapshots (`data/snapshots/`) continuam compartilhados: todos os usuários veem a mesma biblioteca. Os vídeos tocam pela conta do Telegram de cada usuário, então só tocam para quem participa do canal. O cache de trechos (memória e `data/cache/`) é compartilhado, mas antes de servir qualquer trecho a rota confere com o cliente do próprio usuário se ele acessa a mensagem.

## Migração do login pelo terminal

- `python -m app.cli login` foi removido. `data/teleaula.session` não é mais usado e pode ser apagado depois de vincular pela interface.
- A primeira conta criada herda o progresso e as anotações gravados antes do login (usuário `local`).
- `python -m app.cli collect <link> --user <nome>` usa o Telegram vinculado a esse usuário.

## Evoluções previstas

O desenho já acomoda: recuperação/troca de senha (`UserStore` + `SessionStore.revoke_all`), troca de telefone e revinculação (o mesmo fluxo substitui a sessão), desvinculação (já existe) e login por QR code do Telegram (`client.qr_login()`, como alternativa à etapa do telefone).
