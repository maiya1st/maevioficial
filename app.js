const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = cents => (cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const statuses={demo_received:'Aguardando pagamento',demo_payment_pending:'Aguardando pagamento',demo_payment_review:'Pagamento em conferência',demo_paid:'Pagamento aprovado',demo_preparing:'Em preparação',demo_ready:'Pronto para envio ou retirada',demo_completed:'Pedido concluído',demo_cancelled:'Pedido cancelado',demo_expired:'Reserva expirada'};
let SIZES=['P','M','G','GG'],CATEGORIES=['Vestidos','Conjuntos','Blusas'],products=[],cart=[],category='Todas',attempt=null,lastOrder=null,toastTimer,favorites=[],favoritesOnly=false,deepLinkHandled=false;
try{favorites=MaeviCatalog.savedIds(JSON.parse(localStorage.getItem('maevi-favorites-v1')||'[]'));}catch{}
try { const saved=JSON.parse(localStorage.getItem('maevi-cart-v1')||'[]');if(Array.isArray(saved))cart=saved.filter(i=>i&&Number.isSafeInteger(i.id)&&typeof i.size==='string'&&i.size.length>0&&i.size.length<=10&&Number.isInteger(i.quantity)&&i.quantity>0&&i.quantity<=20).slice(0,50).map(({id,size,quantity})=>({id,size,quantity})); } catch {}
try { lastOrder=JSON.parse(sessionStorage.getItem('maevi-last-order'));attempt=JSON.parse(sessionStorage.getItem('maevi-attempt'));if(attempt&&!/^[a-f0-9]{64}$/.test(attempt.signature||'')){attempt=null;sessionStorage.removeItem('maevi-attempt');} } catch {}
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4000);}
async function api(url,options={}) {
  let response;
  try{response=await fetch(url,{signal:AbortSignal.timeout(15000),cache:'no-store',...options,headers:{'Content-Type':'application/json','X-Maevi-Request':'1',...options.headers}});}catch{throw new Error('Não foi possível conectar à loja. Confira se o servidor está rodando e tente novamente.');}
  let data;try{data=await response.json();}catch{throw new Error('Atualize o servidor da loja para continuar.');}
  if(!response.ok){const error=new Error(data.error||'Não foi possível concluir.');error.status=response.status;throw error;}return data;
}
async function loadProducts(){
  $('#catalog-status').textContent='Carregando coleção…';$('#retry-catalog').hidden=true;
  $('#products').setAttribute('aria-busy','true');
  if(!products.length)$('#products').innerHTML=Array.from({length:4},()=>'<div class="skeleton-card" aria-hidden="true"><div class="skeleton-photo"></div><div class="skeleton-line"></div></div>').join('');
  try{const result=await api('/api/products');products=result.products;if(result.catalog){SIZES=result.catalog.sizes;CATEGORIES=result.catalog.categories;}renderCategories();
    const original=cart.length;cart=cart.filter(i=>products.some(p=>p.id===i.id&&Object.hasOwn(p.stock,i.size)));
    if(original!==cart.length){saveCart();toast('Peças indisponíveis foram removidas da sacola.');}
    $('#catalog-status').textContent='';renderProducts();renderCart();document.dispatchEvent(new CustomEvent('maevi:products'));if(!deepLinkHandled){deepLinkHandled=true;const id=new URLSearchParams(location.search).get('produto');if(id&&/^\d+$/.test(id))openProduct(Number(id));}return true;
  }catch(error){$('#catalog-status').textContent=error.message;$('#retry-catalog').hidden=false;if(!products.length)$('#products').innerHTML='';return false;}finally{$('#products').setAttribute('aria-busy','false');}
}
function renderProducts(){
  const query=$('#search').value.trim().toLocaleLowerCase('pt-BR');
  const visible=MaeviCatalog.select(products,{query,category,size:$('#size-filter').value,available:$('#available-only').checked,favoritesOnly,favorites,sort:$('#sort-products').value});
  $('#result-count').textContent=`${visible.length} peça${visible.length===1?'':'s'}${favoritesOnly?' favorita'+(visible.length===1?'':'s'):''}`;
  $('#clear-filters').hidden=!(query||category!=='Todas'||$('#size-filter').value||$('#available-only').checked||favoritesOnly||$('#sort-products').value!=='curated');
  $('#favorites-count').textContent=favorites.filter(id=>products.some(p=>p.id===id)).length;
  $('#favorites-open').setAttribute('aria-pressed',String(favoritesOnly));
  $('#products').innerHTML=visible.map(p=>{const available=Object.values(p.stock).some(n=>n>0),saved=favorites.includes(p.id),tag=!available?'ESGOTADO':(p.featured?'CURADORIA MAÉVI':'');return `<article class="product-card${available?'':' is-soldout'}"><button class="favorite-button" data-favorite="${p.id}" aria-label="${saved?'Remover dos':'Adicionar aos'} favoritos: ${escapeHTML(p.name)}" aria-pressed="${saved}">${saved?'♥':'♡'}</button><button class="product-photo" data-product="${p.id}" aria-label="Ver detalhes de ${escapeHTML(p.name)}"><img src="${escapeHTML(p.image)}" alt="${escapeHTML(p.name)}" width="600" height="800" loading="lazy" decoding="async">${p.secondaryImage?`<img class="secondary-photo" src="${escapeHTML(p.secondaryImage)}" alt="" width="600" height="800" loading="lazy" decoding="async">`:''}${tag?`<span class="tag">${tag}</span>`:''}<span class="quick-view" aria-hidden="true">CONHECER A PEÇA ↗</span></button><div class="product-meta"><p class="product-category">${escapeHTML(p.category)}</p><h3><button class="product-name" data-product="${p.id}" tabindex="-1">${escapeHTML(p.name)}</button></h3><strong class="product-price">${money(p.priceCents)}</strong></div><p class="product-color"><span class="swatch" style="background:${escapeHTML(p.hex)}"></span>${escapeHTML(p.color)}</p><div class="product-sizes" aria-label="Tamanhos disponíveis">${SIZES.map(s=>`<span class="${p.stock[s]>0?'':'unavailable'}">${escapeHTML(s)}</span>`).join('')}</div></article>`;}).join('');
  $('#empty').textContent=favoritesOnly?'Salve suas favoritas tocando no coração das peças. Se já salvou, tente limpar os outros filtros.':'Nenhuma peça encontrada. Tente outra busca ou limpe os filtros.';
  $('#empty').hidden=visible.length>0;
}
function setCategory(value){category=value;document.querySelectorAll('[data-category]').forEach(b=>{const active=b.dataset.category===value;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});renderProducts();}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-category]');if(button){setCategory(button.dataset.category);return;}
  const nav=event.target.closest('[data-nav]');if(nav){favoritesOnly=false;$('#search').value='';$('#size-filter').value='';$('#available-only').checked=false;setCategory(nav.dataset.nav);}
});
const editorial={Vestidos:['editorial-4.jpg','LEVEZA EM MOVIMENTO'],Conjuntos:['editorial-2.jpg','COMPOSIÇÕES COM PRESENÇA'],Blusas:['editorial-3.jpg','O ESSENCIAL DO DIA A DIA']};
function renderCategories(){
  const used=CATEGORIES.filter(c=>products.some(p=>p.category===c));
  if(category!=='Todas'&&!used.includes(category))category='Todas';
  const attr=v=>escapeHTML(v);
  $('#category-filters').innerHTML=['Todas',...used].map(c=>`<button data-category="${attr(c)}" class="${c===category?'active':''}" aria-pressed="${c===category}">${c==='Todas'?'Todas as peças':attr(c)}</button>`).join('');
  $('#nav-categories').innerHTML=used.slice(0,4).map(c=>`<a href="#colecao" data-nav="${attr(c)}">${attr(c)}</a>`).join('');
  $('#menu-categories').innerHTML=used.map(c=>`<a href="#colecao" data-nav="${attr(c)}">${attr(c)} <span>↗</span></a>`).join('');
  const current=$('#size-filter').value;
  $('#size-filter').innerHTML='<option value="">Todos</option>'+SIZES.map(s=>`<option${s===current?' selected':''}>${attr(s)}</option>`).join('');
  $('#edits-grid').innerHTML=used.map((c,index)=>{const list=products.filter(p=>p.category===c),cover=list.find(p=>p.featured)||list[0],[file,label]=editorial[c]||[];const image=file&&/^\/assets\/editorial-\d\.jpg$/.test(cover.image)?'assets/'+file:cover.image;return `<a href="#colecao" data-nav="${attr(c)}" class="edit-card"><img src="${attr(image)}" alt="${attr(c)}: ${attr(cover.name)}" loading="lazy" decoding="async"><span>${String(index+1).padStart(2,'0')} / ${attr(label||list.length+(list.length===1?' PEÇA':' PEÇAS'))}<strong>${attr(c)} <i aria-hidden="true">↗</i></strong></span></a>`;}).join('');
  $('#categorias').hidden=!used.length;
}
$('#search').addEventListener('input',renderProducts);
$('#search-toggle').addEventListener('click',()=>{$('#colecao').scrollIntoView();$('#search').focus({preventScroll:true});});
$('#retry-catalog').addEventListener('click',loadProducts);
['size-filter','sort-products','available-only'].forEach(id=>$('#'+id).addEventListener('change',renderProducts));
function clearFilters(){favoritesOnly=false;$('#search').value='';$('#size-filter').value='';$('#available-only').checked=false;$('#sort-products').value='curated';setCategory('Todas');}
$('#clear-filters').addEventListener('click',clearFilters);
$('#favorites-open').addEventListener('click',()=>{favoritesOnly=!favoritesOnly;$('#search').value='';$('#size-filter').value='';$('#available-only').checked=false;setCategory('Todas');$('#colecao').scrollIntoView();});
$('#products').addEventListener('click',event=>{
  const favorite=event.target.closest('[data-favorite]');if(favorite){const id=Number(favorite.dataset.favorite),saved=favorites.includes(id);if(!saved&&favorites.length>=500){toast('Você atingiu o limite de 500 favoritos neste navegador.');return;}favorites=saved?favorites.filter(n=>n!==id):MaeviCatalog.savedIds([...favorites,id]);try{localStorage.setItem('maevi-favorites-v1',JSON.stringify(favorites));}catch{}renderProducts();($('#products').querySelector(`[data-favorite="${id}"]`)||$('#favorites-open')).focus({preventScroll:true});toast(saved?'Peça removida dos favoritos.':'Peça salva nos seus favoritos.');return;}
  const button=event.target.closest('[data-product]');if(!button)return;
  openProduct(Number(button.dataset.product));
});
function openProduct(id){
  const p=products.find(p=>p.id===id);if(!p){toast("Esta peça não está disponível na vitrine.");return;}let size=null;
  const gallery=[p.image,p.secondaryImage].filter(Boolean);
  const soldOut=!Object.values(p.stock).some(n=>n>0);
  $('#product-detail').innerHTML=`<div class="product-gallery"><div class="gallery-track" id="gallery-track">${gallery.map((src,index)=>`<img ${index===0?'id="gallery-main" ':''}src="${escapeHTML(src)}" alt="${escapeHTML(p.name)}${gallery.length>1?` · foto ${index+1} de ${gallery.length}`:''}" width="900" height="1200" decoding="async" ${index===0?'fetchpriority="high"':'loading="lazy"'}>`).join('')}</div>${gallery.length>1?`<div class="gallery-thumbnails" role="group" aria-label="Fotos da peça">${gallery.map((src,index)=>`<button data-gallery="${index}" aria-label="Ver foto ${index+1}" aria-pressed="${index===0}"><img src="${escapeHTML(src)}" alt="" loading="lazy"></button>`).join('')}</div>`:''}</div><div class="detail-copy"><p class="eyebrow">MAÉVI / ${escapeHTML(p.category.toUpperCase())}</p><h2 id="product-title">${escapeHTML(p.name)}</h2><p class="detail-price">${money(p.priceCents)}</p><p class="detail-color"><span class="swatch" style="background:${escapeHTML(p.hex)}"></span>Cor: ${escapeHTML(p.color)}</p><div class="size-heading"><span id="size-label">Escolha seu tamanho</span><button type="button" class="text-link" id="open-measures">Medidas</button></div><div class="choices" role="group" aria-labelledby="size-label">${SIZES.map(s=>`<button data-size="${escapeHTML(s)}" aria-pressed="false" ${!(p.stock[s]>0)?'disabled aria-label="'+escapeHTML(s)+', esgotado"':''}>${escapeHTML(s)}</button>`).join('')}</div><p id="size-stock" class="size-stock" role="status">${soldOut?'Esta peça está esgotada no momento.':''}</p><div class="detail-actions"><button class="button" id="add-to-cart" ${soldOut?'disabled':'data-needs-size'}>${soldOut?'Peça esgotada':'Escolha seu tamanho'}</button><a class="button outline whatsapp-product" data-whatsapp-product target="_blank" rel="noopener noreferrer" hidden>Tirar dúvidas no WhatsApp ↗</a></div><p class="detail-description">${escapeHTML(p.description)}</p><div class="product-info">${p.material?`<details><summary>Composição e tecido</summary><p>${escapeHTML(p.material)}</p></details>`:''}${p.care?`<details><summary>Cuidados com sua peça</summary><p>${escapeHTML(p.care)}</p></details>`:''}<details id="measures"><summary>Medidas e tamanho</summary><p>${p.measurements?escapeHTML(p.measurements):"As medidas desta modelagem ainda não foram cadastradas. Confira com a loja antes de comprar."}</p></details><button type="button" class="text-link" id="share-product">Copiar link da peça ↗</button><p id="share-message" role="status"></p></div></div>`;
  updateProductWhatsApp(p,null);
  $('#open-measures').addEventListener('click',()=>{const d=$('#measures');d.open=true;d.scrollIntoView({block:'center',behavior:'smooth'});d.querySelector('summary').focus({preventScroll:true});});
  const track=$('#gallery-track');track.addEventListener('scroll',()=>{const index=Math.round(track.scrollLeft/Math.max(1,track.clientWidth));$('#product-detail').querySelectorAll('[data-gallery]').forEach(item=>item.setAttribute('aria-pressed',String(Number(item.dataset.gallery)===index)));},{passive:true});
  $('#share-product').addEventListener('click',async()=>{const url=location.origin+'/?produto='+p.id;try{await navigator.clipboard.writeText(url);$('#share-message').textContent='Link da peça copiado.';}catch{$('#share-message').textContent=url;}});
  $('#product-detail').querySelectorAll('[data-gallery]').forEach(b=>b.addEventListener('click',()=>{const index=Number(b.dataset.gallery);track.scrollTo({left:index*track.clientWidth,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});$('#product-detail').querySelectorAll('[data-gallery]').forEach(item=>item.setAttribute('aria-pressed',String(item===b)));}));
  $('#product-detail').querySelectorAll('[data-size]').forEach(b=>b.addEventListener('click',()=>{
    size=b.dataset.size;$('#product-detail').querySelectorAll('[data-size]').forEach(item=>item.setAttribute('aria-pressed',String(item===b)));
    $('#size-stock').textContent=`Tamanho ${size} · ${p.stock[size]===1?'última unidade':p.stock[size]+' unidades disponíveis'}.`;$('#add-to-cart').disabled=false;delete $('#add-to-cart').dataset.needsSize;$('#add-to-cart').textContent='Adicionar à sacola';updateProductWhatsApp(p,size);
  }));
  $('#add-to-cart').addEventListener('click',()=>{
    if(!size){const first=$('#product-detail').querySelector('[data-size]:not(:disabled)');$('#size-stock').textContent='Selecione um tamanho para adicionar à sacola.';first?.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});first?.focus({preventScroll:true});return;}const item=cart.find(i=>i.id===p.id&&i.size===size);
    if((item?.quantity||0)>=Math.min(20,p.stock[size])){toast('Você já adicionou a quantidade disponível deste tamanho.');return;}
    if(!item&&cart.length>=50){toast('Sua sacola já contém 50 combinações de peças e tamanhos.');return;}if(item)item.quantity++;else cart.push({id:p.id,size,quantity:1});saveCart();$('#product-dialog').close();openCart();
  });$('#product-dialog').showModal();
}
function updateProductWhatsApp(p,size){
  const link=document.querySelector('[data-whatsapp-product]');if(!link)return;link.dataset.productId=p.id;link.dataset.waSize=size||'';const phone=window.MaeviContacts?.whatsapp||'';link.hidden=!phone;if(!phone)return;
  const text=`Olá, MAÉVI! Tenho interesse na peça ${p.name}${size?` (tamanho ${size})`:''}. ${location.origin}/?produto=${p.id}`;
  link.href=`https://wa.me/55${phone}?text=${encodeURIComponent(text)}`;
}
document.addEventListener('maevi:contacts',()=>{const link=document.querySelector('[data-whatsapp-product]'),p=link&&products.find(item=>item.id===Number(link.dataset.productId));if(p)updateProductWhatsApp(p,link.dataset.waSize||null);});
function saveCart(){try{localStorage.setItem('maevi-cart-v1',JSON.stringify(cart));}catch{}$('#checkout-message').textContent='';renderCart();}
function renderCart(){
  $('#cart-count').textContent=cart.reduce((sum,item)=>sum+item.quantity,0);
  $('#cart-items').innerHTML=cart.length?cart.map((item,index)=>{
    const p=products.find(p=>p.id===item.id);if(!p)return '';
    return `<article class="cart-item"><img src="${escapeHTML(p.image)}" alt="${escapeHTML(p.name)}"><div><h3>${escapeHTML(p.name)}</h3><p>${escapeHTML(p.color)} / ${item.size} · ${money(p.priceCents*item.quantity)}</p>${item.quantity>p.stock[item.size]?'<p class="form-error">Estoque alterado. Reduza a quantidade ou remova a peça.</p>':''}<div class="quantity"><button data-change="-1" data-index="${index}" aria-label="Diminuir quantidade">−</button><span>${item.quantity}</span><button data-change="1" data-index="${index}" aria-label="Aumentar quantidade" ${item.quantity>=Math.min(20,p.stock[item.size])?'disabled':''}>+</button><button class="remove" data-remove="${index}">Remover</button></div></div></article>`;
  }).join(''):'<p>Sua sacola está esperando suas novas favoritas.</p><button class="text-link" id="continue-shopping">Explorar a coleção ↗</button>';
  $('#cart-total').textContent=money(cart.reduce((sum,i)=>sum+(products.find(p=>p.id===i.id)?.priceCents||0)*i.quantity,0));
  $('#checkout').disabled=!cart.length||!products.length;$('#continue-shopping')?.addEventListener('click',()=>{$('#cart-dialog').close();$('#colecao').scrollIntoView();});
}
$('#cart-items').addEventListener('click',event=>{
  const remove=event.target.closest('[data-remove]');if(remove){cart.splice(Number(remove.dataset.remove),1);saveCart();return;}
  const change=event.target.closest('[data-change]');if(!change)return;const index=Number(change.dataset.index),item=cart[index],p=products.find(p=>p.id===item.id);
  if(Number(change.dataset.change)>0&&item.quantity>=Math.min(20,p.stock[item.size]))return;
  item.quantity+=Number(change.dataset.change);if(item.quantity<=0)cart.splice(index,1);saveCart();
});
function openCart(){renderCart();$('#cart-dialog').showModal();}
$('#cart-open').addEventListener('click',openCart);$('#footer-bag').addEventListener('click',openCart);
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>document.getElementById(b.dataset.close).close()));
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}}));
window.MaeviStore=Object.freeze({api,money,escapeHTML,toast,openCart,openProduct,getCart:()=>cart.map(i=>({...i})),getProducts:()=>products,emptyCart:()=>{cart=[];saveCart();},refreshCatalog:loadProducts,getLastOrder:()=>lastOrder,rememberOrder:value=>{lastOrder=value;try{sessionStorage.setItem('maevi-last-order',JSON.stringify(value));}catch{}}});
$('#year').textContent=new Date().getFullYear();setCategory('Todas');renderCart();loadProducts();
