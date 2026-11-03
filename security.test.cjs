const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {Readable}=require('node:stream');
const {createApp}=require('./backend.cjs');
const {createLocalServer}=require('./server.cjs');
test('revisão de segurança local',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'maevi-security-'));
  let time=Date.now();const app=createApp({dataDir:dir,adminKey:'isolated-test-key',now:()=>time});
  t.after(async()=>{await app.close();if(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'maevi-security-'))fs.rmSync(dir,{recursive:true,force:true});});
  async function request(url,{method='GET',data,raw,headers={},ip='security-test'}={}){
    const req=Readable.from(raw===undefined?(data===undefined?[]:[JSON.stringify(data)]):[raw]);
    Object.assign(req,{url,method,headers:{host:'127.0.0.1:5173','content-type':'application/json','x-maevi-request':'1',...headers},socket:{remoteAddress:ip}});
    const result={headers:{}};const res={headersSent:false,setHeader(k,v){result.headers[k.toLowerCase()]=v;},writeHead(status,headers){result.status=status;this.headersSent=true;for(const [k,v] of Object.entries(headers||{}))result.headers[k.toLowerCase()]=v;},end(value){result.text=String(value||'');}};
    await app.handler(req,res);try{result.data=JSON.parse(result.text);}catch{}return result;
  }
  const post=(url,data,headers={})=>request(url,{method:'POST',data,headers});
  const login=async()=>{const r=await post('/api/admin/login',{key:'isolated-test-key'});assert.equal(r.status,200);return r.headers['set-cookie'].split(';')[0];};
  let cookie;
  await t.test('cabeçalhos bloqueiam scripts inline, objetos e enquadramento; admin sem cache',async()=>{
    const r=await request('/admin');assert.equal(r.status,200);assert.equal(r.headers['cache-control'],'no-store');
    assert.equal(r.headers['x-content-type-options'],'nosniff');assert.equal(r.headers['x-frame-options'],'DENY');
    assert.match(r.headers['content-security-policy'],/object-src 'none'/);assert.match(r.headers['content-security-policy'],/script-src-attr 'none'/);
    assert.match(r.headers['content-security-policy'],/base-uri 'none'/);assert.equal(r.headers['cross-origin-resource-policy'],'same-origin');
    assert.equal(r.headers['access-control-allow-origin'],undefined);assert.match(r.headers['permissions-policy'],/payment=\(\)/);
  });
  await t.test('CSRF: exige cabeçalho próprio mesmo sem Origin; bloqueia origem e porta diferentes',async()=>{
    const data={key:'isolated-test-key'};
    for(const headers of [{'x-maevi-request':undefined},{origin:'https://malicious.example'},{origin:'null'},{origin:'http://127.0.0.1:9999'},{origin:'http://localhost:5173'},{'sec-fetch-site':'cross-site'},{'sec-fetch-site':'same-site'}]){
      assert.equal((await post('/api/admin/login',data,headers)).status,403,JSON.stringify(headers));
    }
    assert.equal((await request('/api/products',{headers:{'sec-fetch-site':'cross-site'}})).status,403);
    assert.equal((await request('/api/admin/login',{method:'OPTIONS'})).status,405);
    cookie=await login();
  });
  await t.test('Host e URL não permitem DNS rebinding, URLs absolutas ou arquivos privados',async()=>{
    for(const host of ['evil.example','127.0.0.1:5173.evil.test','127.1:5173','localhost:9999'])assert.equal((await request('/',{headers:{host}})).status,403);
    for(const route of ['https://evil.test/api/products','//evil.test/api/products','/\\evil.test','/'+ 'x'.repeat(2048)])assert.equal((await request(route)).status,400);
    for(const route of ['/data/admin-key.txt','/data/maevi.sqlite','/data/maevi.sqlite-wal','/.env','/.git/config','/server.cjs','/security.test.cjs','/assets/../../data/admin-key.txt','/assets/%2e%2e%2fdata%2fadmin-key.txt','/assets/logo-maevi.png/../data/admin-key.txt','/assets/logo-maevi.png%00.txt'])assert.equal((await request(route)).status,404,route);
  });
  await t.test('painel nega leitura e escrita sem sessão e com sessão forjada',async()=>{
    for(const headers of [{},{cookie:'maevi_session=forged'}])for(const [method,url,data] of [['GET','/api/admin/products'],['GET','/api/admin/orders'],['GET','/api/admin/activity'],['POST','/api/admin/products',{}],['PUT','/api/admin/products/1',{}],['PATCH','/api/admin/orders/MV-0000000000000000',{}]]){
      assert.equal((await request(url,{method,data,headers})).status,401,url);
    }
  });
  await t.test('limites de conteúdo rejeitam tipos falsos, compressão e payloads grandes',async()=>{
    for(const type of ['text/plain','application/x-www-form-urlencoded','application/jsonp','application/json; charset=latin1'])assert.equal((await post('/api/quote',{}, {'content-type':type})).status,415);
    assert.equal((await post('/api/quote',{}, {'content-encoding':'gzip'})).status,415);
    assert.equal((await post('/api/quote',{}, {'content-length':'32769'})).status,413);
    assert.equal((await request('/api/quote',{method:'POST',raw:'x'.repeat(32769)})).status,413);
    for(const data of [null,[],123,'x',{}])assert.equal((await post('/api/quote',data)).status,400);
  });
  await t.test('validação impede URLs executáveis, atributos injetados e SQL nas entradas estruturadas',async()=>{
    const p=(await request('/api/products')).data.products[0];
    for(const image of ['javascript:alert(1)','data:text/html,<script>alert(1)</script>','https://images.unsplash.com.evil.test/a.jpg','https://images.unsplash.com@evil.test/a.jpg','/assets/../../data/admin-key.txt','/assets/a.svg','/assets/a.jpg" onerror="alert(1)'])assert.equal((await post('/api/admin/products',{...p,image},{cookie})).status,400,image);
    for(const override of [{hex:['#303521']},{hex:'#fff; color:red'},{priceCents:-1},{stock:{P:-1,M:0,G:0,GG:0}},{active:'true'},{category:"'; DROP TABLE products;--"}])assert.equal((await post('/api/admin/products',{...p,...override},{cookie})).status,400);
    for(const override of [{secondaryImage:'javascript:alert(1)'},{secondaryImage:'https://images.unsplash.com.evil.test/a.jpg'},{material:'x'.repeat(601)},{care:{html:'unsafe'}},{featured:'true'}])assert.equal((await post('/api/admin/products',{...p,...override},{cookie})).status,400);
    assert.equal((await post('/api/quote',{items:[{id:"1 OR 1=1",size:'P',quantity:1}]})).status,400);
    assert.equal((await request('/api/products')).data.products.length,4);
  });
  await t.test('preços e situação enviados pelo cliente não adulteram o pedido; token é obrigatório',async()=>{
    const data={items:[{id:1,size:'P',quantity:1,unitCents:1}],customer:{name:'Teste',email:'teste@example.com'},demoAccepted:true,fulfillment:'demo_pickup',totalCents:1,status:'paid'};
    assert.equal((await post('/api/orders',{...data,demoAccepted:false},{'idempotency-key':'security-order-001'})).status,400);
    const created=await post('/api/orders',data,{'idempotency-key':'security-order-001'});assert.equal(created.status,201);assert.equal(created.data.order.totalCents,24990);assert.equal(created.data.order.status,'demo_received');
    const url='/api/orders/'+created.data.order.id;
    assert.equal((await request(url,{headers:{'x-order-token':'wrong'}})).status,404);
    assert.equal((await request(url,{headers:{'x-order-token':created.data.token}})).status,200);
    const noToken=await request(url+'?token='+created.data.token);assert.equal(noToken.status,404);
  });
  await t.test('escape de saída neutraliza HTML no frontend e no painel',()=>{
    for(const file of ['app.js','admin.js']){
      const source=fs.readFileSync(path.join(__dirname,file),'utf8');
      const declaration=source.split('\n').find(line=>line.startsWith('const escapeHTML'));
      const escape=vm.runInNewContext(declaration+'\nescapeHTML;');
      for(const payload of ['<img src=x onerror=alert(1)>','"><script>alert(1)</script>',"' autofocus onfocus='alert(1)",'&lt;script&gt;']){
        const escaped=escape(payload);assert.ok(!/[<>"']/.test(escaped),file);assert.notEqual(escaped,payload);
      }
      assert.ok(!/\beval\s*\(|new Function\s*\(/.test(source));
    }
  });
  await t.test('sessão expira por inatividade, renova token ao entrar e logout invalida',async()=>{
    const old=cookie;cookie=await login();
    // Uma nova sessão no mesmo navegador invalida a anterior.
    const replaced=await post('/api/admin/login',{key:'isolated-test-key'},{cookie});
    assert.equal((await request('/api/admin/products',{headers:{cookie}})).status,401);
    cookie=replaced.headers['set-cookie'].split(';')[0];assert.notEqual(old,cookie);
    time+=30*60*1000+1;assert.equal((await request('/api/admin/products',{headers:{cookie}})).status,401);
    cookie=await login();assert.equal((await post('/api/admin/logout',{}, {cookie})).status,200);
    assert.equal((await request('/api/admin/products',{headers:{cookie}})).status,401);
  });
  await t.test('sessão também tem expiração absoluta de oito horas',async()=>{
    cookie=await login();
    for(let n=0;n<16;n++){time+=29*60*1000;assert.equal((await request('/api/admin/products',{headers:{cookie}})).status,200);}
    time+=17*60*1000;assert.equal((await request('/api/admin/products',{headers:{cookie}})).status,401);
  });
  await t.test('força bruta e excesso de chamadas recebem 429 e Retry-After',async()=>{
    time+=60001;
    for(let n=0;n<10;n++)assert.equal((await post('/api/admin/login',{key:'wrong'})).status,401);
    const blocked=await post('/api/admin/login',{key:'wrong'});assert.equal(blocked.status,429);assert.equal(blocked.headers['retry-after'],'60');
    time+=60001;assert.equal((await post('/api/admin/login',{key:'wrong'})).status,401);
    for(let n=0;n<240;n++)assert.equal((await request('/api/products',{ip:'burst'})).status,200);
    assert.equal((await request('/api/products',{ip:'burst'})).status,429);
  });
  await t.test('servidor define limites de cabeçalhos, tempo, conexões e keepalive',()=>{
    const server=createLocalServer(()=>{});
    assert.equal(server.maxHeaderSize,8192);assert.equal(server.headersTimeout,10000);assert.equal(server.requestTimeout,15000);
    assert.equal(server.keepAliveTimeout,5000);assert.equal(server.maxHeadersCount,50);assert.equal(server.maxRequestsPerSocket,100);assert.equal(server.maxConnections,32);assert.equal(server.timeout,15000);
    server.close();
  });
});
