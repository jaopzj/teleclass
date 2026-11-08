# Hospedar o TeleClass na Oracle Cloud (grátis)

Este guia coloca o TeleClass na internet, com HTTPS, numa máquina virtual
**Always Free** da Oracle Cloud, para você e seus amigos usarem de qualquer
lugar. Não precisa saber Linux: é só copiar e colar os comandos na ordem.

O que você vai ter no fim:

- Uma VM ARM (Ampere) ligada 24 horas, de graça.
- O TeleClass rodando com o mesmo `docker compose` do seu PC.
- Um endereço tipo `https://meuteleclass.duckdns.org`, com certificado
  automático (Let's Encrypt, pelo Caddy).
- Cadastro protegido por um **código de convite**, para só seus amigos criarem conta.

Tempo estimado: 40 minutos a 1 hora (a maior parte é esperar a Oracle).

> **Antes de começar, saiba disto.** Cada pessoa vincula a própria conta do
> Telegram, e o arquivo de sessão dela fica salvo no servidor (`data/sessions/`).
> Quem tiver acesso ao servidor tem acesso a essas contas. Por isso: só convide
> gente de confiança, guarde bem a chave SSH e nunca publique a pasta `data/`.

---

## 1. Criar a conta na Oracle Cloud

1. Acesse <https://signup.cloud.oracle.com> e crie a conta.
2. Ela pede um cartão de crédito só para verificar identidade. Uma cobrança
   pequena pode aparecer e é estornada. Contas **Always Free** não são cobradas.
3. Em **Home Region** (região principal), escolha com calma: não dá para trocar
   depois, e a VM grátis só pode ser criada nela. Para quem está no Brasil,
   **Brazil East (São Paulo)** ou **Brazil Southeast (Vinhedo)** dão menos
   atraso. Se uma região estiver sempre sem capacidade (ver passo 2), outras
   regiões costumam ter mais vagas, mas a escolha é definitiva.
4. Espere o e-mail dizendo que a conta está pronta (pode levar alguns minutos).

**Dica:** depois de alguns dias, considere mudar a conta para **Pay As You Go**
(em *Billing → Upgrade and Manage Payment*). Os recursos Always Free continuam
grátis, e contas assim quase nunca ficam sem capacidade nem têm a VM recolhida
por inatividade. Só não crie nada fora do Always Free.

## 2. Criar a máquina virtual

No painel da Oracle: menu ☰ → **Compute** → **Instances** → **Create instance**.

| Campo | O que escolher |
|---|---|
| Name | `teleclass` |
| Image | Clique em *Change image* → **Canonical Ubuntu 24.04** (a versão comum, não a "Minimal") |
| Shape | *Change shape* → **Ampere** → **VM.Standard.A1.Flex**, com **2 OCPUs e 12 GB** de memória (cabe folgado no grátis, que vai até 4 OCPUs e 24 GB) |
| Networking | Deixe criar a rede nova (VCN) e marque **Assign a public IPv4 address** |
| Add SSH keys | **Generate a key pair for me** → clique em **Save private key** e guarde o arquivo `.key` num lugar seguro |
| Boot volume | Marque *Specify a custom boot volume size* e coloque **100 GB** (o grátis permite 200 GB no total) |

Clique em **Create**. Quando ficar verde (*Running*), anote o **Public IP address**.

### "Out of capacity for shape VM.Standard.A1.Flex"

É comum: a VM ARM grátis é disputada. O que costuma resolver:

- Tente outro **Availability Domain** (AD-1, AD-2, AD-3) na seção *Placement*, se a região tiver mais de um.
- Peça menos: **1 OCPU e 6 GB** já rodam o TeleClass para alguns amigos. Dá para aumentar depois (*Edit → Shape*).
- Tente de novo em outro horário (madrugada e manhã cedo costumam funcionar).
- Faça o upgrade para **Pay As You Go** (ver o fim do passo 1).
- Último recurso: a **VM.Standard.E2.1.Micro** (AMD, também grátis) funciona, mas
  tem só 1 GB de RAM. Nela, crie a memória extra do passo 4 antes de compilar.

## 3. Abrir as portas 80 e 443

São duas barreiras: a da Oracle (na nuvem) e a do próprio Ubuntu.

### 3a. Na Oracle (Security List)

1. Na página da instância, clique no nome da **Subnet** (em *Primary VNIC*).
2. Clique na **Security List** (algo como *Default Security List for vcn-...*).
3. **Add Ingress Rules** e adicione duas regras:

| Source CIDR | IP Protocol | Destination Port Range | Para quê |
|---|---|---|---|
| `0.0.0.0/0` | TCP | `80` | Pedido do certificado HTTPS |
| `0.0.0.0/0` | TCP | `443` | O site |

A porta 22 (SSH) já vem aberta. **Não abra a 8000**: ela fica só dentro do servidor.

### 3b. Entrar no servidor por SSH

No Windows, abra o **PowerShell** na pasta onde salvou a chave:

```powershell
# Só na primeira vez: deixa a chave legível só para você (o SSH exige)
icacls .\ssh-key-*.key /inheritance:r /grant:r "$($env:USERNAME):R"

ssh -i .\ssh-key-*.key ubuntu@SEU_IP_PUBLICO
```

Responda `yes` na primeira vez. Os próximos comandos são todos **dentro do servidor**.

### 3c. No firewall do Ubuntu

As imagens da Oracle já vêm com regras de `iptables` que bloqueiam quase tudo.
Libere 80 e 443 e salve:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p udp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

> Não use `ufw` nessas imagens: ele briga com as regras da Oracle e pode
> trancar você fora do SSH.

## 4. Preparar o servidor

```bash
# Atualiza o sistema
sudo apt update && sudo apt -y upgrade

# Fuso horário (as métricas de estudo usam o fuso do navegador, mas os logs ficam mais legíveis)
sudo timedatectl set-timezone America/Sao_Paulo

# 4 GB de memória extra em disco (swap): evita travar ao compilar o frontend
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Atualizações de segurança automáticas
sudo apt -y install unattended-upgrades
```

### Instalar o Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit
```

Entre de novo pelo SSH (o `exit` é para o grupo `docker` valer) e confira:

```bash
docker run --rm hello-world
docker compose version
```

## 5. Pegar um domínio grátis (DuckDNS)

O HTTPS precisa de um nome, não só de um IP.

1. Acesse <https://www.duckdns.org> e entre com sua conta do Google ou GitHub.
2. Em **sub domain**, escolha um nome (ex.: `meuteleclass`) e clique em **add domain**.
3. No campo **current ip**, coloque o **IP público** da VM e clique em **update ip**.

Pronto: `meuteleclass.duckdns.org` aponta para o servidor. O IP público da
Oracle não muda enquanto a VM existir, então não precisa de atualização automática.

Confira no servidor (deve mostrar o IP da VM):

```bash
getent hosts meuteleclass.duckdns.org
```

## 6. Baixar e configurar o TeleClass

```bash
git clone https://github.com/jaopzj/teleclass.git
cd teleclass
cp .env.example .env
nano .env
```

> Se o repositório for privado, o `git clone` vai pedir usuário e senha. Use
> seu usuário do GitHub e, como senha, um **token**: crie em GitHub →
> *Settings → Developer settings → Personal access tokens → Fine-grained tokens*,
> só com acesso de leitura (*Contents: Read-only*) ao repositório `teleclass`.

No `nano`, deixe o `.env` assim (setas para andar, **Ctrl+O** e **Enter** para
salvar, **Ctrl+X** para sair):

```ini
TG_API_ID=123456                         # os mesmos do seu PC (https://my.telegram.org)
TG_API_HASH=abcdef...
TELEAULA_DATA_DIR=./data

TELEAULA_DOMAIN=meuteleclass.duckdns.org # o domínio do passo 5
TELEAULA_INVITE_CODE=escolha-um-codigo   # quem for criar conta precisa digitar isto
```

Sobre o **código de convite**: com `TELEAULA_INVITE_CODE` definido, a tela de
cadastro mostra o campo *Código de convite* e só cria a conta com o código
certo. Mande o código para os amigos por mensagem. Quem já tem conta entra
normalmente, sem código. Para trocar o código, edite o `.env` e rode
`docker compose --profile https up -d`.

Proteja o arquivo, que tem a chave da API do Telegram:

```bash
chmod 600 .env
```

## 7. (Opcional) Levar seus dados do PC para o servidor

Pule se quiser começar do zero no servidor. Se quiser levar sua conta, cursos,
progresso, anotações e tempo de estudo:

1. **No PC**, pare o TeleClass para o banco não mudar durante a cópia
   (`docker compose down` na pasta `D:\Projetos\teleclass`).
2. **No PC**, compacte a pasta `data` sem o cache de vídeo (ele é grande e se refaz sozinho).
   No PowerShell, na pasta do projeto:

   ```powershell
   tar -czf teleclass-data.tgz --exclude=data/cache data
   ```

3. **No PC**, envie pelo SSH (é criptografado; nunca mande essa pasta por
   e-mail, Drive ou mensagem, porque ela contém a sessão do seu Telegram):

   ```powershell
   scp -i .\ssh-key-*.key teleclass-data.tgz ubuntu@SEU_IP_PUBLICO:~/teleclass/
   ```

4. **No servidor**, antes do primeiro `docker compose up`:

   ```bash
   cd ~/teleclass
   tar -xzf teleclass-data.tgz && rm teleclass-data.tgz
   chmod 700 data/sessions && chmod 600 data/sessions/* data/secret.key
   ```

5. **No PC**, apague o `teleclass-data.tgz`.

**Importante:** uma sessão do Telegram não deve ser usada em dois lugares ao
mesmo tempo. Depois de migrar, use só o servidor (ou, se voltar a rodar no
PC, desvincule e vincule o Telegram de novo por lá). O Telegram pode avisar no
app sobre um "novo login" vindo do IP da Oracle; é esperado.

## 8. Subir

```bash
cd ~/teleclass
docker compose --profile https up -d --build
```

A primeira vez demora uns 5 a 10 minutos (compila o frontend e baixa as
dependências). O `--profile https` sobe também o **Caddy**, que atende nas
portas 80 e 443, pede o certificado e repassa tudo para o TeleClass.

Confira:

```bash
docker compose --profile https ps        # os dois devem estar "Up" (o teleclass, "healthy")
docker compose logs -f caddy             # procure "certificate obtained successfully"; Ctrl+C para sair
```

Abra `https://meuteleclass.duckdns.org` no navegador. Se você migrou os dados,
entre com seu usuário; senão, crie a conta (com o código de convite) e vincule
o Telegram.

Os contêineres têm `restart: unless-stopped`, então voltam sozinhos se a VM reiniciar.

### Se não abrir

| Sintoma | Causa provável |
|---|---|
| O navegador fica carregando até dar tempo esgotado | Porta 80/443 fechada: reveja o passo 3a (Security List) e o 3c (iptables) |
| Caddy reclama de "challenge failed" / "timeout" | Mesma coisa, ou o DuckDNS aponta para outro IP (passo 5) |
| Caddy diz que o Caddyfile é inválido | `TELEAULA_DOMAIN` vazio no `.env` |
| "Origem não permitida" ao entrar | Você está abrindo por IP ou por outro endereço; use o domínio do `.env` |
| Vídeos não tocam, mas o resto funciona | Veja `docker compose logs -f teleclass`; geralmente é o Telegram pedindo para vincular de novo |

## 9. Atualizar depois

Quando sair uma versão nova no GitHub:

```bash
cd ~/teleclass
git pull
docker compose --profile https up -d --build
docker image prune -f        # apaga imagens antigas para não encher o disco
```

Os dados em `data/` não são tocados.

## 10. Backup

Tudo que importa está em `~/teleclass/data/` (banco, sessões do Telegram,
anexos do Caderno, cursos coletados) e no `.env`. O cache de vídeo
(`data/cache/`) pode ficar de fora.

Backup no próprio servidor, todo dia às 4h, guardando os últimos 7:

```bash
mkdir -p ~/backups && chmod 700 ~/backups
crontab -e
```

Escolha o editor `nano` se perguntar e cole no fim:

```cron
0 4 * * * cd ~/teleclass && tar -czf ~/backups/teleclass-$(date +\%F).tgz --exclude=data/cache data .env && ls -1t ~/backups/teleclass-*.tgz | tail -n +8 | xargs -r rm
```

> O banco é SQLite. Uma cópia com o app rodando quase sempre fica boa, mas
> para uma cópia garantida pare antes (`docker compose stop teleclass`) e
> suba depois (`docker compose start teleclass`).

Um backup só no servidor não protege se a VM for perdida. De vez em quando,
traga uma cópia para o PC (pelo PowerShell):

```powershell
scp -i .\ssh-key-*.key "ubuntu@SEU_IP_PUBLICO:~/backups/teleclass-*.tgz" D:\Backups\
```

Guarde esses arquivos com cuidado: eles têm as sessões do Telegram de todo mundo.

Para **restaurar**: pare (`docker compose --profile https down`), apague ou
renomeie `data/`, extraia o backup na pasta `~/teleclass` (`tar -xzf ...`) e suba de novo.

## Alternativa: Cloudflare Tunnel em vez do Caddy

Use se não quiser abrir as portas 80 e 443 (pule os passos 3a e 3c) ou se já
tiver um domínio próprio no Cloudflare. Precisa de um domínio gerenciado pelo
Cloudflare (o DuckDNS não serve aqui); o link grátis aleatório
(`trycloudflare.com`) muda a cada reinício e não é bom para amigos.

1. No painel do Cloudflare: **Zero Trust → Networks → Tunnels → Create a tunnel**
   → *Cloudflared* → dê um nome → escolha **Debian/Ubuntu 64-bit ARM** e rode no
   servidor o comando de instalação que aparece.
2. Em **Public Hostname**, escolha o subdomínio (ex.: `teleclass.seudominio.com`),
   *Service* **HTTP** e URL **`127.0.0.1:8000`**.
3. No servidor, suba **sem** o Caddy: `docker compose up -d --build`
   (sem `--profile https`; `TELEAULA_DOMAIN` não é usado).

O Cloudflare cuida do HTTPS e repassa o IP de cada pessoa, então o cookie
seguro e os limites de tentativas continuam valendo.

## Como o app se comporta na internet

- **Porta 8000 só local.** O `docker-compose.yml` publica o TeleClass em
  `127.0.0.1:8000`; quem fala com a internet é o Caddy (ou o Cloudflare Tunnel).
- **Proxy confiável.** Como só o próprio servidor alcança essa porta, o app
  confia nos cabeçalhos `X-Forwarded-*` do proxy (`FORWARDED_ALLOW_IPS=*`). Com
  isso o cookie de sessão sai com `Secure` sob HTTPS e os limites de login e
  cadastro valem por pessoa, não para todos juntos.
- **Sem CORS.** Página e API saem do mesmo endereço, então não há nada a
  liberar. Pedidos que alteram dados vindos de outro site recebem 403.
- **Cadastro.** Sem `TELEAULA_INVITE_CODE`, qualquer pessoa que achar o
  endereço pode criar conta; com ele, só quem tem o código. Cada conta só vê a
  própria biblioteca, progresso e anotações (ver `docs/autenticacao.md`).
- **Telegram.** Todos usam o mesmo `TG_API_ID`/`TG_API_HASH` (do app), mas cada
  um entra com a própria conta. Os vídeos passam pelo servidor, então a banda
  da VM é dividida entre quem estiver assistindo (a Oracle dá 10 TB/mês de
  saída grátis, mais que suficiente).
