const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {configuration,setupHandler}=require('./hosting.cjs');const {fixture}=require('./testing.cjs');const {createApp}=require('./backend.cjs');
const key='a'.repeat(48),base={MAEVI_HOSTING:'hostinger',MAEVI_PUBLIC_URL:'https://maevi.example',MAEVI_ADMIN_KEY:key,MAEVI_DB_NAME:'maevi',MAEVI_DB_USER:'maevi',MAEVI_DB_PASSWORD:'fixture-not-a-real-password'};
test('hospedagem exige configuração completa, HTTPS, chave forte e TLS em banco remoto',()=>{
  for(const name of ['MAEVI_PUBLIC_URL','MAEVI_ADMIN_KEY','MAEVI_DB_NAME','MAEVI_DB_USER','MAEVI_DB_PASSWORD'])assert.throws(()=>configuration({...base,[name]:''}));
  for(const url of ['http://maevi.example','https://localhost','https://maevi.example/path','https://user:password@maevi.example'])assert.throws(()=>configuration({...base,MAEVI_PUBLIC_URL:url}));
  assert.throws(()=>configuration({...base,MAEVI_ADMIN_KEY:'short'}));assert.throws(()=>configuration({...base,MAEVI_DB_HOST:'db.example.com'}));
  const c=configuration(base);assert.equal(c.host,'0.0.0.0');assert.equal(c.app.mysql.host,'127.0.0.1');assert.equal(c.app.publicAdmin,true);
  assert.equal(configuration({...base,MAEVI_DB_HOST:'db.example.com',MAEVI_DB_TLS:'true'}).app.mysql.ssl.rejectUnauthorized,true);
  assert.equal(configuration({}).host,'127.0.0.1');assert.equal(configuration({MAEVI_HOSTING:'setup'}).app.mysql,undefined);
});
test('modo de preparação não serve painel, API comercial, código ou pagamentos',()=>{
  for(const url of ['/','/admin','/api/admin/login','/.env.local','/server.cjs','/api/orders']){const result={};setupHandler({url,method:'GET'},{writeHead:(status,headers)=>Object.assign(result,{status,headers}),end:body=>{result.body=body;}});assert.equal(result.status,url==='/'?200:503);assert.ok(!result.body.includes('fixture'));assert.equal(result.headers['X-Robots-Tag'],'noindex, nofollow');}
});
test('painel online usa cookie Secure, verifica origem, autentica e encerra a sessão',async t=>{
  const f=fixture(t,{publicOrigin:'https://maevi.example',publicAdmin:true,adminKey:key}),headers={host:'maevi.example',origin:'https://maevi.example','x-forwarded-for':'203.0.113.20'};
  assert.equal((await f.request('/admin',{headers})).status,200);assert.equal((await f.request('/api/admin/products',{headers})).status,401);
  assert.equal((await f.post('/api/admin/login',{key},{...headers,origin:'https://evil.example'})).status,403);
  const r=await f.post('/api/admin/login',{key},headers);assert.equal(r.status,200);assert.match(r.headers['set-cookie'],/; Secure/);assert.match(r.headers['set-cookie'],/HttpOnly/);const cookie=r.headers['set-cookie'].split(';')[0];
  assert.equal((await f.request('/api/admin/products',{headers:{...headers,cookie}})).status,200);
  const logout=await f.post('/api/admin/logout',{}, {...headers,cookie});assert.equal(logout.status,200);assert.match(logout.headers['set-cookie'],/; Secure/);assert.equal((await f.request('/api/admin/products',{headers:{...headers,cookie}})).status,401);
  assert.equal((await f.request('/api/store',{headers})).status,200);assert.equal((await f.request('/api/health',{headers})).status,200);
  assert.equal((await f.request('/api/store',{headers:{...headers,host:'maevi.example:443'}})).status,200);
  assert.equal((await f.request('/api/store',{headers:{...headers,host:'MAEVI.EXAMPLE'}})).status,200);
  assert.equal((await f.request('/api/store',{headers:{...headers,host:'evil.example:443','x-forwarded-host':'maevi.example'}})).status,403);
});
test('fotos no banco sobrevivem à troca da pasta da aplicação e não aparecem no sistema de arquivos',async t=>{
  const f=fixture(t,{databaseImages:true}),cookie=await f.login(),bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=','base64');
  const saved=await f.request('/api/admin/images',{method:'POST',raw:bytes,headers:{cookie,'content-type':'image/png'}});assert.equal(saved.status,201);assert.equal(fs.readdirSync(path.join(f.root,'assets')).length,0);
  const first=await f.request(saved.data.image);assert.equal(first.status,200);assert.deepEqual(first.bytes,bytes);
  const nextAssets=path.join(f.root,'another-release-assets');fs.mkdirSync(nextAssets);const second=createApp({dataDir:path.join(f.root,'data'),assetDir:nextAssets,adminKey:'fixture-key',databaseImages:true});await second.ready;
  t.after(()=>second.close());let result;await second.handler({url:saved.data.image,method:'GET',headers:{host:'127.0.0.1:5173'},socket:{remoteAddress:'fixture'}},{headersSent:false,setHeader(){},writeHead(status,headers){result={status,headers};},end(data){result.bytes=Buffer.from(data||'');}});assert.equal(result.status,200);assert.deepEqual(result.bytes,bytes);
  // Close before fixture cleanup on Windows; close() is idempotent.
  await second.close();
});
