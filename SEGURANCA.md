# MAÉVI · segurança

Resumo das proteções da loja. Elas são conferidas pelos testes automáticos (`npm run test:all`) antes de cada publicação. Isso não garante ausência de vulnerabilidades: mantenha Node.js, dependências e credenciais em dia.

| Área | Proteção |
| --- | --- |
| Painel | Login com e-mail e senha (scrypt, comparação em tempo constante). A chave administrativa serve para recuperação. Limite de 10 tentativas por minuto. Trocar a senha encerra as outras sessões |
| Sessão | Cookie HttpOnly, SameSite=Strict e Secure em HTTPS. Expira após 30 minutos sem uso ou 8 horas. Limite de 32 sessões |
| Origem e CSRF | Host exato, Origin conferido, Fetch Metadata e cabeçalho próprio em toda escrita. Sem CORS aberto |
| Conteúdo | CSP só com scripts do próprio domínio, sem scripts inline. Escape de todo texto exibido. Validação de URLs de imagem |
| Checkout | Preço, frete, cupom e total calculados no servidor. Total alterado precisa ser conferido de novo. Tentativas idempotentes não duplicam pedidos |
| Estoque | Reserva e baixa na mesma transação, devolução única no cancelamento ou na expiração, proteção da última unidade |
| Pagamento | A loja não recebe dados de cartão. Webhook com assinatura HMAC e janela de 5 minutos. Aprovação só após consultar a API e conferir conta, valor, moeda, referência, ambiente real e vínculo com a preferência. Página de retorno nunca aprova sozinha |
| Estorno | Feito pelo painel com chave idempotente. Pedido pago não pode ser excluído nem preparado antes do pagamento |
| Consulta do pedido | Exige o número e a chave privada em cabeçalho. A chave na URL não autentica |
| Fotos | Só JPG, PNG e WebP de até 4 MB e 40 megapixels, com nomes aleatórios. Cota de 100 MB ou 400 arquivos. Fotos sem uso são apagadas com a peça |
| Banco | Consultas parametrizadas. Arquivos do banco, chave e `.env` nunca são servidos pelo HTTP |
| HTTP | Limites de corpo, cabeçalhos, conexões e tempo, além de limitação de taxa por endereço |
| Busca | Vitrine indexável só com o pagamento ligado. Painel sempre `noindex` |

## Cuidados da operação

- Não compartilhe a chave do painel, o Access Token ou a assinatura do webhook. Se vazarem, gere novos no Mercado Pago e troque `MAEVI_ADMIN_KEY` na Hostinger.
- Use uma senha longa e exclusiva no painel.
- Confira periodicamente os backups do banco na Hostinger.
