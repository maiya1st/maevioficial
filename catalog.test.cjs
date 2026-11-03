const {test}=require('node:test');
const assert=require('node:assert/strict');
const {select,savedIds}=require('./catalog-core.js');
const products=[
 {id:1,name:'Vestido Évora',color:'Rosé',category:'Vestidos',priceCents:20000,featured:false,stock:{P:0,M:2,G:0,GG:0}},
 {id:2,name:'Conjunto Essência',color:'Oliva',category:'Conjuntos',priceCents:30000,featured:true,stock:{P:1,M:1,G:0,GG:0}},
 {id:3,name:'Blusa Alma',color:'Areia',category:'Blusas',priceCents:10000,featured:false,stock:{P:0,M:0,G:0,GG:0}}
];
test('busca sem acentos combina nome, cor e categoria',()=>{
 assert.deepEqual(select(products,{query:'evora rose'}).map(p=>p.id),[1]);
 assert.deepEqual(select(products,{query:'essencia oliva'}).map(p=>p.id),[2]);
 assert.deepEqual(select(products,{query:'<script>'}),[]);
});
test('tamanho e disponibilidade usam estoque positivo e se combinam com categoria',()=>{
 assert.deepEqual(select(products,{size:'P'}).map(p=>p.id),[2]);
 assert.equal(select(products,{size:'P',category:'Vestidos'}).length,0);
 assert.equal(select(products,{available:true}).length,2);
});
test('favoritos sanitizados não aceitam strings, objetos, duplicatas ou IDs inválidos',()=>{
 assert.deepEqual(savedIds([1,1,'2',null,{},-1,0,2,1.1]),[1,2]);
 assert.deepEqual(savedIds({id:1}),[]);
 assert.equal(savedIds(Array.from({length:600},(_,i)=>i+1)).length,500);
 assert.deepEqual(select(products,{favoritesOnly:true,favorites:[1,3],available:true}).map(p=>p.id),[1]);
 assert.deepEqual(select(products,{favoritesOnly:true}),[]);
});
test('ordenação preserva o catálogo original e destaca peças escolhidas',()=>{
 assert.deepEqual(select(products).map(p=>p.id),[2,1,3]);
 assert.deepEqual(select(products,{sort:'price-asc'}).map(p=>p.id),[3,1,2]);
 assert.deepEqual(select(products,{sort:'price-desc'}).map(p=>p.id),[2,1,3]);
 assert.deepEqual(select(products,{sort:'name'}).map(p=>p.id),[3,2,1]);
 assert.deepEqual(products.map(p=>p.id),[1,2,3]);
});
