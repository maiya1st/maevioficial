const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events');
const {start,startupFailure}=require('./http-server.cjs');
test('entry inicia quando carregado por require, sem depender de require.main',()=>{
  let calls=0;const entry=fs.readFileSync(path.join(__dirname,'server.cjs'),'utf8');
  const requireModule=name=>{assert.equal(name,'./http-server.cjs');return {start:()=>{calls++;},startupFailure};};
  requireModule.main={exports:{}};vm.runInNewContext(entry,{require:requireModule,module:{exports:{}},console,process:{exitCode:0}});assert.equal(calls,1);
});
test('listen ocorre antes do banco; espera ou falha devolve 503 sem expor credenciais',async()=>{
  const quiet={log(){},error(){}};
  async function run(fail){
    let resolve,reject,handler,listened=false;const dbReady=new Promise((ok,bad)=>{resolve=ok;reject=bad;});
    const service=start({env:{},loadEnv:false,logger:quiet,appFactory:()=>({ready:dbReady,handler:(req,res)=>{res.writeHead(200,{});res.end('ready');},close:async()=>{},runMaintenance:async()=>0}),serverFactory:fn=>{handler=fn;const server=new EventEmitter();server.listen=()=>{listened=true;};server.closeAllConnections=()=>{};server.close=fn=>fn();return server;}});
    assert.equal(listened,true);const request=()=>{const result={};handler({method:'GET'},{writeHead:(status,headers)=>Object.assign(result,{status,headers}),end:data=>{result.body=data;}});return result;};
    assert.equal(request().status,503);
    if(fail)reject(Object.assign(new Error('password=private-fixture-secret'),{code:'ER_ACCESS_DENIED_ERROR',sqlMessage:'private-fixture-secret'}));else resolve();
    assert.equal(await service.ready,!fail);const result=request();assert.equal(result.status,fail?503:200);assert.ok(!result.body.includes('private-fixture-secret'));await service.close();
  }
  await run(false);await run(true);
  for(const code of ['ER_ACCESS_DENIED_ERROR','ER_BAD_DB_ERROR','ECONNREFUSED','ER_PARSE_ERROR','UNKNOWN']){const message=startupFailure({code,message:'private-fixture-secret',sqlMessage:'private-fixture-secret'});assert.ok(!message.includes('private-fixture-secret'));}
  assert.match(startupFailure({message:'Configure MAEVI_DB_PASSWORD nas variáveis da hospedagem.'}),/MAEVI_DB_PASSWORD/);
});
