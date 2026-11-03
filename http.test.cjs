// Teste opcional de transporte real. Requer permissão para sockets em loopback.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const net=require('node:net');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createApp}=require('./backend.cjs');
const {createLocalServer}=require('./http-server.cjs');
test('HTTP real em loopback: vitrine, painel e parser',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'maevi-http-'));
  let app;const server=createLocalServer((req,res)=>app.handler(req,res));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await app?.close();if(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'maevi-http-'))fs.rmSync(dir,{recursive:true,force:true});});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;fs.cpSync(path.join(__dirname,'assets'),path.join(dir,'assets'),{recursive:true});app=createApp({port,dataDir:dir,assetDir:path.join(dir,'assets'),adminKey:'isolated-http-test-key'});
  function request(route,method='GET',data,headers={}){
    return new Promise((resolve,reject)=>{
      const body=data===undefined?null:Buffer.isBuffer(data)?data:JSON.stringify(data);
      const req=http.request({host:'127.0.0.1',port,path:route,method,headers:{'content-type':'application/json','x-maevi-request':'1',...headers},timeout:3000},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString()}));});
      req.on('error',reject);req.on('timeout',()=>req.destroy(Error('Timeout HTTP')));req.end(body);
    });
  }
  await t.test('todos os assets e documentos carregam com MIME correto',async()=>{
    for(const [route,mime] of [['/','text/html'],['/admin','text/html'],['/styles.css','text/css'],['/boutique.css','text/css'],['/checkout.css','text/css'],['/app.js','text/javascript'],['/checkout.js','text/javascript'],['/contacts.js','text/javascript'],['/operations.js','text/javascript'],['/experience.js','text/javascript'],['/catalog-core.js','text/javascript'],['/admin.js','text/javascript'],['/admin.css','text/css'],['/assets/logo-maevi.png','image/png']]){
      const r=await request(route);assert.equal(r.status,200,route);assert.ok(r.headers['content-type'].startsWith(mime),route);
    }
  });
  await t.test('sessão funciona por cookie real e origem maliciosa é negada',async()=>{
    const login=await request('/api/admin/login','POST',{key:'isolated-http-test-key'});assert.equal(login.status,200);
    const cookie=login.headers['set-cookie'][0].split(';')[0];
    assert.equal((await request('/api/admin/products','GET',undefined,{cookie})).status,200);
    assert.equal((await request('/api/admin/activity','GET',undefined,{cookie})).status,200);
    assert.equal((await request('/api/admin/products','GET',undefined,{cookie,origin:'https://malicious.example'})).status,403);
    assert.equal((await request('/data/admin-key.txt')).status,404);
    const oversized=await request('/api/quote','POST',{}, {'content-length':'999999'});assert.equal(oversized.status,413);assert.equal(oversized.headers.connection,'close');
    const uploaded=await request('/api/admin/images','POST',fs.readFileSync(path.join(__dirname,'assets/editorial-1.jpg')),{cookie,'content-type':'image/jpeg'});assert.equal(uploaded.status,201);const image=JSON.parse(uploaded.text).image;
    assert.equal((await request(image)).status,200);
  });
  await t.test('parser HTTP rejeita Transfer-Encoding junto com Content-Length',async()=>{
    const response=await new Promise((resolve,reject)=>{
      let text='';const socket=net.createConnection({host:'127.0.0.1',port},()=>socket.write(`POST /api/quote HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Length: 4\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n`));
      socket.setTimeout(3000,()=>socket.destroy(Error('Timeout do parser')));socket.on('data',chunk=>text+=chunk);socket.on('error',reject);socket.on('close',()=>resolve(text));
    });assert.match(response,/^HTTP\/1\.1 400 /);
  });
});
