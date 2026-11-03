// Integração real opcional: servidor descartável em loopback, nunca o banco da loja.
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const mysql=require('mysql2/promise');const {fixture}=require('./testing.cjs');
const port=Number(process.env.MAEVI_MYSQL_TEST_PORT);if(!Number.isInteger(port)||port<1024)throw Error('Defina MAEVI_MYSQL_TEST_PORT para o MariaDB local descartável.');
const config={host:'127.0.0.1',port,user:'root',password:'maevi-local-qa-only'};
async function setup(t){const admin=await mysql.createConnection(config),database='maevi_qa_'+crypto.randomBytes(12).toString('hex');await admin.query('CREATE DATABASE `'+database+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');const settings={...config,database};const f=fixture(t,{mysql:settings});await f.app.ready;
  t.after(async()=>{if(!/^maevi_qa_[a-f0-9]{24}$/.test(database))throw Error('Nome de teste inválido.');await admin.query('DROP DATABASE `'+database+'`');await admin.end();});return {...f,settings,admin};}
test('MariaDB: pedidos, cupom, frete, idempotência e rollback são persistentes',async t=>{
  const f=await setup(t),cookie=await f.login();const c=await f.post('/api/admin/coupons',{code:'TESTE10',percent:10,minCents:0,maxUses:1,expiresAt:'',active:true},{cookie});assert.equal(c.status,200);
  const r=await f.createOrder({coupon:'TESTE10'});assert.equal(r.status,201);assert.equal(r.data.order.discountCents,2499);
  assert.equal((await f.createOrder({coupon:'TESTE10'})).data.reused,true);
  const bad=await f.createOrder({items:[{id:1,size:'M',quantity:20}]},'mysql-out-of-stock-00001');assert.equal(bad.status,409);
  const stock=(await f.request('/api/products')).data.products.find(p=>p.id===1).stock.M;assert.equal(stock,4);
  const second=fixture(t,{mysql:f.settings});await second.app.ready;assert.equal((await second.request('/api/products')).data.products.find(p=>p.id===1).stock.M,stock);
  // Ensure connection is released before the owner fixture drops this database.
  await second.app.close();
});
test('MariaDB: duas instâncias disputam a última peça sem venda duplicada',async t=>{
  const f=await setup(t),cookie=await f.login(),product=(await f.request('/api/admin/products',{headers:{cookie}})).data.products[0];
  product.stock.M=1;product.version=product.version||0;assert.equal((await f.request('/api/admin/products/1',{method:'PUT',data:product,headers:{cookie}})).status,200);
  const second=fixture(t,{mysql:f.settings});await second.app.ready;
  const responses=await Promise.all([f.createOrder({},'mysql-race-order-00001'),second.createOrder({},'mysql-race-order-00002')]);assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);assert.equal((await f.request('/api/products')).data.products[0].stock.M,0);
  const valid=responses.find(r=>r.status===201).data;assert.equal((await f.post('/api/orders/'+valid.order.id+'/cancel',{}, {'x-order-token':valid.token})).status,200);assert.equal((await f.request('/api/products')).data.products[0].stock.M,1);await second.app.close();
});
test('MariaDB: expiração devolve estoque uma vez e filtros de prazo funcionam',async t=>{
  const f=await setup(t);await f.createOrder();f.advance(31*60000);assert.equal(await f.app.runMaintenance(),1);assert.equal(await f.app.runMaintenance(),0);assert.equal((await f.request('/api/products')).data.products[0].stock.M,5);
});
test('MariaDB: foto binária e catálogo editado sobrevivem ao reinício da aplicação',async t=>{
  const f=await setup(t),cookie=await f.login(),bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=','base64');
  const r=await f.request('/api/admin/images',{method:'POST',raw:bytes,headers:{cookie,'content-type':'image/png'}});assert.equal(r.status,201);
  const product=(await f.request('/api/admin/products',{headers:{cookie}})).data.products[0];product.name='Peça com acento · MAÉVI 🌿';product.image=r.data.image;product.version=product.version||0;assert.equal((await f.request('/api/admin/products/1',{method:'PUT',data:product,headers:{cookie}})).status,200);
  const second=fixture(t,{mysql:f.settings});await second.app.ready;const image=await second.request(r.data.image);assert.equal(image.status,200);assert.deepEqual(image.bytes,bytes);assert.equal((await second.request('/api/products')).data.products[0].name,product.name);await second.app.close();
});
test('MariaDB: erro ao inserir pedido reverte a baixa de estoque e o uso de cupom',async t=>{
  const f=await setup(t),cookie=await f.login(),database=f.settings.database;
  await f.post('/api/admin/coupons',{code:'ROLLBACK',percent:10,minCents:0,maxUses:1,expiresAt:'',active:true},{cookie});
  await f.admin.query('CREATE TRIGGER `'+database+'`.maevi_test_fail BEFORE INSERT ON `'+database+'`.orders FOR EACH ROW SIGNAL SQLSTATE \'45000\' SET MESSAGE_TEXT=\'fixture insert failure\'');
  assert.equal((await f.createOrder({coupon:'ROLLBACK'})).status,500);assert.equal((await f.request('/api/products')).data.products[0].stock.M,5);assert.equal((await f.request('/api/admin/coupons',{headers:{cookie}})).data.coupons[0].used,0);
});
test('MariaDB: concorrência entre processos respeita o último uso de um cupom',async t=>{
  const f=await setup(t),cookie=await f.login();await f.post('/api/admin/coupons',{code:'ULTIMO',percent:10,minCents:0,maxUses:1,expiresAt:'',active:true},{cookie});
  const second=fixture(t,{mysql:f.settings});await second.app.ready;
  const responses=await Promise.all([f.createOrder({coupon:'ULTIMO'},'mysql-coupon-order-00001'),second.createOrder({coupon:'ULTIMO'},'mysql-coupon-order-00002')]);assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);assert.equal((await f.request('/api/admin/coupons',{headers:{cookie}})).data.coupons[0].used,1);assert.equal((await f.request('/api/products')).data.products[0].stock.M,4);await second.app.close();
});
