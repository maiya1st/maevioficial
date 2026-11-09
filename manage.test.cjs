const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {fixture}=require('./testing.cjs');

test('exclusão de peças, pedidos e cupons pelo painel',async t=>{
  const f=fixture(t);
  const del=(url,cookie)=>f.request(url,{method:'DELETE',data:{},headers:cookie?{cookie}:{}});
  for(const url of ['/api/admin/products/1','/api/admin/orders/MV-0000000000000000','/api/admin/coupons/TESTE10'])assert.equal((await del(url)).status,401,url);
  assert.equal((await f.request('/api/admin/products/1',{method:'DELETE',data:{},headers:{'x-maevi-request':''}})).status,403,'exige cabeçalho da loja');
  const cookie=await f.login();
  const products=async()=>(await f.request('/api/admin/products',{headers:{cookie}})).data.products;
  // Peça em pedido em andamento não pode ser excluída.
  const order=await f.createOrder();assert.equal(order.status,201);const id=order.data.order.id;
  const blocked=await del('/api/admin/products/1',cookie);assert.equal(blocked.status,409);assert.match(blocked.data.error,/em andamento/);
  assert.equal((await del('/api/admin/orders/'+id,cookie)).status,409,'pedido aberto não pode ser excluído');
  assert.equal((await f.request('/api/admin/orders/'+id,{method:'PATCH',data:{status:'demo_cancelled'},headers:{cookie}})).status,200);
  assert.equal((await del('/api/admin/orders/'+id,cookie)).status,200);
  assert.equal((await f.request('/api/admin/orders',{headers:{cookie}})).data.orders.length,0);
  assert.equal((await del('/api/admin/orders/'+id,cookie)).status,404);
  // Com confirmação: pedido aberto é cancelado (estoque volta) e excluído; peça em pedido aberto pode ser excluída.
  const second=await f.createOrder({items:[{id:2,size:'M',quantity:2}]},'fixture-order-000002');assert.equal(second.status,201);
  const stockBefore=(await products()).find(p=>p.id===2).stock.M;
  const forced=await f.request('/api/admin/products/2',{method:'DELETE',data:{force:true},headers:{cookie}});assert.equal(forced.status,200);
  const third=await f.createOrder({items:[{id:3,size:'M',quantity:1}]},'fixture-order-000003');assert.equal(third.status,201);
  const stock3=(await products()).find(p=>p.id===3).stock.M;
  assert.equal((await f.request('/api/admin/orders/'+third.data.order.id,{method:'DELETE',data:{force:true},headers:{cookie}})).status,200);
  assert.equal((await products()).find(p=>p.id===3).stock.M,stock3+1,'estoque devolvido ao excluir pedido aberto');
  assert.equal((await f.request('/api/admin/orders/'+second.data.order.id,{method:'DELETE',data:{force:true},headers:{cookie}})).status,200,'pedido com peça já excluída');
  assert.ok(stockBefore>=0);
  // Agora a peça pode sair do catálogo e da vitrine.
  assert.equal((await del('/api/admin/products/1',cookie)).status,200);
  assert.ok(!(await products()).some(p=>p.id===1));
  assert.ok(!(await f.request('/api/products')).data.products.some(p=>p.id===1));
  assert.equal((await del('/api/admin/products/1',cookie)).status,404);
  assert.equal((await f.createOrder({items:[{id:1,size:'M',quantity:1}]},'fixture-order-000009')).status,409,'peça excluída não pode ser comprada');
  // Fotos enviadas e sem uso são apagadas junto com a peça.
  const upload=await f.request('/api/admin/images',{method:'POST',raw:fs.readFileSync(path.join(__dirname,'assets','logo-maevi.png')),headers:{cookie,'content-type':'image/png'}});
  assert.equal(upload.status,201);const file=path.join(f.root,'assets',path.basename(upload.data.image));assert.ok(fs.existsSync(file));
  const base=(await products())[0];const draft={...base,name:'Peça com foto própria',image:upload.data.image};delete draft.id;
  const created=await f.post('/api/admin/products',draft,{cookie});assert.equal(created.status,201);
  assert.equal((await del('/api/admin/products/'+created.data.product.id,cookie)).status,200);assert.ok(!fs.existsSync(file),'foto órfã removida');
  // Cupom.
  assert.equal((await f.post('/api/admin/coupons',{code:'TESTE10',percent:10,minCents:0,maxUses:10,active:true,expiresAt:'',version:0},{cookie})).status,200);
  assert.equal((await del('/api/admin/coupons/TESTE10',cookie)).status,200);
  assert.equal((await f.request('/api/admin/coupons',{headers:{cookie}})).data.coupons.length,0);
  assert.equal((await del('/api/admin/coupons/TESTE10',cookie)).status,404);
  const activity=(await f.request('/api/admin/activity',{headers:{cookie}})).data.activity;
  assert.ok(activity.filter(a=>a.action==='deleted').length>=4);
});
