const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Readable}=require('node:stream');const {createApp}=require('./backend.cjs');
// Loja simulada para os testes automáticos: peças de exemplo e Mercado Pago configurado sem acesso à rede.
const testStore={seedProducts:require('./fixtures.cjs'),paymentEnv:{MAEVI_MP_MODE:'production',MAEVI_MP_ACCESS_TOKEN:'APP_USR-fixture-no-real-token',MAEVI_MP_WEBHOOK_SECRET:'fixture-no-real-secret-12345',MAEVI_PUBLIC_URL:'https://maevi.example'},paymentNetwork:async()=>{throw Error('rede bloqueada nos testes');}};
function fixture(t,options={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'maevi-commerce-'));let time=Date.now();
  const app=createApp({dataDir:path.join(root,'data'),assetDir:path.join(root,'assets'),adminKey:'fixture-admin-key',now:()=>time,...testStore,...options});
  t.after(async()=>{await app.close();if(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'maevi-commerce-'))fs.rmSync(root,{recursive:true,force:true});});
  async function request(url,{method='GET',data,raw,headers={},ip='fixture'}={}){
    const req=Readable.from(raw!==undefined?[raw]:data===undefined?[]:[JSON.stringify(data)]);
    Object.assign(req,{url,method,headers:{host:'127.0.0.1:5173','content-type':'application/json','x-maevi-request':'1',...headers},socket:{remoteAddress:ip}});
    const result={headers:{}};const res={headersSent:false,setHeader(k,v){result.headers[k.toLowerCase()]=v;},writeHead(status,headers){result.status=status;this.headersSent=true;for(const [k,v]of Object.entries(headers||{}))result.headers[k.toLowerCase()]=v;},end(value){result.bytes=Buffer.from(value||'');result.text=result.bytes.toString();}};
    await app.handler(req,res);try{result.data=JSON.parse(result.text);}catch{}return result;
  }
  const post=(url,data,headers={})=>request(url,{method:'POST',data,headers});
  async function login(){const response=await post('/api/admin/login',{key:'fixture-admin-key'});return response.headers['set-cookie'].split(';')[0];}
  const orderInput={items:[{id:1,size:'M',quantity:1}],customer:{name:'Pessoa Exemplo',email:'teste@example.com',phone:'11999998888'},checkoutVersion:2,shipping:{method:'pickup'},fulfillment:'demo_pickup',demoAccepted:true};
  const createOrder=(changes={},key='fixture-order-000001')=>post('/api/orders',{...orderInput,...changes},{'idempotency-key':key});
  return {app,root,request,post,login,createOrder,orderInput,advance:ms=>{time+=ms;}};
}
module.exports={fixture,testStore};
