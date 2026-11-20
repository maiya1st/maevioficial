const {fail}=require('./errors.cjs');
function validateLibrary(input,catalog,currentVersion){
  if(!input||typeof input!=='object'||Array.isArray(input)||input.version!==currentVersion)fail(409,'A biblioteca mudou. Atualize os dados antes de salvar.');
  if(!Array.isArray(input.models)||input.models.length>200)fail(400,'Use no máximo 200 modelos.');
  const ids=new Set(),names=new Set();
  const models=input.models.map(m=>{
    if(!m||typeof m!=='object'||Array.isArray(m))fail(400,'Modelo inválido.');
    const id=m.id,name=typeof m.name==='string'?m.name.normalize('NFC').trim().replace(/\s+/g,' '):'';
    if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)||ids.has(id))fail(400,'Identificador de modelo inválido.');
    if(!name||name.length>100||/[<>\x00-\x1f]/.test(name))fail(400,'Nome de modelo inválido.');
    if(typeof m.category!=='string'||!catalog.categories.includes(m.category))fail(400,'Selecione uma categoria existente.');
    if(!Number.isInteger(m.priceCents)||m.priceCents<1||m.priceCents>10000000)fail(400,'Preço de modelo inválido.');
    if(!Array.isArray(m.sizes)||m.sizes.length<1||m.sizes.length>catalog.sizes.length||new Set(m.sizes).size!==m.sizes.length||!m.sizes.every(s=>catalog.sizes.includes(s)))fail(400,'Selecione tamanhos disponíveis no catálogo.');
    const key=m.category.toLocaleLowerCase('pt-BR')+':'+name.toLocaleLowerCase('pt-BR');
    if(names.has(key))fail(400,'Já existe um modelo com esse nome na categoria.');ids.add(id);names.add(key);
    return {id,name,category:m.category,priceCents:m.priceCents,sizes:catalog.sizes.filter(s=>m.sizes.includes(s))};
  });
  return {version:currentVersion+1,models};
}
module.exports={validateLibrary};
