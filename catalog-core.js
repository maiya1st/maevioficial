(function(root){
  'use strict';
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
  function select(products,{query='',category='Todas',size='',available=false,favoritesOnly=false,favorites=[],sort='curated'}={}){
    const terms=normalize(query).trim().split(/\s+/).filter(Boolean),saved=new Set(favorites);
    const result=products.filter(p=>{
      const haystack=normalize([p.name,p.category,p.color].join(' '));
      return (category==='Todas'||p.category===category)&&terms.every(term=>haystack.includes(term))&&(!size||p.stock[size]>0)&&(!available||Object.values(p.stock).some(n=>n>0))&&(!favoritesOnly||saved.has(p.id));
    });
    const compare={ 'price-asc':(a,b)=>a.priceCents-b.priceCents, 'price-desc':(a,b)=>b.priceCents-a.priceCents, name:(a,b)=>a.name.localeCompare(b.name,'pt-BR'), curated:(a,b)=>Number(Boolean(b.featured))-Number(Boolean(a.featured)) };
    return result.sort(compare[sort]||compare.curated);
  }
  function savedIds(value){return Array.isArray(value)?[...new Set(value.filter(id=>Number.isSafeInteger(id)&&id>0))].slice(0,500):[];}
  const api=Object.freeze({select,savedIds,normalize});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MaeviCatalog=api;
})(globalThis);
