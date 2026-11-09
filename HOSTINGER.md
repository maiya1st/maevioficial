# MAÉVI · Hostinger

Na Hostinger a loja usa MySQL/MariaDB. Fotos, pedidos e configurações ficam no banco, então uma nova publicação não apaga nada.

## Implantação

Conecte o repositório `maiya1st/maevioficial`, branch `main`.

| Configuração | Valor |
| --- | --- |
| Framework | Other / Outros |
| Node.js | 24.x |
| Diretório raiz | Raiz do repositório |
| Comando de construção | Nenhum |
| Gerenciador | npm |
| Arquivo de entrada | server.cjs |

Para uma instalação nova, comece com `MAEVI_HOSTING=setup`. Nesse modo o site mostra só uma página "Em preparação" enquanto você cria o banco. Depois troque para `hostinger`.

## Variáveis

| Variável | Uso |
| --- | --- |
| MAEVI_HOSTING | `hostinger` (loja no ar) ou `setup` (página de preparação) |
| MAEVI_PUBLIC_URL | Endereço oficial com `https://`, sem caminho nem barra final |
| MAEVI_ADMIN_KEY | Chave de 48 caracteres para o primeiro acesso e a recuperação do painel. Gere com `node prepare-hostinger.cjs` |
| MAEVI_DB_HOST / MAEVI_DB_PORT | Host e porta do banco (padrão `127.0.0.1` e `3306`) |
| MAEVI_DB_NAME / MAEVI_DB_USER / MAEVI_DB_PASSWORD | Banco e usuário exclusivos da MAÉVI |
| MAEVI_MP_MODE | `production` para vender; `disabled` desliga os pagamentos e a loja recusa pedidos |
| MAEVI_MP_ACCESS_TOKEN | Access Token de produção do Mercado Pago |
| MAEVI_MP_WEBHOOK_SECRET | Assinatura secreta do webhook de produção |

Cole os valores sem aspas. Nunca envie esses valores ao GitHub ou pelo chat.

## Depois de cada publicação

1. `https://SEU-DOMINIO/api/health` responde `ok: true`.
2. A vitrine abre e o painel aceita seu e-mail e senha.
3. Se mudou algo no pagamento, siga a conferência descrita em MERCADO-PAGO.md.

Se o site não atualizar em uns 10 minutos, clique em **Reimplantar** no painel Node.js.

## Backup

Use os backups de **banco de dados** da Hostinger: eles incluem fotos, pedidos e configurações. Confira a frequência do seu plano. Guarde à parte, em lugar privado, a chave do painel e as credenciais. `backup.cjs` e `BACKUP-MAEVI.cmd` servem só para o banco SQLite do computador.

## Detalhes técnicos

- O servidor responde em até 3 segundos após carregar (exigência do carregador da Hostinger) e só então conecta ao banco. Enquanto isso, retorna 503 com Retry-After.
- Só o domínio de `MAEVI_PUBLIC_URL` é aceito. Prévias da Hostinger em outros domínios mostram "Endereço da loja não permitido", e isso é esperado.
- Em HTTPS o cookie do painel é `Secure`. Sessões expiram após 30 minutos sem uso e quando a aplicação reinicia.
- Erros de inicialização são registrados sem senhas ou mensagens do banco.

Referências: [Node.js na Hostinger](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/) · [MySQL com Node.js](https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/)
