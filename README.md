# MAÉVI · loja online

Loja de moda feminina com vitrine, checkout com pagamento pelo Mercado Pago (Pix e cartão em até 6x) e painel de gestão. Node.js 24 ou superior, sem framework. Banco SQLite no computador e MySQL/MariaDB na Hostinger.

## O que a loja faz

- **Vitrine:** abertura animada, vitrine 3D em órbita, categorias, busca, filtros, favoritos e ficha da peça com galeria, tamanhos, medidas e atalho para o WhatsApp.
- **Checkout em três etapas:** dados, recebimento (retirada ou entrega com tarifa fixa e CEP pelo ViaCEP) e conferência com cupom. A cliente vai direto para o Mercado Pago e volta com a situação atualizada.
- **Pagamentos:** confirmação por webhook assinado e por consulta à API. Reservas abandonadas voltam sozinhas ao estoque. Pedidos pagos podem ser cancelados com estorno pelo painel.
- **Painel** (`/admin`):
  - login com e-mail e senha;
  - peças com fotos por arrastar e soltar;
  - categorias e tamanhos configuráveis;
  - pedidos, cupons, dados da loja, identificação legal e política de trocas;
  - pop-up de gerenciamento com ações em lote;
  - quadro **Pronto para vender?**.
- **Segurança:** preços e totais calculados no servidor, CSP sem scripts externos, sessões HttpOnly, limitação de tentativas, consulta de pedido só com chave privada. Veja **SEGURANCA.md**.

## Rodar no computador

1. Dê dois cliques em **INICIAR-MAEVI.cmd** (ou rode `node server.cjs`) e mantenha a janela aberta.
2. Vitrine: http://127.0.0.1:5173/ · Painel: http://127.0.0.1:5173/admin
3. No primeiro acesso ao painel, entre com a chave de `data/admin-key.txt` e crie seu e-mail e senha em **Minha conta**.

Sem `MAEVI_MP_MODE=production` e credenciais em `.env.local`, a vitrine abre, mas os pedidos são recusados ("Pagamentos indisponíveis").

## Publicação

- **Hostinger:** HOSTINGER.md
- **Mercado Pago:** MERCADO-PAGO.md
- **Fotos e imagens:** IMAGENS.md

## Organização

| Arquivos | Finalidade |
| --- | --- |
| `index.html`, `styles.css`, `boutique.css`, `immersive.css`, `app.js`, `experience.js`, `immersive.js`, `catalog-core.js`, `contacts.js` | Vitrine |
| `checkout.js`, `checkout.css` | Checkout e acompanhamento do pedido |
| `admin.html`, `admin.css`, `admin.js`, `operations.js` | Painel |
| `server.cjs`, `http-server.cjs`, `hosting.cjs`, `backend.cjs`, `database.cjs` | Servidor, API e banco |
| `commerce.cjs`, `payments.cjs`, `images.cjs`, `errors.cjs` | Regras de venda, Mercado Pago e fotos |
| `backup.cjs`, `BACKUP-MAEVI.cmd` | Backup do banco local |
| `*.test.cjs`, `testing.cjs`, `fixtures.cjs` | Testes automáticos (não são publicados na loja) |

## Testes automáticos

```bash
npm run test:all
```

Conferem estoque, pedidos, pagamentos, estornos, login, segurança e painel com dados temporários e um Mercado Pago simulado, sem acessar a rede. `npm run check` confere a sintaxe dos arquivos.

## Recursos de venda

- **Compre o look:** no editor da peça, escolha até 6 peças que combinam com ela. Elas aparecem no fim da ficha.
- **Tabela de medidas:** medidas por tamanho, em centímetros, com colunas que você define (ex.: busto, cintura, quadril). Dá para copiar a tabela de outra peça.
- **Cores e fotos:** no editor da peça, a seção **Cores, fotos e estoque** tem uma aba por cor (+ Adicionar cor). Cada cor tem nome, bolinha, até 8 fotos (envio de várias de uma vez, troca de capa e ordem) e estoque por tamanho. Nome, preço, descrição, medidas e look valem para todas. Uma peça já cadastrada separadamente pode virar cor de outra em **Junte aqui**. Por baixo, cada cor é guardada como uma peça ligada às outras, por isso sacola, pedidos e estornos não mudam. A vitrine e o painel mostram um card só por peça.
- **Avise-me quando chegar:** em peças ou tamanhos esgotados, a cliente deixa e-mail ou WhatsApp (com autorização). Os pedidos aparecem em **Clientes**, com botões prontos de WhatsApp e e-mail, e um aviso no painel quando a peça volta ao estoque.
- **Pop-up de boas-vindas:** em **Loja**, ligue o pop-up e escolha um cupom (de preferência marcado como **Só na primeira compra**, que vale uma vez por e-mail). Os e-mails cadastrados ficam em **Clientes**, onde dá para copiar ou baixar a planilha.
- **WhatsApp flutuante:** botão fixo no canto da vitrine, com o número cadastrado em Loja.


## MAÉVI AI Catalog (opcional)

No painel administrativo, clique em **+ Nova peça**, adicione a foto da cor, descreva na caixa **Informações da etiqueta e detalhes confirmados** e selecione **Sugerir textos**. A IA propõe nome, descrição e categoria; clique em **Aplicar sugestões ao formulário** para revisar tudo antes de salvar. Ao aplicar a sugestão em uma peça nova, a opção **Mostrar na vitrine** é desmarcada, até autorização manual. O recurso **não publica automaticamente**, não define preços, materiais, tamanhos ou quantidades e não altera estoque.

Configure `MAEVI_OPENAI_API_KEY` como variável de ambiente **no servidor** (não no navegador nem no repositório), reinicie a API e use um modelo compatível com imagens e JSON, por exemplo `MAEVI_OPENAI_MODEL=gpt-4.1-mini`. A chave exige faturamento separado de uma assinatura ChatGPT. Uma imagem de prévia em resolução reduzida e as informações fornecidas são enviadas ao provedor de IA quando você clica no botão. Não envie fotos com dados pessoais. Sem a chave, o cadastro manual continua funcionando.

A rota autenticada `POST /api/admin/ai-catalog` apenas gera rascunho. Revisão e gravação continuam ocorrendo pelo fluxo existente, com controle de versões.
