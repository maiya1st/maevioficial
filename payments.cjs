// Checkout hospedado: a loja nunca recebe números de cartão.
const crypto=require('node:crypto');
const {fail,Problem}=require('./errors.cjs');
function checkoutURL(value){
  try{const u=new URL(value);if(u.protocol==='https:'&&u.hostname==='www.mercadopago.com.br'&&!u.port&&!u.username&&!u.password&&u.pathname.startsWith('/checkout/'))return u.href;}catch{}
  fail(502,'O Mercado Pago retornou um endereço de checkout inválido.');
}
function createGateway({env={},network=fetch,now=Date.now}={}){
  const token=env.MAEVI_MP_ACCESS_TOKEN||'',secret=env.MAEVI_MP_WEBHOOK_SECRET||'';
  let origin='';
  try{const u=new URL(env.MAEVI_PUBLIC_URL);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.pathname==='/'&&!u.search&&!u.hash&&!/^(localhost|127\.|\[|\d+\.)/i.test(u.hostname)&&u.hostname.includes('.'))origin=u.origin;}catch{}
  const configured=env.MAEVI_MP_MODE==='test'&&!!origin&&token.length>=20&&secret.length>=20;
  const options=()=>({configured,mode:configured?'test':'disabled',provider:'mercado_pago',methods:[],message:configured?'Mercado Pago em teste. Use somente conta compradora e cartões de teste.':'Mercado Pago aguardando aplicação, credenciais de teste e endereço HTTPS. Nenhuma cobrança disponível.'});
  function requireReady(){if(!configured)fail(503,'Mercado Pago ainda não configurado para testes. Nenhuma cobrança foi criada.');}
  async function api(route,{method='GET',data,key}={}){
    requireReady();
    try{
      const response=await network('https://api.mercadopago.com'+route,{method,redirect:'error',signal:AbortSignal.timeout(8000),headers:{Authorization:'Bearer '+token,Accept:'application/json',...(data?{'Content-Type':'application/json'}:{}),...(key?{'X-Idempotency-Key':key}:{})},...(data?{body:JSON.stringify(data)}:{})});
      if(!response.ok)fail(502,'O Mercado Pago não concluiu a consulta. Tente atualizar a situação mais tarde.');
      const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>1048576)fail(502,'Resposta do Mercado Pago excedeu o limite.');chunks.push(Buffer.from(chunk));}
      return JSON.parse(Buffer.concat(chunks).toString());
    }catch(e){if(e instanceof Problem)throw e;fail(503,'Não foi possível consultar o Mercado Pago. Confira a situação antes de tentar outro pagamento.');}
  }
  async function seller(){
    const user=await api('/users/me');
    if(!Array.isArray(user.tags)||!user.tags.includes('test_user')||user.site_id!=='MLB'||!/^\d+$/.test(String(user.id)))fail(503,'Use as credenciais da conta vendedora de teste brasileira. Contas reais estão bloqueadas nesta versão.');
    return String(user.id);
  }
  async function createSession(order){
    requireReady();const collectorId=await seller();
    if(!Number.isSafeInteger(order.totalCents)||order.totalCents<1||Date.parse(order.reservationExpiresAt)<=now())fail(409,'A reserva venceu ou o total é inválido.');
    const expiry=new Date(Math.max(Date.parse(order.reservationExpiresAt),now()+30*60000)).toISOString();
    const result=await api('/checkout/preferences',{method:'POST',key:'maevi-'+order.id,data:{items:[{id:order.id,title:'MAÉVI · pedido de teste '+order.id,quantity:1,currency_id:'BRL',unit_price:order.totalCents/100}],external_reference:order.id,back_urls:{success:origin+'/?retorno=mp',pending:origin+'/?retorno=mp',failure:origin+'/?retorno=mp'},auto_return:'approved',notification_url:origin+'/api/payments/mercadopago/webhook',expires:true,expiration_date_from:new Date(now()).toISOString(),expiration_date_to:expiry,payment_methods:{excluded_payment_types:[{id:'ticket'},{id:'bank_transfer'},{id:'atm'}]},metadata:{maevi_order:order.id,environment:'test'}}});
    if(typeof result.id!=='string'||result.id.length>200||String(result.collector_id)!==collectorId||result.external_reference!==order.id)fail(502,'Preferência do Mercado Pago não corresponde à conta ou ao pedido.');
    return {provider:'mercado_pago',mode:'test',status:'pending',preferenceId:result.id,checkoutUrl:checkoutURL(result.init_point),collectorId,expiresAt:expiry};
  }
  function verifyNotification(headers,url){
    requireReady();const id=url.searchParams.get('data.id'),requestId=headers['x-request-id'],signature=headers['x-signature'];
    if(!id||!/^\d{1,30}$/.test(id)||typeof requestId!=='string'||!/^[\w-]{1,100}$/.test(requestId)||typeof signature!=='string')fail(401,'Notificação inválida.');
    const parts=Object.fromEntries(signature.split(',').map(v=>v.trim().split('=')));
    if(!/^\d{10,13}$/.test(parts.ts||'')||!/^[a-f0-9]{64}$/i.test(parts.v1||''))fail(401,'Assinatura inválida.');
    const timestamp=Number(parts.ts)*(parts.ts.length<=10?1000:1);if(Math.abs(now()-timestamp)>300000)fail(401,'Notificação fora do prazo.');
    const digest=crypto.createHmac('sha256',secret).update(`id:${id};request-id:${requestId};ts:${parts.ts};`).digest();
    if(!crypto.timingSafeEqual(digest,Buffer.from(parts.v1,'hex')))fail(401,'Assinatura inválida.');
    return id;
  }
  async function getPayment(id){if(!/^\d{1,30}$/.test(String(id)))fail(400,'Pagamento inválido.');return api('/v1/payments/'+id);}
  async function checkPayment(payment,order){
    const p=order.payment;
    if(payment.live_mode!==false||String(payment.collector_id)!==p.collectorId||payment.currency_id!=='BRL'||!Number.isFinite(payment.transaction_amount)||Math.abs(payment.transaction_amount*100-order.totalCents)>0.001||payment.external_reference!==order.id)fail(409,'Pagamento divergente. A confirmação foi bloqueada.');
    const merchantId=String(payment.order?.id||'');if(!/^\d{1,30}$/.test(merchantId))fail(409,'Pagamento sem vínculo verificável com o checkout.');
    const merchant=await api('/merchant_orders/'+merchantId);
    if(merchant.preference_id!==p.preferenceId||String(merchant.collector?.id)!==p.collectorId||merchant.external_reference!==order.id||!merchant.payments?.some(v=>String(v.id)===String(payment.id)))fail(409,'Pagamento de outro checkout.');
    return payment;
  }
  async function findPayments(order){
    const result=await api('/v1/payments/search?'+new URLSearchParams({external_reference:order.id,sort:'date_created',criteria:'desc',limit:'50'}));
    if(!Array.isArray(result.results)||Number(result.paging?.total||0)>50)fail(502,'Confira este pedido no painel Mercado Pago antes de continuar.');
    return result.results;
  }
  return {options,origin,createSession,verifyNotification,getPayment,checkPayment,findPayments};
}
module.exports={createGateway,checkoutURL};
