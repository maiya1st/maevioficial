# MAÉVI · versão 0.6.1

Loja local com vitrine, painel e checkout de demonstração. Mercado Pago Checkout Pro implementado exclusivamente para testes, aguardando aplicação, credenciais e HTTPS. A instalação permanece desativada; produção e contas reais estão bloqueadas. A loja não coleta cartões nem envia mensagens ou realiza entregas reais. Veja MERCADO-PAGO.md.

## Abrir

1. Encerre a versão anterior no terminal com **Ctrl+C**.
2. Dê dois cliques em **INICIAR-MAEVI.cmd** e mantenha a janela aberta.
3. Acesse **http://127.0.0.1:5173/** e atualize a página.
4. Painel: **http://127.0.0.1:5173/admin**. Abra **data/admin-key.txt** no VS Code e use a chave para entrar.

O iniciador usa o Node do sistema ou o runtime do Codex já disponível neste computador. Requer Node.js 24 ou superior, atualizado; os testes desta versão usaram 24.22.1. O modo SQLite local usa os módulos nativos do Node. A implantação MySQL/MariaDB instala o driver mysql2 com npm ci; as versões estão fixadas no package-lock.json. Abrir `index.html` diretamente não executa o backend.

No terminal do VS Code, também pode executar:

```powershell
node server.cjs
```

Se o terminal não reconhecer `node`:

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.cjs
```

## O que funciona

- Vitrine responsiva em oliva e rosé, categorias editoriais, favoritos, busca sem acentos, filtros e ordenação.
- Efeitos CSS/JS, entrada ao rolar, hover de imagens, segunda foto, transições de painéis e respeito ao movimento reduzido.
- Seleção de tamanho, estoque por tamanho, sacola persistida no navegador e link individual `/?produto=1`.
- Ficha com composição, cuidados e medidas reais cadastráveis pelo painel.
- Checkout em três etapas: contato → recebimento/endereço → revisão. O total permanece visível no computador e aparece antes da confirmação no celular.
- Consulta de CEP pelo ViaCEP, com preenchimento manual disponível quando o serviço falhar.
- Retirada e entrega de teste, com tarifa fixa, prazos e regra de frete grátis configurados pelo proprietário.
- Cupons percentuais com compra mínima, validade, limite de usos e ativação/desativação.
- Preços, cupons, frete e total calculados no servidor; cotação alterada não é confirmada silenciosamente.
- Pedido persistido com número e chave privada de consulta, histórico, impressão de comprovante de teste e cancelamento pelo cliente enquanto ainda recebido.
- Reserva temporária de estoque, liberação por expiração e proteção contra duplicidade de pedido/baixa/uso de cupom.
- Painel com catálogo, busca/filtros, envio de fotos, estoque, pedidos, configurações, cupons e registro de atividades.
- Backup consistente do SQLite, fotos e chave por `BACKUP-MAEVI.cmd` ou `node backup.cjs`.

## Testar um pedido

1. Escolha uma peça e um tamanho e adicione à sacola.
2. Continue para o checkout. Use nome/e-mail fictícios e um telefone de teste com DDD, por exemplo `11999998888`.
3. Escolha retirada ou entrega. Para testar a consulta, use o CEP público de referência `01001000`; confira o endereço e preencha um número fictício.
4. Revise os dados e valores. Se houver um cupom cadastrado, aplique-o.
5. Confirme o aviso de demonstração e crie o pedido. Nenhuma cobrança acontece.
6. Guarde número e chave de consulta, disponíveis na confirmação. A chave permite visualizar aquele pedido: não a compartilhe.
7. No painel, veja **Pedidos de teste**. Avance o status ou cancele. Na vitrine, use **Acompanhar pedido** ou **Meu pedido de teste**.

O último acesso é mantido na aba via sessionStorage; não há login de cliente nem recuperação por e-mail. A impressão não inclui a chave privada. O cliente pode cancelar apenas um teste ainda recebido; após iniciar a preparação, a gestão fica com a loja.

## Estoque e reservas

O estoque do painel representa unidades disponíveis. A criação do pedido reserva/retira essas unidades numa transação. Cancelamento ou expiração devolve as peças e libera o uso do cupom uma única vez.

O prazo padrão é **30 minutos**, configurável de 15 a 1.440 minutos. A manutenção roda a cada minuto no servidor e antes das chamadas à API. Apenas pedidos recebidos com prazo definido expiram; pedidos já em preparação não expiram automaticamente. Pedidos antigos sem prazo continuam preservados.

## Configurações e fotos

Em **Configurações da loja**, cadastre contato, endereço de retirada e valores de entrega. Não há contatos fictícios pré-cadastrados. O valor inicial de R$ 19,90 e o prazo de 3 a 8 dias são **exemplos de demonstração**, não uma cotação de transportadora. O limite de frete grátis usa o subtotal após desconto; zero desativa a regra.

O catálogo suporta Vestidos, Conjuntos e Blusas, P/M/G/GG e uma cor por cadastro. Para outra cor, cadastre outra peça. Fotos podem ser enviadas pelo painel ou colocadas manualmente em `assets/`. Upload aceita JPG, PNG e WebP de até 4 MB, 40 megapixels e 10.000 pixels por lado. Os nomes enviados são substituídos por nomes aleatórios. Há cota local de 100 MB ou 400 fotos enviadas. Arquivos não são apagados automaticamente ao trocar a foto.

As fotos e peças iniciais são referências demonstrativas; substitua por produtos e fotografias próprios. As origens estão em **IMAGENS.md**. As fotos já estão salvas localmente. Google Fonts ainda é usado, com fontes alternativas sem internet.

## Dados e backup

`data/maevi.sqlite` contém catálogo, configurações, cupons, clientes fictícios, pedidos e eventos. `data/admin-key.txt` contém a chave do painel. Esses caminhos são ignorados pelo Git e não são servidos pelo HTTP. A pasta data não é criptografada pela aplicação: mantenha o computador e os backups protegidos e use dados fictícios nesta fase.

Para backup, execute **BACKUP-MAEVI.cmd**. Ele cria um snapshot verificado em `data/backups/`, com fotos e chave. Esse backup é privado e não entra no ZIP de distribuição. Não apague data para atualizar o código. O banco existente é preservado e as tabelas novas são criadas na inicialização.

## Organização

| Arquivos | Finalidade |
| --- | --- |
| `index.html`, `styles.css`, `boutique.css`, `app.js`, `experience.js`, `catalog-core.js` | Vitrine e navegação |
| `checkout.js`, `checkout.css` | Checkout, confirmação e consulta |
| `admin.html`, `admin.css`, `admin.js`, `operations.js` | Painel, fotos, configurações e cupons |
| `server.cjs`, `backend.cjs` | HTTP local, API, autenticação, SQLite e estoque |
| `commerce.cjs`, `images.cjs`, `errors.cjs` | Validação e regras comerciais |
| `payments.cjs` | Adaptador Mercado Pago Checkout Pro de teste |
| `backup.cjs` | Backup local consistente |
| `*.test.cjs`, `testing.cjs` | Testes com dados temporários isolados |

## Verificação

```powershell
node --test backend.test.cjs security.test.cjs catalog.test.cjs commerce.test.cjs http.test.cjs payments.test.cjs hosting.test.cjs startup.test.cjs
```

São **66 resultados aprovados** na suíte principal e **6 cenários adicionais aprovados em MariaDB 11.4.13 real**, sem falhas. O teste HTTP precisa de permissão de conexão local. Com npm, use `npm test`, `npm run test:http`, `npm run test:all` e `npm run check`.

No navegador foram conferidos vitrine, favoritos, tamanho, sacola, checkout com entrega e CEP, cupom, pedido e cancelamento, configurações e cadastro de cupom. O checkout foi conferido em largura de celular de 390 px; a vitrine também havia sido verificada em 320 px. Upload foi validado por testes automatizados e HTTP real; o teste pelo seletor visual ficou bloqueado e expirou a sessão do painel. Veja **SEGURANCA.md** para evidências e limites.

## Próxima etapa: gateway e publicação

Consulte **HOSTINGER.md** para a implantação de teste e **MERCADO-PAGO.md** para pagamentos. O código de pagamento de teste está preparado: sessão hospedada, assinatura de webhook e consulta verificada à API. Os testes usam respostas simuladas; o ensaio com Mercado Pago ainda depende de criar a aplicação e configurar credenciais e HTTPS. Produção, cancelamento/estorno financeiro e liberação automática de reservas com pagamento iniciado não estão habilitados. Não publique a configuração HTTP local diretamente.

## Contatos · atualização 03/11/2026

O menu Contatos está disponível no computador, celular e rodapé. WhatsApp: (41) 98521-3878, link https://wa.me/5541985213878. Instagram: @maevioficial, link https://www.instagram.com/maevioficial/. Os dados também foram gravados nas configurações existentes da loja e continuam editáveis no painel.

O convite do Instagram aparece após cinco segundos quando a página está visível e não há formulário ou painel aberto. Ao fechar, permanece dispensado nessa sessão do navegador. Pode ser reaberto pelo botão Instagram da MAÉVI no rodapé. Não há embed, rastreador ou envio automático de mensagens; os links abrem somente por ação do visitante.

## Hostinger · versão 0.6.1

Adicionados banco MySQL/MariaDB, persistência de fotos no banco, configuração HTTPS com Host exato e cookie administrativo Secure. O modo local mantém SQLite e arquivos locais. O modo MAEVI_HOSTING=setup permite criar o site na hospedagem com uma página de preparação, sem abrir catálogo, painel ou pagamentos. Depois de criar o banco e preencher as variáveis privadas, MAEVI_HOSTING=hostinger habilita a loja demonstrativa. Veja HOSTINGER.md antes da primeira implantação.

A chave do painel online e os campos da hospedagem estão no arquivo privado .env.hostinger.local gerado por prepare-hostinger.cjs. Esse arquivo não é enviado ao GitHub ou incluído no ZIP. Não o compartilhe no chat.

## Redesign da vitrine · 09/11/2026

Base neutra (areia/papel) com oliva e rosé nos detalhes; títulos em Cormorant Garamond e textos em Manrope com corpo mínimo de 11–15px. Home abre com uma única foto forte (no celular, imagem em tela cheia com chamada e botão sobrepostos), categorias Vestidos, Conjuntos e Blusas, e vitrine com fotos em 3:4, categoria, nome, preço e cor. A ficha da peça organiza galeria deslizável, preço, cor, tamanhos em grade, botão principal e atalho "Tirar dúvidas no WhatsApp" com o nome da peça e o tamanho já preenchidos (usa o número cadastrado no painel). No celular, a ficha ocupa a tela inteira e o botão de compra fica fixo no rodapé. Os estilos novos estão no fim de `boutique.css`.

## Camada imersiva · v0.8

`immersive.js` e `immersive.css` adicionam: abertura com "seda líquida" em WebGL nas cores da marca (reage ao mouse e pausa fora da tela), portal em arco com halos 3D e título animado palavra por palavra, faixa cinética que inclina com a rolagem, **vitrine em órbita** (carrossel 3D girado por arraste, toque, setas ou teclado; a peça da frente abre a ficha), cartões com inclinação 3D e brilho holográfico, entradas 3D ao rolar, cursor em anel e botões magnéticos no computador. Sem bibliotecas externas. Com "reduzir movimento" ativado no sistema, as animações param e o conteúdo fica estático. Sem WebGL, a abertura usa um gradiente animado.
