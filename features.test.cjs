const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./testing.cjs');

test('peças: compre o look, cores ligadas e tabela de medidas',async t=>{
  const f=fixture(t),cookie=await f.login();
  const list=async()=>(await f.request('/api/admin/products',{headers:{cookie}})).data.products;
  const p=(await list()).find(x=>x.id===1);
  const put=data=>f.request('/api/admin/products/1',{method:'PUT',data:{...p,version:p.version||0,...data},headers:{cookie}});
  for(const bad of [{look:[1]},{look:[2,3,4,5,6,7,8]},{look:'2'},{colorGroup:'Grupo Inválido'},{sizeChart:{columns:[],rows:{}}},{sizeChart:{columns:['Busto'],rows:{P:['84','90']}}},{sizeChart:{columns:['<b>'],rows:{P:['1']}}}])
    assert.equal((await put(bad)).status,400,JSON.stringify(bad));
  const saved=await put({look:[2,3,3],colorGroup:'aurora',sizeChart:{columns:['Busto','Cintura'],rows:{P:['84','66'],M:['88','70'],XG:['1','2'],G:['','']}}});
  assert.equal(saved.status,200);
  assert.deepEqual(saved.data.product.look,[2,3]);assert.equal(saved.data.product.colorGroup,'aurora');
  assert.deepEqual(saved.data.product.sizeChart,{columns:['Busto','Cintura'],rows:{P:['84','66'],M:['88','70']}},'tamanho inexistente e linha vazia ignorados');
  const pub=(await f.request('/api/products')).data.products.find(x=>x.id===1);assert.deepEqual(pub.look,[2,3]);assert.equal(pub.sizeChart.columns[0],'Busto');
});

test('avise-me quando chegar',async t=>{
  const f=fixture(t);
  const alert=data=>f.post('/api/alerts',{productId:1,size:'M',contact:'cliente@example.com',consent:true,...data});
  assert.equal((await alert({consent:false})).status,400);
  assert.equal((await alert({productId:999})).status,404);
  assert.equal((await alert({size:'XXG'})).status,400);
  assert.equal((await alert({contact:'abc'})).status,400);
  assert.equal((await alert({})).status,201);assert.equal((await alert({contact:'CLIENTE@example.com'})).status,201,'repetido não duplica');
  assert.equal((await alert({contact:'(41) 99999-8888'})).status,201);
  assert.equal((await f.request('/api/admin/alerts')).status,401);
  const cookie=await f.login();let alerts=(await f.request('/api/admin/alerts',{headers:{cookie}})).data.alerts;
  assert.equal(alerts.length,2);assert.deepEqual(alerts.map(a=>a.type).sort(),['email','whatsapp']);assert.equal(alerts.find(a=>a.type==='whatsapp').contact,'41999998888');
  const id=alerts[0].id;
  assert.equal((await f.request('/api/admin/alerts/'+id,{method:'PATCH',data:{status:'notified'},headers:{cookie}})).status,200);
  assert.equal((await f.request('/api/admin/alerts',{headers:{cookie}})).data.alerts.find(a=>a.id===id).status,'notified');
  assert.equal((await f.request('/api/admin/alerts/'+id,{method:'DELETE',data:{},headers:{cookie}})).status,200);
  assert.equal((await f.request('/api/admin/alerts',{headers:{cookie}})).data.alerts.length,1);
});

test('pop-up de boas-vindas e cupom de primeira compra',async t=>{
  const f=fixture(t),cookie=await f.login();
  const store=async()=>(await f.request('/api/store')).data.store;
  const settings=async changes=>{const s=(await f.request('/api/admin/settings',{headers:{cookie}})).data.store;return f.request('/api/admin/settings',{method:'PUT',data:{...s,...changes},headers:{cookie}});};
  assert.equal((await settings({welcomeEnabled:true,welcomeCoupon:'BEMVINDA10'})).status,400,'cupom precisa existir');
  assert.equal((await f.post('/api/admin/coupons',{code:'BEMVINDA10',percent:10,minCents:0,maxUses:100,active:true,expiresAt:'',firstPurchase:true,version:0},{cookie})).status,200);
  assert.equal((await settings({welcomeEnabled:true,welcomeCoupon:'bemvinda10'})).status,200);
  const pub=await store();assert.deepEqual(pub.welcome,{percent:10,minCents:0});assert.ok(!JSON.stringify(pub).includes('BEMVINDA10'),'código não aparece sem cadastro');
  assert.equal((await f.post('/api/subscribers',{email:'nova@example.com',consent:false})).status,400);
  assert.equal((await f.post('/api/subscribers',{email:'(41) 99999-8888',consent:true})).status,400);
  const sub=await f.post('/api/subscribers',{email:'Nova@Example.com',consent:true});assert.equal(sub.status,201);assert.equal(sub.data.coupon.code,'BEMVINDA10');
  assert.equal((await f.post('/api/subscribers',{email:'nova@example.com',consent:true})).status,201);
  assert.equal((await f.request('/api/admin/subscribers',{headers:{cookie}})).data.subscribers.length,1);
  // Primeira compra: exige e-mail e só vale uma vez por cliente.
  const base={items:[{id:1,size:'M',quantity:1}],coupon:'BEMVINDA10',shipping:{method:'pickup'}};
  assert.equal((await f.post('/api/quote',base)).status,409);
  const ok=await f.post('/api/quote',{...base,customer:{email:'nova@example.com'}});assert.equal(ok.status,200);assert.equal(ok.data.discountCents,2499);
  const order=await f.createOrder({coupon:'BEMVINDA10',customer:{name:'Nova Cliente',email:'nova@example.com',phone:'41999998888'}});assert.equal(order.status,201);
  assert.equal((await f.post('/api/quote',{...base,customer:{email:'NOVA@example.com'}})).status,409,'segunda compra recusa o cupom');
  await f.request('/api/admin/orders/'+order.data.order.id,{method:'PATCH',data:{status:'demo_cancelled'},headers:{cookie}});
  assert.equal((await f.post('/api/quote',{...base,customer:{email:'nova@example.com'}})).status,200,'pedido cancelado não conta');
  assert.equal((await f.request('/api/admin/subscribers',{method:'DELETE',data:{email:'nova@example.com'},headers:{cookie}})).status,200);
  assert.equal((await f.request('/api/admin/subscribers',{headers:{cookie}})).data.subscribers.length,0);
  assert.equal((await settings({welcomeEnabled:false})).status,200);assert.equal((await store()).welcome,null);
});

test('até 8 fotos por peça',async t=>{
  const f=fixture(t),cookie=await f.login();
  const p=(await f.request('/api/admin/products',{headers:{cookie}})).data.products.find(x=>x.id===1);
  const put=data=>f.request('/api/admin/products/1',{method:'PUT',data:{...p,version:p.version||0,...data},headers:{cookie}});
  const photos=n=>Array.from({length:n},(_,i)=>`/assets/foto-${i}.jpg`);
  assert.equal((await put({secondaryImage:'',extraImages:photos(1)})).status,400,'extra sem segunda foto');
  assert.equal((await put({secondaryImage:'/assets/b.jpg',extraImages:photos(7)})).status,400,'mais de 8 fotos');
  assert.equal((await put({secondaryImage:'/assets/b.jpg',extraImages:['javascript:alert(1)']})).status,400);
  const ok=await put({secondaryImage:'/assets/b.jpg',extraImages:[...photos(6)]});assert.equal(ok.status,200);assert.equal(ok.data.product.extraImages.length,6);
  assert.deepEqual((await f.request('/api/products')).data.products.find(x=>x.id===1).extraImages,photos(6));
});
