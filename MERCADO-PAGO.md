# MAÉVI · Mercado Pago (pagamento real)

A loja usa o **Checkout Pro**: a cliente paga no ambiente do Mercado Pago, e a MAÉVI nunca vê dados de cartão. Formas aceitas: **Pix** e **cartão de crédito ou débito em até 6x**. Boleto e lotérica ficam desativados.

Nunca envie Access Token, senhas ou a assinatura secreta pelo chat, em prints ou no GitHub. Eles ficam só nas variáveis da Hostinger.

## 1. No Mercado Pago

1. Entre em https://www.mercadopago.com.br/developers/panel/app com a conta da loja.
2. Crie a aplicação **MAÉVI** (ou abra a que já existe), do tipo **Pagamentos online · Checkout Pro**.
3. Abra **Credenciais de produção** e conclua o que o painel pedir para ativá-las: ramo de atividade, site (`https://SEU-DOMINIO`) e dados do negócio.
4. Copie o **Access Token de produção**, que começa com `APP_USR-`.
5. Em **Webhooks → Configurar notificações**, escolha o **modo produtivo**, marque o evento **Pagamentos** e informe a URL:

   ```text
   https://SEU-DOMINIO/api/payments/mercadopago/webhook
   ```

   Salve e copie a **assinatura secreta** que o painel mostrar.

## 2. Na Hostinger (variáveis do Node.js)

| Variável | Valor |
| --- | --- |
| `MAEVI_MP_MODE` | `production` |
| `MAEVI_MP_ACCESS_TOKEN` | Access Token **de produção** |
| `MAEVI_MP_WEBHOOK_SECRET` | Assinatura secreta do webhook **de produção** |
| `MAEVI_PUBLIC_URL` | Endereço oficial da loja, com `https://` e sem barra no final |

Salve e clique em **Reimplantar**. O servidor confere a conta e recusa credenciais que não sejam de produção. Para desligar os pagamentos, use `MAEVI_MP_MODE=disabled`: a loja continua no ar, mas não aceita pedidos.

## 3. No painel da loja (`/admin` → Loja)

O quadro **Pronto para vender?** mostra o que falta:

- **Identificação da loja:** nome ou razão social, CPF ou CNPJ e endereço. É exigida pelo Decreto 7.962/2013 e aparece no rodapé.
- **Política de trocas e devoluções:** use **Começar com um modelo básico** e complete os trechos entre colchetes. O direito de arrependimento de 7 dias (art. 49 do CDC) vale para toda compra online.
- **Contato**, **endereço de retirada** e **nome e valor da entrega**.

## 4. Conferência da primeira venda

1. Cadastre uma peça barata (por exemplo, R$ 5,00) e deixe-a visível.
2. Peça para outra pessoa comprar pelo celular dela, com o Mercado Pago dela. Ninguém consegue pagar para a própria conta.
3. Confira:
   - a cliente volta para a loja e vê **Pagamento aprovado**;
   - o pedido aparece como **Pago** no painel;
   - o valor aparece na sua conta Mercado Pago.
4. No painel, abra o pedido e clique em **Cancelar e estornar**. O valor volta para quem pagou e a peça volta ao estoque.
5. Exclua ou oculte a peça usada na conferência.

## Como funciona depois de ligado

- **Reserva:** ao finalizar, as peças ficam reservadas pelo tempo definido em Loja → Tempo da reserva (padrão de 30 minutos). O Pix gerado vence junto com a reserva.
- **Desistência:** se a cliente não pagar, a reserva volta sozinha para o estoque cerca de 10 minutos depois do vencimento. O servidor confere no Mercado Pago antes de liberar.
- **Aprovação:** confirmada pelo webhook assinado e por consulta direta à API, que confere conta, valor, moeda, referência e ambiente real. A página de retorno nunca confirma um pagamento sozinha.
- **Pagamento em análise por mais de 24 horas,** ou aprovado depois que a reserva venceu, vai para **Pagamento em conferência**. Confira no painel do Mercado Pago e use **Conferido: está pago** ou **Cancelar (conferido no Mercado Pago)**.
- **Cancelamento de pedido pago:** **Cancelar e estornar** devolve o valor integral pelo Mercado Pago e as peças ao estoque. Se o estorno falhar, nada é alterado e o painel mostra o erro.
- **Pedidos pagos** ficam no histórico: não podem ser excluídos nem marcados como "em preparação" antes do pagamento.
- **Buscas:** com o modo real ligado, a vitrine pode aparecer no Google. O painel continua oculto das buscas.

Pendências conhecidas: estorno parcial, e-mail próprio de confirmação (a cliente recebe o comprovante do Mercado Pago) e frete calculado por transportadora.

## Referências oficiais

- [Credenciais](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/additional-content/your-integrations/credentials)
- [Notificações (webhooks)](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/additional-content/your-integrations/notifications/webhooks)
- [Reembolsos](https://www.mercadopago.com.br/developers/pt/reference/chargebacks/_payments_id_refunds/post)
