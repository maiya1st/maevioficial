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

test('IA sugere apenas modelos existentes; nunca devolve precos nem estoque inventados',async()=>{
 const models=[{id:'11111111-1111-4111-8111-111111111111',name:'Calça jeans com brilho',category:'Calças',priceCents:18990,sizes:['P','M','G']}];
 let sent;
 const ask=async response=>suggest({notes:'calça jeans com detalhe brilhante',category:'Calças'},{
   apiKey:'fixture-secret',categories,models,network:async(_url,options)=>{sent=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(response)}}]})};}
 });
 const text={name:'Calça jeans com brilho',description:'Calça com acabamento brilhante aparente.',category:'Calças',observations:'Verificar composição.'};
 const found=await ask({...text,modelId:models[0].id,modelReason:'Detalhes brilhantes na calça',priceCents:1,stock:{P:999}});
 assert.deepEqual(found.modelSuggestion,{id:models[0].id,name:models[0].name,category:'Calças',reason:'Detalhes brilhantes na calça'});
 assert.equal(found.priceCents,undefined);assert.equal(found.stock,undefined);
 assert.ok(!JSON.stringify(sent).includes('18990'),'preço padrão não deve ser enviado à IA');
 assert.ok(!JSON.stringify(sent).includes('fixture-secret'),'chave não pode aparecer no conteúdo da requisição');
 assert.equal((await ask({...text,modelId:'inventado'})).modelSuggestion,null);
 assert.equal((await ask({...text,modelId:''})).modelSuggestion,null);
 assert.equal((await suggest({notes:'calça sem modelo claro'},{apiKey:'fixture',categories,models:[],network:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({...text,modelId:models[0].id})}}]})})})).modelSuggestion,null);
});
test('endpoint usa biblioteca autenticada e mantém produtos inalterados',async t=>{
 let req;
 const f=fixture(t,{aiEnv:{MAEVI_OPENAI_API_KEY:'fixture-key'},network:async(_url,options)=>{
  req=JSON.parse(options.body);
  return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({name:'Calça de Brilho',description:'Detalhe brilhante.',category:'Calças',observations:'Conferir medidas',modelId:'11111111-1111-4111-8111-111111111111'})}}]})};
 }});
 const cookie=await f.login(),headers={cookie};
 const cat=(await f.request('/api/admin/catalog',{headers})).data.catalog;
 const model={id:'11111111-1111-4111-8111-111111111111',name:'Calça de brilho',category:cat.categories[0],priceCents:18000,sizes:['P','M','G']};
 assert.equal((await f.request('/api/admin/model-library',{method:'PUT',headers,data:{version:0,models:[model]}})).status,200);
 const before=(await f.request('/api/admin/products',{headers})).data.products;
 const response=await f.post('/api/admin/ai-catalog',{notes:'calça com brilho',category:cat.categories[0]},headers);
 assert.equal(response.status,200,JSON.stringify(response.data));
 assert.equal(response.data.draft.modelSuggestion.id,model.id);
 assert.equal(response.data.draft.modelSuggestion.priceCents,undefined);
 assert.deepEqual((await f.request('/api/admin/products',{headers})).data.products,before);
 assert.ok(JSON.stringify(req).includes(model.id));
});
