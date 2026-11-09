const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./testing.cjs');

test('conta da proprietária: e-mail e senha',async t=>{
  const f=fixture(t);
  const put=(data,cookie)=>f.request('/api/admin/account',{method:'PUT',data,headers:cookie?{cookie}:{}});
  const loginWith=(email,password,ip='owner-test')=>f.request('/api/admin/login',{method:'POST',data:{email,password},ip});
  assert.equal((await put({email:'dona@maevi.com.br',password:'segredo-forte-1'})).status,401,'exige sessão');
  assert.equal((await loginWith('dona@maevi.com.br','segredo-forte-1')).status,401,'sem conta criada');
  const keyCookie=await f.login();
  const account=await f.request('/api/admin/account',{headers:{cookie:keyCookie}});
  assert.deepEqual([account.data.account.configured,account.data.session.method],[false,'key']);
  for(const [email,password] of [['invalido','segredo-forte-1'],['dona@maevi.com.br','curta'],['dona@maevi.com.br','aaaaaaaaaaaa'],['dona@maevi.com.br','x'.repeat(201)]])
    assert.equal((await put({email,password},keyCookie)).status,400,email+password.slice(0,12));
  const created=await put({email:' Dona@Maevi.com.br ',password:'segredo-forte-1'},keyCookie);
  assert.equal(created.status,200);assert.equal(created.data.account.email,'dona@maevi.com.br');
  assert.ok(!JSON.stringify(created.data).includes('segredo'),'resposta não expõe senha nem hash');
  assert.equal((await loginWith('dona@maevi.com.br','senha-errada-123')).status,401);
  assert.equal((await loginWith('outra@maevi.com.br','segredo-forte-1')).status,401);
  const ok=await loginWith('DONA@maevi.com.br','segredo-forte-1');
  assert.equal(ok.status,200);assert.equal(ok.data.method,'password');assert.match(ok.headers['set-cookie'],/HttpOnly; SameSite=Strict/);
  const cookie=ok.headers['set-cookie'].split(';')[0];
  assert.equal((await f.request('/api/admin/products',{headers:{cookie}})).status,200);
  // Com sessão por senha, trocar exige a senha atual.
  assert.equal((await put({email:'dona@maevi.com.br',password:'nova-senha-forte-2'},cookie)).status,401);
  assert.equal((await put({email:'dona@maevi.com.br',password:'nova-senha-forte-2',currentPassword:'errada-123456'},cookie)).status,401);
  assert.equal((await put({email:'dona@maevi.com.br',password:'nova-senha-forte-2',currentPassword:'segredo-forte-1'},cookie)).status,200);
  assert.equal((await f.request('/api/admin/products',{headers:{cookie:keyCookie}})).status,401,'troca encerra as outras sessões');
  assert.equal((await f.request('/api/admin/products',{headers:{cookie}})).status,200,'sessão atual continua');
  assert.equal((await loginWith('dona@maevi.com.br','segredo-forte-1','owner-b')).status,401);
  assert.equal((await loginWith('dona@maevi.com.br','nova-senha-forte-2','owner-b')).status,200);
  // A chave continua como recuperação e permite redefinir sem a senha atual.
  const recovery=await f.login();
  assert.equal((await put({email:'dona@maevi.com.br',password:'recuperada-forte-3'},recovery)).status,200);
  // Tentativas erradas seguem limitadas.
  for(let n=0;n<10;n++)await loginWith('dona@maevi.com.br','errada-'+n+'xxxxx','brute');
  assert.equal((await loginWith('dona@maevi.com.br','recuperada-forte-3','brute')).status,429);
});

test('categorias e tamanhos configuráveis',async t=>{
  const f=fixture(t);const cookie=await f.login();
  const catalog=async()=>(await f.request('/api/admin/catalog',{headers:{cookie}})).data.catalog;
  const save=data=>f.request('/api/admin/catalog',{method:'PUT',data,headers:{cookie}});
  const products=async()=>(await f.request('/api/admin/products',{headers:{cookie}})).data.products;
  let c=await catalog();assert.deepEqual([c.categories,c.sizes],[['Vestidos','Conjuntos','Blusas'],['P','M','G','GG']]);
  for(const bad of [{categories:[],sizes:['P']},{categories:['Todas'],sizes:['P']},{categories:['Vestidos','vestidos'],sizes:['P']},{categories:['<b>'],sizes:['P']},{categories:['Vestidos'],sizes:['x'.repeat(11)]}])
    assert.equal((await save({...c,...bad})).status,400,JSON.stringify(bad));
  assert.equal((await save({...c,categories:['Vestidos','Conjuntos']})).status,409,'categoria em uso');
  assert.equal((await save({...c,sizes:['P','M','G']})).status,409,'tamanho com estoque');
  const saved=await save({version:c.version,categories:['Vestidos','Conjuntos','Blusas e Camisas','Alfaiataria'],sizes:['PP','P','M','G','GG','Único'],renames:{categories:{Blusas:'Blusas e Camisas'}}});
  assert.equal(saved.status,200);c=saved.data.catalog;
  assert.equal((await save({version:0,categories:c.categories,sizes:c.sizes})).status,409,'versão antiga');
  let list=await products();
  assert.equal(list.find(p=>p.id===3).category,'Blusas e Camisas');
  assert.deepEqual(Object.keys(list[0].stock),['PP','P','M','G','GG','Único']);assert.equal(list[0].stock.PP,0);
  const publicCatalog=(await f.request('/api/products')).data.catalog;assert.deepEqual(publicCatalog.sizes,c.sizes);
  const p=list[0];
  const blazer={...p,name:'Blazer Alfaiataria',category:'Alfaiataria',stock:{PP:1,P:0,M:2,G:0,GG:0,'Único':0}};delete blazer.id;
  assert.equal((await f.post('/api/admin/products',{...blazer,category:'Calças'},{cookie})).status,400,'categoria inexistente');
  assert.equal((await f.post('/api/admin/products',{...blazer,stock:{P:1}},{cookie})).status,400,'estoque incompleto');
  const created=await f.post('/api/admin/products',blazer,{cookie});assert.equal(created.status,201);
  const id=created.data.product.id;
  const order=await f.createOrder({items:[{id,size:'PP',quantity:1}]});assert.equal(order.status,201);
  assert.equal((await products()).find(x=>x.id===id).stock.PP,0);
  for(const size of ['XG','__proto__','constructor'])assert.ok([400,409].includes((await f.createOrder({items:[{id,size,quantity:1}]},'fixture-order-'+size.replace(/_/g,'x').padEnd(8,'x'))).status),size);
  const cancelled=await f.request('/api/admin/orders/'+order.data.order.id,{method:'PATCH',data:{status:'demo_cancelled'},headers:{cookie}});assert.equal(cancelled.status,200);
  assert.equal((await products()).find(x=>x.id===id).stock.PP,1,'cancelamento devolve o tamanho novo');
  // Remover um tamanho zerado limpa o estoque das peças.
  c=await catalog();assert.equal((await save({version:c.version,categories:c.categories,sizes:c.sizes.filter(s=>s!=='Único')})).status,200);
  assert.ok(!Object.hasOwn((await products())[0].stock,'Único'));
});
