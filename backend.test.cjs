const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Readable}=require('node:stream');
const {createApp}=require('./backend.cjs');
test('catálogo, autenticação, pedidos, estoque e persistência',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'maevi-test-'));
  let app=createApp({dataDir:dir,adminKey:'test-only-key'});
  t.after(()=>{app.close();if(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'maevi-test-'))fs.rmSync(dir,{recursive:true,force:true});});
  async function request(url,{method='GET',data,headers={},raw}={}){
    const req=Readable.from(raw!==undefined?[raw]:data===undefined?[]:[JSON.stringify(data)]);
    Object.assign(req,{url,method,headers:{host:'127.0.0.1:5173','content-type':'application/json','x-maevi-request':'1',...headers},socket:{remoteAddress:'test'}});
    const result={headers:{},status:0};
    const res={headersSent:false,setHeader(k,v){result.headers[k.toLowerCase()]=v;},writeHead(status,values){result.status=status;this.headersSent=true;for(const [k,v]of Object.entries(values||{}))result.headers[k.toLowerCase()]=v;},end(value){result.text=String(value??'');}};
    await app.handler(req,res);try{result.data=JSON.parse(result.text);}catch{}return result;
  }
  const post=(url,data,headers={})=>request(url,{method:'POST',data,headers});
  const catalog=()=>request('/api/products');
  const payload={items:[{id:1,size:'P',quantity:2}],customer:{name:'Cliente Teste',email:'teste@example.com'},fulfillment:'demo_pickup',demoAccepted:true};
  let cookie,order,token;
  await t.test('arquivos permitidos e dados privados bloqueados',async()=>{
    for(const url of ['/','/admin','/app.js','/admin.js','/styles.css','/assets/logo-maevi.png'])assert.equal((await request(url)).status,200,url);
    for(const url of ['/data/admin-key.txt','/data/maevi.sqlite','/backend.cjs','/seed.cjs','/../package.json','/.git/config'])assert.equal((await request(url)).status,404,url);
    assert.equal((await request('/api/products',{headers:{host:'evil.test:5173'}})).status,403);
    assert.equal((await post('/api/quote',{}, {origin:'https://evil.test'})).status,403);
  });
  await t.test('catálogo e preços calculados no servidor em centavos',async()=>{
    const c=await catalog();assert.equal(c.data.products.length,4);
    const q=await post('/api/quote',{items:[{id:1,size:'P',quantity:2,price:0}]});assert.equal(q.status,200);assert.equal(q.data.totalCents,49980);
    assert.equal((await post('/api/quote',{items:[{id:1,size:'P',quantity:-1}]})).status,400);
    assert.equal((await post('/api/quote',{items:[null]})).status,400);
    assert.equal((await request('/api/quote',{method:'POST',raw:'null'})).status,400);
    assert.equal((await request('/api/quote',{method:'POST',raw:'{'})).status,400);
    assert.equal((await request('/api/quote',{method:'POST',raw:' '.repeat(33000)})).status,413);
    assert.equal((await post('/api/quote',{items:[{id:1,size:'P',quantity:3},{id:1,size:'P',quantity:3}]})).status,409);
  });
  await t.test('painel exige chave e sessão HttpOnly',async()=>{
    assert.equal((await request('/api/admin/orders')).status,401);
    assert.equal((await post('/api/admin/login',{key:'wrong'})).status,401);
    const login=await post('/api/admin/login',{key:'test-only-key'});assert.equal(login.status,200);
    assert.match(login.headers['set-cookie'],/HttpOnly; SameSite=Strict/);cookie=login.headers['set-cookie'].split(';')[0];
    assert.equal((await request('/api/admin/products',{headers:{cookie}})).status,200);
  });
  await t.test('pedido persistido, repetição sem duplicar nem baixar estoque duas vezes',async()=>{
    const headers={'idempotency-key':'test-order-000001'};
    const created=await post('/api/orders',payload,headers);assert.equal(created.status,201);order=created.data.order;token=created.data.token;
    assert.equal(order.totalCents,49980);assert.deepEqual(order.history,[{status:'demo_received',at:order.createdAt}]);assert.equal((await catalog()).data.products[0].stock.P,3);
    const repeated=await post('/api/orders',payload,headers);assert.equal(repeated.status,200);assert.equal(repeated.data.order.id,order.id);assert.equal(repeated.data.token,token);
    assert.equal((await catalog()).data.products[0].stock.P,3);
    assert.equal((await post('/api/orders',{...payload,items:[{id:1,size:'P',quantity:1}]},headers)).status,409);
    assert.equal((await request('/api/orders/'+order.id)).status,404);
    assert.equal((await request('/api/orders/'+order.id,{headers:{'x-order-token':token}})).status,200);
  });
  await t.test('falta de estoque não cria pedido nem altera outras peças',async()=>{
    const result=await post('/api/orders',{...payload,items:[{id:2,size:'P',quantity:1},{id:1,size:'P',quantity:4}]},{'idempotency-key':'test-order-000002'});
    assert.equal(result.status,409);assert.equal((await catalog()).data.products[1].stock.P,5);
    const list=await request('/api/admin/orders',{headers:{cookie}});assert.equal(list.data.orders.length,1);
  });
  await t.test('cancelamento devolve estoque uma vez e não aceita situação paga',async()=>{
    const patch=status=>request('/api/admin/orders/'+order.id,{method:'PATCH',data:{status},headers:{cookie}});
    assert.equal((await patch('paid')).status,409);
    const cancelled=await patch('demo_cancelled');assert.equal(cancelled.status,200);assert.deepEqual(cancelled.data.order.history.map(h=>h.status),['demo_received','demo_cancelled']);assert.equal((await catalog()).data.products[0].stock.P,5);
    assert.equal((await patch('demo_cancelled')).status,409);assert.equal((await catalog()).data.products[0].stock.P,5);
  });
  await t.test('edição, ocultação e proteção contra edição desatualizada',async()=>{
    const p=(await catalog()).data.products[0];
    const changed=await request('/api/admin/products/1',{method:'PUT',data:{...p,name:'Aurora revisado',active:false},headers:{cookie}});assert.equal(changed.status,200);
    assert.equal((await catalog()).data.products.length,3);
    assert.equal((await request('/api/admin/products/1',{method:'PUT',data:p,headers:{cookie}})).status,409);
    const bad=await post('/api/admin/products',{...p,image:'javascript:alert(1)'},{cookie});assert.equal(bad.status,400);
    const good=await post('/api/admin/products',{...p,name:'Peça nova'},{cookie});assert.equal(good.status,201);assert.equal(good.data.product.id,5);
  });
  await t.test('disputa pelas últimas unidades permite só um pedido',async()=>{
    const data={...payload,items:[{id:2,size:'GG',quantity:3}]};
    const results=await Promise.all([post('/api/orders',data,{'idempotency-key':'test-concurrent-01'}),post('/api/orders',data,{'idempotency-key':'test-concurrent-02'})]);
    assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);assert.equal((await catalog()).data.products.find(p=>p.id===2).stock.GG,0);
  });
  await t.test('metadados da peça e registro de atividade persistem sem dados pessoais',async()=>{
    const p=(await catalog()).data.products.find(p=>p.id===5);
    const response=await request('/api/admin/products/5',{method:'PUT',headers:{cookie},data:{...p,secondaryImage:'/assets/logo-maevi.png',material:'Composição de teste',care:'Cuidado de teste',featured:true}});
    assert.equal(response.status,200);assert.equal(response.data.product.featured,true);assert.equal(response.data.product.material,'Composição de teste');
    assert.equal((await request('/api/admin/activity')).status,401);
    const activity=await request('/api/admin/activity',{headers:{cookie}});assert.equal(activity.status,200);
    assert.equal(activity.data.activity.filter(a=>a.entity_id===order.id&&a.action==='created').length,1);
    assert.equal(activity.data.activity.filter(a=>a.entity_id===order.id&&a.action==='demo_cancelled').length,1);
    for(const event of activity.data.activity)assert.deepEqual(Object.keys(event).sort(),['action','at','entity','entity_id']);
    assert.ok(!JSON.stringify(activity.data).includes('teste@example.com'));assert.ok(!JSON.stringify(activity.data).includes(token));
  });
  await t.test('logout invalida sessão e reiniciar mantém produtos e pedidos',async()=>{
    const current=(await request('/api/admin/products',{headers:{cookie}})).data.products;
    const legacy={...current.find(p=>p.id===1),image:require('./seed.cjs')[0].sourceImage};
    const custom={...current.find(p=>p.id===5),image:'/assets/editorial-4.jpg'};
    assert.equal((await request('/api/admin/products/1',{method:'PUT',data:legacy,headers:{cookie}})).status,200);
    assert.equal((await request('/api/admin/products/5',{method:'PUT',data:custom,headers:{cookie}})).status,200);
    assert.equal((await post('/api/admin/logout',{}, {cookie})).status,200);assert.equal((await request('/api/admin/orders',{headers:{cookie}})).status,401);
    app.close();app=createApp({dataDir:dir,adminKey:'test-only-key'});
    assert.equal((await catalog()).data.products.find(p=>p.id===2).stock.GG,0);
    const saved=await request('/api/orders/'+order.id,{headers:{'x-order-token':token}});assert.equal(saved.data.order.status,'demo_cancelled');
    const login=await post('/api/admin/login',{key:'test-only-key'});const newCookie=login.headers['set-cookie'].split(';')[0];
    const migrated=(await request('/api/admin/products',{headers:{cookie:newCookie}})).data.products;
    assert.equal(migrated.find(p=>p.id===1).image,'/assets/editorial-1.jpg');assert.deepEqual(migrated.find(p=>p.id===1).stock,legacy.stock);
    assert.equal(migrated.find(p=>p.id===5).image,custom.image);assert.equal(migrated.find(p=>p.id===5).material,custom.material);
  });
});
