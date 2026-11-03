# MAÉVI · implantação de teste na Hostinger

O projeto suporta dois bancos: SQLite para desenvolvimento local e MySQL/MariaDB para a Hostinger. O modo online continua demonstrativo; pagamentos reais estão bloqueados no adaptador. Não importe dados de clientes para os testes.

## Primeira implantação: criar o site em preparação

Conecte o repositório privado `maiya1st/maevioficial`, branch `main`, depois desta atualização chegar ao GitHub.

| Configuração | Valor |
| --- | --- |
| Framework | Other / Outros, se houver essa opção |
| Node.js | 24.x |
| Diretório raiz | Raiz do repositório |
| Comando de construção | Nenhum |
| Gerenciador | npm |
| Diretório de saída | Vazio |
| Arquivo de entrada | server.cjs |
| Variável inicial | MAEVI_HOSTING = setup |

O projeto inclui `package-lock.json`. A instalação das dependências precisa ser executada pelo fluxo da plataforma (`npm ci`); isso é separado da compilação, que não existe neste projeto. Se o painel exigir uma pasta de saída ou não aceitar o arquivo `.cjs`, confira o erro antes de substituir campos ou expor a raiz como conteúdo estático.

Com `MAEVI_HOSTING=setup`, a aplicação exibe somente uma página de preparação e mantém catálogo, painel, pedidos e pagamentos indisponíveis. A página inicial e `/api/health` retornam 200 para permitir as verificações de disponibilidade da hospedagem; as demais rotas retornam 503. Todas usam `noindex`. Nenhum banco ou credencial é necessário para essa primeira implantação. Ela permite obter o domínio temporário e acessar as ferramentas do painel antes de ativar a loja de teste.

## Criar o banco e preencher as variáveis

1. No painel do site, abra **Bancos de dados → MySQL** e crie um banco e um usuário exclusivos para a MAÉVI. Guarde a senha somente no computador/gerenciador privado. Não reutilize o banco de outro site.
2. Abra `.env.hostinger.local` no VS Code. Esse arquivo foi gerado localmente por `node prepare-hostinger.cjs`, com uma chave aleatória para o painel. Um arquivo existente nunca é sobrescrito. Ele é ignorado no Git e excluído do ZIP.
3. Preencha o endereço HTTPS público, nome completo do banco, usuário completo com prefixo e senha. O host padrão é `127.0.0.1`, conforme a documentação Hostinger; use o que o painel informar. Um banco em host remoto exige TLS válido (`MAEVI_DB_TLS=true`), sem desativar a verificação do certificado.
4. No painel Node.js, adicione as variáveis com os valores do arquivo **sem as aspas externas**. O arquivo privado não é carregado automaticamente na hospedagem e não deve ser enviado ao repositório.

| Variável | Uso |
| --- | --- |
| MAEVI_HOSTING | Trocar `setup` por `hostinger` após preencher as demais |
| MAEVI_PUBLIC_URL | Origem HTTPS exata, como `https://sua-loja.hostingersite.com`, sem caminho |
| MAEVI_ADMIN_KEY | Chave aleatória de 48 caracteres do arquivo privado |
| MAEVI_DB_HOST | Host informado no painel; padrão `127.0.0.1` |
| MAEVI_DB_PORT | Padrão `3306` |
| MAEVI_DB_NAME | Nome completo do banco criado |
| MAEVI_DB_USER | Usuário completo do banco |
| MAEVI_DB_PASSWORD | Senha do banco |
| MAEVI_MP_MODE | `disabled` até configurar o webhook; depois `test` |
| MAEVI_MP_ACCESS_TOKEN | Access Token da conta vendedora de teste |
| MAEVI_MP_WEBHOOK_SECRET | Assinatura secreta do webhook de teste |

Não configure manualmente PORT sem necessidade; o servidor lê a variável fornecida pela plataforma e usa 3000 como padrão nos modos online. Ele escuta em `0.0.0.0` somente nesses modos. O comando local permanece em `127.0.0.1:5173`. Somente o Host público exato e origens correspondentes são aceitos; não há CORS aberto nem confiança no Host encaminhado arbitrariamente.

Ao iniciar, o servidor aguarda a conexão, cria as tabelas que faltam e adiciona o catálogo de demonstração **somente se a tabela estiver vazia**. Não apaga nem repõe estoque de um banco já preenchido. Use uma instância/processo. A chave do painel vem das variáveis e o login em HTTPS usa cookie `Secure`, `HttpOnly`, `SameSite=Strict`, prazo e limitação de tentativas. Sessões expiram quando a aplicação reinicia; basta entrar novamente.

## Conferir após implantar

1. `/api/health` deve responder `ok: true`. Abra a vitrine no domínio público e confirme o aviso de demonstração.
2. Entre em `/admin` com a chave privada do arquivo local. Ela não deve aparecer em prints ou no chat.
3. Cadastre uma foto e edite uma peça de demonstração. Publique novamente o mesmo código e confirme que a edição e a foto continuam presentes.
4. Faça um pedido de teste, confira estoque e cancelamento/expiração e confirme que as condições de frete são de demonstração.
5. Configure o webhook no Mercado Pago seguindo `MERCADO-PAGO.md`, preencha a assinatura secreta e reinicie para testar o checkout. Use uma conta compradora de teste e cartões de teste; não use a conta pessoal para pagar.

## Persistência e backup

Pedidos, produtos, estoque, configurações, cupons, atividades e fotos enviadas pelo painel ficam no MySQL/MariaDB. Fotos têm nomes aleatórios, limites de 4 MB por imagem, 100 MB/400 arquivos no total e validação de tipo/dimensões. Arquivos estáticos de demonstração vêm do Git. Uma publicação não precisa copiar o banco ou as fotos para a pasta do código.

O bloqueio transacional no banco coordena alterações de estoque e cupons entre conexões. Preço, frete e desconto continuam calculados no servidor. O adaptador não faz consultas montadas com dados de entrada; valores passam como parâmetros.

Use os backups de **banco de dados** do painel Hostinger, pois eles incluem as fotos binárias. Confira a frequência e a retenção do plano e faça um ensaio de restauração em outro banco. `backup.cjs` e `BACKUP-MAEVI.cmd` continuam sendo ferramentas do SQLite local; não são o backup do banco online. As credenciais e a chave administrativa precisam de uma cópia privada separada.

O banco local não é enviado ao GitHub nem importado automaticamente: o ambiente de hospedagem começa com os dados demonstrativos. Uma eventual migração do catálogo local deve ser feita explicitamente com backup, sem enviar o banco privado ao repositório.

## Limites antes das vendas reais

Esta entrega prepara uma implantação **de teste**, não ativa pagamentos reais. A validação local cobre SQLite, MariaDB e HTTP; ainda é necessário conferir a configuração real da conta Hostinger, o certificado HTTPS, reinício/publicação e o fluxo com Mercado Pago. Cancelamento/estorno financeiro, fila durável de webhooks, reconciliação periódica, e-mail transacional, políticas comerciais e regras definitivas de frete continuam pendentes para a abertura de vendas.

Referências: [implantação Node.js](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/), [MySQL com Node.js](https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/), [bancos suportados](https://www.hostinger.com/support/1583226-which-database-management-system-is-used-at-hostinger/).
