const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./testing.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=','base64');

test('trocar uma foto exclui apenas o upload antigo que nao esta em uso',async t=>{
  const f=fixture(t,{databaseImages:true}),cookie=await f.login(),headers={cookie,'content-type':'image/png'};
  const upload=async()=>f.request('/api/admin/images',{method:'POST',raw:png,headers});
  const first=await upload(),second=await upload();
  assert.equal(first.status,201);assert.equal(second.status,201);
  const original=(await f.request('/api/admin/products',{headers:{cookie}})).data.products[0];
  const keep=await f.request('/api/admin/products/'+original.id,{method:'PUT',data:{...original,version:original.version||0,image:first.data.image},headers:{cookie}});
  assert.equal(keep.status,200);
  assert.equal((await f.request(first.data.image)).status,200);
  const replace=await f.request('/api/admin/products/'+original.id,{method:'PUT',data:{...keep.data.product,image:second.data.image},headers:{cookie}});
  assert.equal(replace.status,200);
  assert.equal((await f.request(first.data.image)).status,404);
  assert.equal((await f.request(second.data.image)).status,200);
});

test('foto compartilhada entre produtos nao e excluida ao editar um deles',async t=>{
  const f=fixture(t,{databaseImages:true}),cookie=await f.login(),headers={cookie,'content-type':'image/png'};
  const upload=await f.request('/api/admin/images',{method:'POST',raw:png,headers});
  assert.equal(upload.status,201);
  const products=(await f.request('/api/admin/products',{headers:{cookie}})).data.products;
  const a=products[0],b=products[1];
  const aSaved=await f.request('/api/admin/products/'+a.id,{method:'PUT',data:{...a,version:a.version||0,image:upload.data.image},headers:{cookie}});
  const bSaved=await f.request('/api/admin/products/'+b.id,{method:'PUT',data:{...b,version:b.version||0,image:upload.data.image},headers:{cookie}});
  assert.equal(aSaved.status,200);assert.equal(bSaved.status,200);
  assert.equal((await f.request('/api/admin/products/'+a.id,{method:'PUT',data:{...aSaved.data.product,image:a.image},headers:{cookie}})).status,200);
  assert.equal((await f.request(upload.data.image)).status,200);
});
