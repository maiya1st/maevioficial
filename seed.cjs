module.exports = [
  {id:1,name:'Vestido Aurora',category:'Vestidos',priceCents:24990,color:'Areia',hex:'#c9b89f',image:'https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?auto=format&fit=crop&w=900&q=85'},
  {id:2,name:'Conjunto Essência',category:'Conjuntos',priceCents:32990,color:'Oliva',hex:'#6a7154',image:'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=85'},
  {id:3,name:'Blusa Serena',category:'Blusas',priceCents:12990,color:'Champagne',hex:'#e8c8b0',image:'https://images.unsplash.com/photo-1551803091-e20673f15770?auto=format&fit=crop&w=900&q=85'},
  {id:4,name:'Vestido Brisa',category:'Vestidos',priceCents:27990,color:'Rosé',hex:'#d9b8a8',image:'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=900&q=85'}
].map(p=>({...p,sourceImage:p.image,image:`/assets/editorial-${p.id}.jpg`,description:'Peça demonstrativa da coleção MAÉVI. Fotos, composição, medidas e valores serão substituídos pelo catálogo real da loja.',stock:{P:5,M:5,G:5,GG:3},active:true}));
