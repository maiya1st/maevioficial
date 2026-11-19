const {test}=require('node:test');
const assert=require('node:assert/strict');
const {suggest,validate}=require('./ai-catalog.cjs');
const {fixture}=require('./testing.cjs');
const categories=['Vestidos','Calças'];
test('rascunho de IA valida limites e não cria atributos inventados automaticamente',async()=>{
  assert.throws(()=>validate({notes:'',image:null},categories));
  assert.throws(()=>validate({notes:'x',category:'Outra'},categories));
  assert.throws(()=>validate({notes:'x',image:'https://site.exemplo/imagem'},categories));
  let request;
  const draft=await suggest({notes:'vestido com cintura marcada',category:'Vestidos'}, {apiKey:'test-secret',categories,network:async(url,options)=>{
    request={url,options};return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({name:'Vestido Atemporal',description:'Vestido com cintura marcada.',category:'Vestidos',observations:'Confirmar tecido e medidas.'})}}]})};
  }});
  assert.equal(draft.name,'Vestido Atemporal');
  assert.equal(draft.category,'Vestidos');
  assert.equal(request.url,'https://api.openai.com/v1/chat/completions');
  assert.equal(request.options.headers.Authorization,'Bearer test-secret');
  assert.ok(!JSON.stringify(draft).includes('test-secret'));
});
test('rota de IA exige login e não altera o catálogo nem estoque',async t=>{
  const requests=[];
  const f=fixture(t,{aiEnv:{MAEVI_OPENAI_API_KEY:'fixture-key'},network:async(url,options)=>{
    requests.push(url);
    return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({name:'Vestido Claro',description:'Peça elegante.',category:'Vestidos',observations:'Confirmar material.'})}}]})};
  }});
  const input={notes:'vestido midi com alças',category:'Vestidos'};
  assert.equal((await f.post('/api/admin/ai-catalog',input)).status,401);
  const cookie=await f.login();
  const before=(await f.request('/api/admin/products',{headers:{cookie}})).data.products;
  const result=await f.post('/api/admin/ai-catalog',input,{cookie});
  assert.equal(result.status,200,JSON.stringify(result.data));
  assert.equal(result.data.draft.name,'Vestido Claro');
  assert.deepEqual((await f.request('/api/admin/products',{headers:{cookie}})).data.products,before);
  assert.deepEqual(requests,['https://api.openai.com/v1/chat/completions']);
});

test('IA indisponível não gera rascunho sem chave e não modifica catálogo',async t=>{
  const f=fixture(t,{aiEnv:{}});
  const cookie=await f.login();
  const before=(await f.request('/api/admin/products',{headers:{cookie}})).data.products;
  const result=await f.post('/api/admin/ai-catalog',{notes:'blusa de manga longa',category:'Vestidos'},{cookie});
  assert.equal(result.status,503);
  assert.deepEqual((await f.request('/api/admin/products',{headers:{cookie}})).data.products,before);
});
test('falhas do provedor e resposta malformada são tratadas sem expor dados da API',async()=>{
  const args={apiKey:'private-test-secret',categories};
  await assert.rejects(
    suggest({notes:'vestido'}, {...args,network:async()=>({ok:false,status:429})}),
    error=>error.status===502&&!error.message.includes('private-test-secret'));
  await assert.rejects(
    suggest({notes:'vestido'}, {...args,network:async()=>({ok:true,json:async()=>({choices:[]})})}),
    error=>error.status===502&&!error.message.includes('private-test-secret'));
});

test('status de IA indica disponibilidade sem revelar chave',async t=>{
  const f=fixture(t,{aiEnv:{MAEVI_OPENAI_API_KEY:'confidential-test-key'}});
  assert.equal((await f.request('/api/admin/ai-catalog')).status,401);
  const cookie=await f.login();
  const result=await f.request('/api/admin/ai-catalog',{headers:{cookie}});
  assert.equal(result.status,200);
  assert.deepEqual(result.data,{configured:true});
  assert.ok(!JSON.stringify(result.data).includes('confidential-test-key'));
});
