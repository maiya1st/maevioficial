# MAÉVI · Mercado Pago Checkout Pro · teste

O adaptador foi implementado e testado com respostas locais simuladas da API. Ainda não foi validado com a conta da MAÉVI: faltam a aplicação, as credenciais e uma origem pública HTTPS. A instalação atual permanece desativada. Esta versão bloqueia contas reais e não habilita produção.

## 1. Criar a aplicação

1. Acesse https://www.mercadopago.com.br/developers/panel/app com a conta da loja.
2. Em **Suas integrações**, crie a aplicação **MAÉVI** para **Pagamentos online / Checkout Pro**. O código usa a API de preferências (`/checkout/preferences`). As opções exibidas podem variar no painel; se houver escolha entre Orders e Preferences, esta implementação usa Preferences.
3. Abra **Credenciais de teste**. Use o Access Token da conta **vendedora de teste brasileira**, vinculada à aplicação. O código consulta `/users/me` e exige a identificação `test_user` e o país MLB antes de criar preferências. O prefixo APP_USR sozinho não diferencia uma conta de teste de uma real.
4. Em **Contas de teste**, prepare uma conta **compradora** diferente da vendedora, também do Brasil. Não use a conta pessoal para comprar durante os testes.

Não envie Access Token, senha ou assinatura secreta no chat, em screenshots ou no Git.

## 2. Preparar HTTPS e webhook

A loja continua vinculada a `127.0.0.1`. Não foi aberta uma porta pública, criado túnel ou contratado serviço. A escolha e a configuração da hospedagem ainda precisam ser feitas.

O Mercado Pago não aceita localhost nos endereços de retorno. Para o ensaio completo, será necessária uma origem HTTPS com nome de domínio, por exemplo `https://teste.sua-loja.com.br`, cujo proxy preserve o Host público. Use dados fictícios e inicie a compra nessa mesma origem: a chave de consulta do pedido fica no sessionStorage daquele navegador/origem.

Configure no painel Mercado Pago, em **Webhooks**, o ambiente de teste, evento **Pagamentos** e a URL:

```text
https://SEU-DOMINIO/api/payments/mercadopago/webhook
```

Copie a assinatura secreta fornecida pelo painel para o arquivo local. As URLs de retorno são geradas pelo servidor como `https://SEU-DOMINIO/?retorno=mp`. Os parâmetros de retorno nunca confirmam pagamentos.

O proxy deve bloquear `/admin*`, `/api/admin*`, `/operations.js` e arquivos privados; preserve o Host público e não publique o diretório do projeto como arquivos estáticos. O backend também recusa o painel pelo Host público e por cabeçalhos de encaminhamento. Uma revisão da infraestrutura será necessária antes de qualquer exposição pública. A configuração local não é uma hospedagem de produção.

## 3. Configurar somente no computador

Abra `.env.local` na pasta do projeto pelo VS Code. Foi criado um modelo vazio; um arquivo preexistente é preservado. O arquivo é ignorado pelo Git e excluído do ZIP. Preencha localmente:

```dotenv
MAEVI_MP_MODE=test
MAEVI_MP_ACCESS_TOKEN=COLE_LOCALMENTE_O_TOKEN_DA_CONTA_VENDEDORA_DE_TESTE
MAEVI_MP_WEBHOOK_SECRET=COLE_LOCALMENTE_A_ASSINATURA_SECRETA
MAEVI_PUBLIC_URL=https://SEU-DOMINIO
```

Encerre o servidor com Ctrl+C e abra `INICIAR-MAEVI.cmd` novamente. Sem os quatro valores válidos, o checkout de pagamento continua bloqueado. Não altere para `production`: essa opção não é implementada e não ativa cobranças. As credenciais são lidas apenas pelo servidor; não é necessário inserir Public Key no navegador neste fluxo de redirecionamento.

## 4. Fazer o ensaio de ponta a ponta

1. Abra a origem HTTPS da loja em janela anônima. Use contato fictício e crie um pedido de teste. Guarde seu número e a chave privada de consulta antes de sair da página.
2. Clique em **Abrir Mercado Pago de teste**. O servidor usa o total persistido, incluindo frete e cupom, e cria uma preferência hospedada. O provedor recebe uma linha agregada representando o valor integral do pedido, sem nome, endereço ou telefone do comprador enviados pela MAÉVI. Os detalhes das peças permanecem no pedido local.
3. Entre na conta **compradora de teste** e use somente os cartões de teste publicados pelo Mercado Pago. Esta primeira etapa exclui boleto, transferência/Pix e caixa eletrônico para manter o ensaio concentrado em cartão. Meios definitivos e parcelamento serão definidos na ativação real.
4. Ao retornar, o site consulta o estado no servidor. Se a sessão do navegador não estiver disponível, use **Acompanhar pedido** com número e chave.
5. Confira aprovação, recusa, abandono, atualização manual, repetição de clique e notificações no painel. A confirmação exige ambiente de teste, vendedor, moeda BRL, valor exato, referência e vínculo da preferência na ordem do provedor.

## Segurança e limites desta etapa

- A criação da sessão é reivindicada no banco antes da chamada externa. Um segundo clique reutiliza a preferência já persistida; uma tentativa ainda em andamento não abre outra.
- Um timeout pode significar que o provedor criou a preferência sem que o servidor tenha recebido a resposta. Nesse caso o pedido fica **em conferência**; não é criada outra preferência automaticamente. Confira o painel do provedor antes de qualquer intervenção.
- Webhooks exigem assinatura HMAC e tolerância de cinco minutos, com ID assinado e corpo consistentes. O corpo não é usado como comprovante: o servidor busca o pagamento na API. Duplicatas não repetem transições; um estado antigo não regride uma aprovação.
- O webhook é processado durante a requisição, sem fila local. Falha externa retorna erro para permitir nova entrega pelo provedor. **Atualizar situação** consulta a API novamente e permite reconciliação manual. Uma fila durável, tarefas periódicas de reconciliação e monitoramento ficam para a infraestrutura de produção.
- Uma vez iniciado o checkout, a reserva não é liberada automaticamente pela expiração local. Expiração sem confirmação, aprovação tardia, estorno, contestação e pagamento duplicado exigem conferência. Não há cancelamento, estorno ou liberação financeira automatizada nesta versão. Isso evita devolver estoque com pagamento ainda possível ou incerto.
- Pedido de teste aprovado pode avançar para preparação, pronto e concluído no painel. O painel não pode transformar um pagamento pendente em aprovado ou cancelar uma reserva que já tenha pagamento iniciado. Pedidos sem checkout mantêm o fluxo demonstrativo anterior.
- Credenciais são protegidas pelo acesso à conta Windows; `.env.local` não tem criptografia própria e não entra no backup comercial. Guarde uma cópia privada em um gerenciador de segredos se necessário.
- Não há garantia de aprovação em produção. Antes de vender: testar com a conta da loja, contratar/configurar HTTPS, reforçar autenticação administrativa e operação, revisar políticas e dados reais, definir frete/parcelamento/Pix, e implementar o ciclo de cancelamento e estorno com o provedor.

## Referências oficiais

- [Criar aplicação](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/create-application)
- [Criar preferência](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/create-payment-preference)
- [URLs de retorno](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/configure-back-urls)
- [Notificações](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/payment-notifications)
- [Contas de teste](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/test-accounts)
- [Compras de teste](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/integration-test/test-purchases)

## Hospedagem Hostinger

A preparação de domínio temporário, banco e painel é descrita em HOSTINGER.md. No modo hostinger, a loja pode funcionar em demonstração mesmo com o Mercado Pago desativado. Configure o webhook e credenciais antes de habilitar MAEVI_MP_MODE=test; a ativação de pagamentos reais continua bloqueada. Use a mesma origem HTTPS da vitrine para os retornos e o webhook.
