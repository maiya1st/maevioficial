const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {fixture}=require('./testing.cjs');const {createGateway,checkoutURL}=require('./payments.cjs');
const env={MAEVI_MP_MODE:'test',MAEVI_MP_ACCESS_TOKEN:'APP_USR-fixture-no-real-token',MAEVI_MP_WEBHOOK_SECRET:'fixture-no-real-secret-12345',MAEVI_PUBLIC_URL:'https://maevi.example'};
function provider(){
  const state={calls:[],preferences:0,results:[],payments:{},seller:{id:123,site_id:'MLB',tags:['test_user']},merchant:{preference_id:'pref-test',collector:{id:123},payments:[{id:42},{id:43}]}};
  state.network=async(value,options)=>{
    const u=new URL(value);state.calls.push({url:u.href,options});assert.equal(u.origin,'https://api.mercadopago.com');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+env.MAEVI_MP_ACCESS_TOKEN);
    let result;if(u.pathname==='/users/me')result=state.seller;
    else if(u.pathname==='/checkout/preferences'){state.preferences++;const body=JSON.parse(options.body);state.payload=body;state.merchant.external_reference=body.external_reference;result={id:'pref-test',collector_id:123,external_reference:body.external_reference,init_point:'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-test'};}
    else if(u.pathname==='/v1/payments/search')result={results:state.results,paging:{total:state.results.length}};
    else if(u.pathname.startsWith('/v1/payments/'))result=state.payments[u.pathname.split('/').pop()];
    else if(u.pathname==='/merchant_orders/99')result=state.merchant;
    else throw Error('Unexpected provider route');
    return new Response(JSON.stringify(result),{status:200});
  };return state;
}
async function setup(t){
  const p=provider(),f=fixture(t,{paymentEnv:env,paymentNetwork:p.network}),r=await f.createOrder();assert.equal(r.status,201);
  const {order,token}=r.data;const headers={'x-order-token':token};
  const action=name=>f.post('/api/orders/'+order.id+'/'+name,{},headers);
  const lookup=async()=> (await f.request('/api/orders/'+order.id,{headers})).data.order;
  const payment=(changes={})=>({id:42,external_reference:order.id,live_mode:false,collector_id:123,currency_id:'BRL',transaction_amount:order.totalCents/100,status:'approved',order:{id:99},date_created:new Date().toISOString(),date_last_updated:new Date().toISOString(),date_approved:new Date().toISOString(),...changes});
  function webhook(id=42,overrides={}){const ts=String(Date.now()),requestId='fixture-request',v1=crypto.createHmac('sha256',env.MAEVI_MP_WEBHOOK_SECRET).update(`id:${id};request-id:${requestId};ts:${ts};`).digest('hex');return f.post('/api/payments/mercadopago/webhook?data.id='+id,{type:'payment',data:{id}}, {'x-maevi-request':undefined,'x-request-id':requestId,'x-signature':`ts=${ts},v1=${v1}`,...overrides});}
  return {...f,p,order,action,lookup,payment,webhook};
}
test('configuração incompleta, produção e localhost nunca ativam cobrança',async()=>{
  for(const changes of [{MAEVI_MP_MODE:'production'},{MAEVI_PUBLIC_URL:'http://localhost:5173'},{MAEVI_MP_ACCESS_TOKEN:''},{MAEVI_MP_WEBHOOK_SECRET:''},{MAEVI_PUBLIC_URL:'https://example.com/path'}]){
    const g=createGateway({env:{...env,...changes},network:()=>{throw Error('network forbidden');}});assert.equal(g.options().configured,false);await assert.rejects(g.createSession({}),e=>e.status===503);
  }
  for(const value of ['javascript:alert(1)','https://www.mercadopago.com.br.evil.test/checkout/a','https://evil.test/checkout/a','https://user@www.mercadopago.com.br/checkout/a'])assert.throws(()=>checkoutURL(value));
});
test('sessão usa total do banco, conta de teste, HTTPS e uma preferência por pedido',async t=>{
  const f=await setup(t);const both=await Promise.all([f.action('payment-session'),f.action('payment-session')]);assert.equal(both.filter(r=>r.status===200).length,1);assert.equal(f.p.preferences,1);
  const again=await f.action('payment-session');assert.equal(again.status,200);assert.equal(f.p.preferences,1);assert.equal(f.p.payload.items[0].unit_price,f.order.totalCents/100);assert.equal(f.p.payload.back_urls.success,'https://maevi.example/?retorno=mp');assert.equal(f.p.payload.notification_url,'https://maevi.example/api/payments/mercadopago/webhook');assert.equal(f.p.payload.payer,undefined);
  const options=await f.request('/api/store');assert.ok(!options.text.includes(env.MAEVI_MP_ACCESS_TOKEN));assert.ok(!again.text.includes(env.MAEVI_MP_ACCESS_TOKEN));
});
test('conta vendedora real é bloqueada antes de criar preferência',async t=>{
  const f=await setup(t);f.p.seller.tags=[];assert.equal((await f.action('payment-session')).status,503);assert.equal(f.p.preferences,0);assert.equal((await f.lookup()).status,'demo_payment_review');
});
test('reserva de pagamento não expira nem cancela enquanto depende do provedor',async t=>{
  const f=await setup(t);await f.action('payment-session');f.advance(60*60000);f.app.runMaintenance();assert.equal((await f.lookup()).status,'demo_payment_pending');assert.equal((await f.action('cancel')).status,409);
  assert.equal((await f.action('payment-refresh')).data.order.status,'demo_payment_review');
  const cookie=await f.login();assert.equal((await f.request('/api/admin/orders/'+f.order.id,{method:'PATCH',data:{status:'demo_cancelled'},headers:{cookie}})).status,409);
});
test('webhook falso, antigo e corpo divergente não consultam API nem aprovam pedido',async t=>{
  const f=await setup(t);await f.action('payment-session');const before=f.p.calls.length;
  assert.equal((await f.webhook(42,{'x-signature':'ts=1,v1='+'0'.repeat(64)})).status,401);
  assert.equal((await f.webhook(42,{'x-signature':'ts='+Date.now()+',v1='+'0'.repeat(64)})).status,401);
  assert.equal((await f.webhook(42,{'x-request-id':'other'})).status,401);assert.equal(f.p.calls.length,before);assert.equal((await f.lookup()).status,'demo_payment_pending');
  const ts=String(Date.now()-600000),v1=crypto.createHmac('sha256',env.MAEVI_MP_WEBHOOK_SECRET).update(`id:42;request-id:fixture-request;ts:${ts};`).digest('hex');
  assert.equal((await f.webhook(42,{'x-signature':`ts=${ts},v1=${v1}`})).status,401);
  const currentTs=String(Date.now()),signature=crypto.createHmac('sha256',env.MAEVI_MP_WEBHOOK_SECRET).update(`id:42;request-id:fixture-request;ts:${currentTs};`).digest('hex');
  assert.equal((await f.post('/api/payments/mercadopago/webhook?data.id=42',{type:'payment',data:{id:43}},{'x-request-id':'fixture-request','x-signature':`ts=${currentTs},v1=${signature}`})).status,400);
  assert.equal(f.p.calls.length,before);
});
test('webhook assinado consulta API; duplicata não repete transição e retorno falso não aprova',async t=>{
  const f=await setup(t);await f.action('payment-session');assert.equal((await f.request('/?retorno=mp&status=approved')).status,200);assert.equal((await f.lookup()).status,'demo_payment_pending');
  f.p.payments[42]=f.payment();assert.equal((await f.webhook()).status,200);let order=await f.lookup();assert.equal(order.status,'demo_paid');const count=order.history.length;
  assert.equal((await f.webhook()).status,200);order=await f.lookup();assert.equal(order.history.length,count);
  const cookie=await f.login();assert.equal((await f.request('/api/admin/orders/'+f.order.id,{method:'PATCH',data:{status:'demo_preparing'},headers:{cookie}})).status,200);
  await f.webhook();assert.equal((await f.lookup()).status,'demo_preparing');
  assert.equal((await f.request('/api/admin/orders/'+f.order.id,{method:'PATCH',data:{status:'demo_cancelled'},headers:{cookie}})).status,409);
});
test('valor, moeda, ambiente, vendedor e preferência divergentes bloqueiam aprovação',async t=>{
  const f=await setup(t);await f.action('payment-session');
  for(const bad of [{transaction_amount:0.01},{currency_id:'USD'},{live_mode:true},{collector_id:999},{order:{id:'../1'}}]){f.p.payments[42]=f.payment(bad);assert.equal((await f.webhook()).status,409);assert.equal((await f.lookup()).status,'demo_payment_pending');}
  f.p.payments[42]=f.payment();f.p.merchant.preference_id='other';assert.equal((await f.webhook()).status,409);assert.equal((await f.lookup()).status,'demo_payment_pending');
});
test('atualizar situação reconcilia aprovação; evento atrasado não regride e estorno pede conferência',async t=>{
  const f=await setup(t);await f.action('payment-session');f.p.payments[42]=f.payment();f.p.results=[{id:42}];assert.equal((await f.action('payment-refresh')).data.order.status,'demo_paid');
  f.p.payments[42]=f.payment({status:'pending',date_last_updated:'2020-01-01T00:00:00Z'});await f.webhook();assert.equal((await f.lookup()).payment.status,'approved');
  f.p.payments[42]=f.payment({status:'refunded',date_last_updated:new Date(Date.now()+1000).toISOString()});await f.webhook();assert.equal((await f.lookup()).status,'demo_payment_review');
});
test('aprovação após validade fica em conferência sem devolver estoque',async t=>{
  const f=await setup(t);await f.action('payment-session');const before=(await f.request('/api/products')).data.products.find(p=>p.id===1).stock.M;
  const o=await f.lookup();f.p.payments[42]=f.payment({date_approved:new Date(Date.parse(o.payment.expiresAt)+1000).toISOString()});await f.webhook();assert.equal((await f.lookup()).status,'demo_payment_review');
  assert.equal((await f.request('/api/products')).data.products.find(p=>p.id===1).stock.M,before);
});
test('segundo pagamento aprovado exige conferência e mantém a primeira aprovação registrada',async t=>{
  const f=await setup(t);await f.action('payment-session');f.p.payments[42]=f.payment();await f.webhook();f.p.payments[43]=f.payment({id:43});assert.equal((await f.webhook(43)).status,200);const order=await f.lookup();assert.equal(order.status,'demo_payment_review');assert.equal(order.payment.paymentId,'42');
});
test('notificação autêntica sem referência MAÉVI é ignorada sem afetar reservas',async t=>{
  const f=await setup(t);await f.action('payment-session');f.p.payments[42]=f.payment({external_reference:null});assert.equal((await f.webhook()).status,200);assert.equal((await f.lookup()).status,'demo_payment_pending');
});
test('falha remota depois da tentativa retém reserva e impede nova preferência automática',async t=>{
  let attempts=0;const f=fixture(t,{paymentEnv:env,paymentNetwork:async(url)=>{if(url.endsWith('/users/me'))return new Response(JSON.stringify({id:123,tags:['test_user'],site_id:'MLB'}));attempts++;throw Error('timeout with secret data');}});
  const r=await f.createOrder(),url='/api/orders/'+r.data.order.id+'/payment-session',headers={'x-order-token':r.data.token};
  const a=await f.post(url,{},headers);assert.equal(a.status,503);assert.ok(!a.text.includes('secret data'));assert.equal((await f.post(url,{},headers)).status,409);assert.equal(attempts,1);
});
test('host público não abre painel nem arquivos privados; webhook sem assinatura é rejeitado',async t=>{
  const f=await setup(t);for(const route of ['/admin','/admin.html','/api/admin/settings','/admin.js','/operations.js'])assert.equal((await f.request(route,{headers:{host:'maevi.example'}})).status,403);
  assert.equal((await f.request('/',{headers:{host:'maevi.example'}})).status,200);
  assert.equal((await f.request('/api/admin/settings',{headers:{'x-forwarded-for':'1.2.3.4'}})).status,403);
  for(const route of ['/.env.local','/.env.local.example','/payments.cjs'])assert.equal((await f.request(route)).status,404);
  assert.equal((await f.post('/api/payments/mercadopago/webhook?data.id=42',{type:'payment',data:{id:42}},{host:'maevi.example','x-maevi-request':undefined})).status,401);
});
