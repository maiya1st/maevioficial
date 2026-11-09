const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./testing.cjs');const {inspect}=require('./images.cjs');
const address={cep:'01001000',street:'Praça de Exemplo',number:'100',complement:'Teste',district:'Centro',city:'São Paulo',state:'SP'};
const coupon={code:'BEMVINDA20',percent:20,minCents:0,maxUses:1,active:true,expiresAt:''};
test('configurações são persistidas com versão, validação e acesso protegido',async t=>{
 const f=fixture(t),cookie=await f.login();const original=(await f.request('/api/store')).data;
 assert.equal(original.mode,'live');assert.equal(original.payment.configured,true);assert.ok(!JSON.stringify(original).includes('fixture-admin-key'));
 assert.equal((await f.request('/api/admin/settings')).status,401);assert.equal((await f.request('/api/admin/coupons')).status,401);
 const input={...original.store,email:'loja@example.com',whatsapp:'(11) 99999-8888',instagram:'maevi',deliveryCents:2500};
 const saved=await f.request('/api/admin/settings',{method:'PUT',data:input,headers:{cookie}});assert.equal(saved.status,200);assert.equal(saved.data.store.version,2);assert.equal(saved.data.store.whatsapp,'11999998888');
 assert.equal((await f.request('/api/admin/settings',{method:'PUT',data:input,headers:{cookie}})).status,409);
 for(const changes of [{instagram:'javascript:evil'},{deliveryCents:-1},{reservationMinutes:0},{pickupEnabled:false,deliveryEnabled:false},{deliveryMinDays:20,deliveryMaxDays:2}])assert.equal((await f.request('/api/admin/settings',{method:'PUT',data:{...saved.data.store,...changes},headers:{cookie}})).status,400);
 assert.equal((await f.request('/api/store')).data.store.deliveryCents,2500);
});
test('checkout de entrega valida endereço e recalcula frete, desconto e total',async t=>{
 const f=fixture(t),cookie=await f.login();await f.post('/api/admin/coupons',coupon,{cookie});
 const store=(await f.request('/api/store')).data.store;
 await f.request('/api/admin/settings',{method:'PUT',headers:{cookie},data:{...store,freeShippingFromCents:20000}});
 const shipping={method:'delivery',cep:'01001000',priceCents:0};
 const quote=await f.post('/api/quote',{items:f.orderInput.items,coupon:'BEMVINDA20',shipping});
 assert.equal(quote.status,200);assert.equal(quote.data.discountCents,4998);assert.equal(quote.data.shippingCents,1990);assert.equal(quote.data.totalCents,21982);
 const created=await f.createOrder({shipping,address,coupon:'BEMVINDA20',fulfillment:'demo_delivery',expectedTotalCents:quote.data.totalCents,expectedSettingsVersion:quote.data.settingsVersion});
 assert.equal(created.status,201);assert.equal(created.data.order.address.state,'SP');assert.equal(created.data.order.payment.status,'not_requested');assert.equal(created.data.order.totalCents,21982);
});
test('total ou condições alterados impedem confirmar uma cotação antiga',async t=>{
 const f=fixture(t),cookie=await f.login();
 assert.equal((await f.createOrder({expectedTotalCents:1})).status,409);
 const store=(await f.request('/api/store')).data.store;await f.request('/api/admin/settings',{method:'PUT',headers:{cookie},data:{...store,deliveryCents:3000}});
 assert.equal((await f.createOrder({expectedSettingsVersion:1})).status,409);
 assert.equal((await f.request('/api/products')).data.products[0].stock.M,5);
});
test('endereço e contato malformados nunca reservam estoque',async t=>{
 const f=fixture(t);
 for(const changes of [{customer:{...f.orderInput.customer,phone:'123'}},{fulfillment:'demo_delivery',shipping:{method:'delivery',cep:'01001000'},address:{...address,state:'ZZ'}},{fulfillment:'demo_delivery',shipping:{method:'delivery',cep:'01001000'},address:{...address,cep:'20040020'}},{fulfillment:'demo_delivery',shipping:{method:'pickup'}},{fulfillment:'demo_delivery',shipping:{method:'delivery',cep:'01001000'},address:null}])assert.equal((await f.createOrder(changes)).status,400);
 assert.equal((await f.request('/api/products')).data.products[0].stock.M,5);
});
test('duas tentativas disputam o último uso de um cupom sem ultrapassar o limite',async t=>{
 const f=fixture(t),cookie=await f.login();assert.equal((await f.post('/api/admin/coupons',coupon,{cookie})).status,200);
 const responses=await Promise.all([f.createOrder({coupon:coupon.code},'coupon-race-000001'),f.createOrder({coupon:coupon.code},'coupon-race-000002')]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
 const created=responses.find(r=>r.status===201).data;
 assert.equal((await f.request('/api/admin/coupons',{headers:{cookie}})).data.coupons[0].used,1);
 const tokenHeaders={'x-order-token':created.token};
 assert.equal((await f.post('/api/orders/'+created.order.id+'/cancel',{},tokenHeaders)).status,200);
 assert.equal((await f.post('/api/orders/'+created.order.id+'/cancel',{},tokenHeaders)).status,409);
 assert.equal((await f.request('/api/admin/coupons',{headers:{cookie}})).data.coupons[0].used,0);
 assert.equal((await f.createOrder({coupon:coupon.code},'coupon-race-000003')).status,201);
});
test('cupom respeita expiração, mínimo, ativo e versão de edição',async t=>{
 const f=fixture(t),cookie=await f.login();let c=(await f.post('/api/admin/coupons',{...coupon,minCents:99999},{cookie})).data.coupon;
 assert.equal((await f.post('/api/quote',{items:f.orderInput.items,coupon:c.code})).status,409);
 c=(await f.post('/api/admin/coupons',{...c,minCents:0,expiresAt:'2020-01-01T00:00:00.000Z'},{cookie})).data.coupon;
 assert.equal((await f.post('/api/quote',{items:f.orderInput.items,coupon:c.code})).status,409);
 assert.equal((await f.post('/api/admin/coupons',{...c,version:0},{cookie})).status,409);
 c=(await f.post('/api/admin/coupons',{...c,expiresAt:'',active:false},{cookie})).data.coupon;
 assert.equal((await f.post('/api/quote',{items:f.orderInput.items,coupon:c.code})).status,409);
 assert.equal((await f.post('/api/quote',{items:f.orderInput.items,coupon:'<script>'})).status,400);
});
test('expiração libera estoque e cupom uma vez e a repetição retorna o pedido expirado',async t=>{
 const f=fixture(t),cookie=await f.login();await f.post('/api/admin/coupons',coupon,{cookie});const result=await f.createOrder({coupon:coupon.code});assert.equal(result.status,201);
 f.advance(31*60000);assert.equal(await f.app.runMaintenance(),1);assert.equal(await f.app.runMaintenance(),0);
 const expired=await f.request('/api/orders/'+result.data.order.id,{headers:{'x-order-token':result.data.token}});assert.equal(expired.data.order.status,'demo_expired');
 assert.equal((await f.request('/api/products')).data.products[0].stock.M,5);const renewed=await f.login();assert.equal((await f.request('/api/admin/coupons',{headers:{cookie:renewed}})).data.coupons[0].used,0);
 const retry=await f.createOrder({coupon:coupon.code});assert.equal(retry.status,200);assert.equal(retry.data.order.id,result.data.order.id);assert.equal(retry.data.order.status,'demo_expired');
});
test('pedido sem pagamento não pode ir para preparação pelo painel',async t=>{
 const f=fixture(t),cookie=await f.login(),result=await f.createOrder();
 const status=await f.request('/api/admin/orders/'+result.data.order.id,{method:'PATCH',headers:{cookie},data:{status:'demo_preparing'}});assert.equal(status.status,409);
 assert.equal((await f.request('/api/products')).data.products[0].stock.M,4);
 assert.equal((await f.request('/api/admin/orders/'+result.data.order.id,{method:'PATCH',headers:{cookie},data:{status:'demo_cancelled'}})).status,200);
 assert.equal((await f.request('/api/products')).data.products[0].stock.M,5);
});
test('cancelamento exige token; um cliente não cancela pedido alheio',async t=>{
 const f=fixture(t),created=await f.createOrder(),url='/api/orders/'+created.data.order.id+'/cancel';
 assert.equal((await f.post(url,{})).status,404);assert.equal((await f.post(url,{}, {'x-order-token':'forged'})).status,404);
 assert.equal((await f.request('/api/products')).data.products[0].stock.M,4);
});
test('sem Mercado Pago configurado a loja não aceita pedidos',async t=>{
 const f=fixture(t,{paymentEnv:{}}),created=await f.createOrder();
 assert.equal(created.status,503);assert.match(created.data.error,/indisponíveis/);
 assert.equal((await f.request('/api/products')).data.products[0].stock.M,5,'nada é reservado');
 assert.equal((await f.request('/api/store')).data.payment.configured,false);
});
test('consulta de CEP usa host fixo, limita campos e faz cache sem enviar dados pessoais',async t=>{
 const calls=[];const f=fixture(t,{network:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({logradouro:'Praça Exemplo',bairro:'Centro',localidade:'São Paulo',uf:'SP',unexpected:'discard'}));}});
 const first=await f.request('/api/postal-code/01001000');assert.equal(first.status,200);assert.deepEqual(Object.keys(first.data.address).sort(),['cep','city','district','state','street']);
 assert.equal((await f.request('/api/postal-code/01001000')).status,200);assert.equal(calls.length,1);assert.equal(calls[0].url,'https://viacep.com.br/ws/01001000/json/');assert.equal(calls[0].options.redirect,'error');
 assert.equal((await f.request('/api/postal-code/00000000')).status,400);assert.equal(calls.length,1);
});
test('CEP inexistente, falha externa e resposta excessiva são tratados sem impedir preenchimento manual',async t=>{
 const missing=fixture(t,{network:async()=>new Response(JSON.stringify({erro:true}))});assert.equal((await missing.request('/api/postal-code/01001000')).status,404);
 const offline=fixture(t,{network:async()=>{throw Error('private upstream detail');}});const failure=await offline.request('/api/postal-code/01001000');assert.equal(failure.status,503);assert.ok(!failure.text.includes('private upstream'));
 const oversized=fixture(t,{network:async()=>new Response('x'.repeat(17000))});assert.equal((await oversized.request('/api/postal-code/01001000')).status,502);
});
test('fotos exigem sessão, tipo real e limite; nomes de arquivo não são controlados pelo cliente',async t=>{
 const f=fixture(t),cookie=await f.login(),bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=','base64');
 const upload=(raw,headers={})=>f.request('/api/admin/images',{method:'POST',raw,headers:{cookie,'content-type':'image/png',...headers}});
 assert.equal((await upload(bytes,{cookie:''})).status,401);assert.equal((await upload(Buffer.from('<svg><script>evil()</script></svg>'),{'content-type':'image/svg+xml'})).status,415);
 assert.equal((await upload(bytes,{'content-type':'image/jpeg'})).status,400);assert.equal((await upload(Buffer.from('not an image'))).status,400);
 assert.equal((await upload(bytes,{'content-length':'4194305'})).status,413);
 const saved=await upload(bytes,{'x-file-name':'../../data/admin-key.txt'});assert.equal(saved.status,201);assert.match(saved.data.image,/^\/assets\/upload-[a-f0-9]{24}\.png$/);
 const served=await f.request(saved.data.image);assert.equal(served.status,200);assert.equal(served.headers['content-type'],'image/png');assert.deepEqual(served.bytes,bytes);
 assert.equal(fs.readdirSync(path.join(f.root,'assets')).length,1);
});
test('inspeção de imagens rejeita arquivos truncados e dimensões excessivas',()=>{
 const jpg=fs.readFileSync(path.join(__dirname,'assets/editorial-1.jpg'));assert.equal(inspect(jpg,'image/jpeg').extension,'jpg');
 assert.throws(()=>inspect(jpg.subarray(0,100),'image/jpeg'));
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=','base64');png.writeUInt32BE(20000,16);assert.throws(()=>inspect(png,'image/png'));
});
test('backup usa snapshot consistente do SQLite e inclui assets sem expor um endpoint público',async t=>{
 const f=fixture(t);await f.createOrder();fs.writeFileSync(path.join(f.root,'assets','example.txt'),'backup test');
 const {backup}=require('./backup.cjs');const folder=backup({dataDir:path.join(f.root,'data'),assetDir:path.join(f.root,'assets'),destination:path.join(f.root,'backups')});
 const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(path.join(folder,'maevi.sqlite'),{readOnly:true});
 try{assert.equal(db.prepare('SELECT count(*) AS total FROM orders').get().total,1);assert.equal(Object.values(db.prepare('PRAGMA quick_check').get())[0],'ok');}finally{db.close();}
 assert.equal(fs.readFileSync(path.join(folder,'assets','example.txt'),'utf8'),'backup test');assert.equal(JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'))).containsPrivateData,true);
 assert.equal((await f.request('/data/backups/manifest.json')).status,404);
});
