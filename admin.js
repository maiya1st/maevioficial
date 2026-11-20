const $=s=>document.querySelector(s);
const escapeHTML=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=c=>(c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const next={demo_payment_pending:[],demo_payment_review:['demo_preparing','demo_cancelled'],demo_paid:['demo_preparing','demo_cancelled'],demo_received:['demo_cancelled'],demo_preparing:['demo_ready','demo_cancelled'],demo_ready:['demo_completed','demo_cancelled'],demo_completed:[],demo_cancelled:[],demo_expired:[]};
const labels={demo_received:'Aguardando pagamento',demo_payment_pending:'Pagamento em andamento',demo_payment_review:'Pagamento em conferência',demo_paid:'Pago',demo_preparing:'Em preparação',demo_ready:'Pronto para envio/retirada',demo_completed:'Concluído',demo_cancelled:'Cancelado',demo_expired:'Reserva expirada'};
let payment={};const label=s=>labels[s]||s;
const paidOrder=o=>Boolean(o.payment?.provider&&o.payment.status==='approved');
const nextFor=o=>next[o.status]||[];
function actionLabel(o,s){if(s!=='demo_cancelled')return o.status==='demo_payment_review'&&s==='demo_preparing'?'Conferido: está pago':label(s);if(o.status==='demo_payment_review')return 'Cancelar (conferido no Mercado Pago)';return paidOrder(o)?'Cancelar e estornar':('Cancelar e devolver estoque');}
const TITLES={catalog:'Peças',orders:'Pedidos',structure:'Categorias e tamanhos',settings:'Loja',coupons:'Cupons',customers:'Clientes',account:'Minha conta'};
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
let alerts=[],subscribers=[],products=[],orders=[],activity=[],catalog={categories:[],sizes:[],version:0},modelLibrary={version:0,models:[]},account={configured:false,email:''},sessionMethod='',authEpoch=0,toastTimer,aiConfigured=false;
const sum=stock=>Object.values(stock||{}).reduce((a,b)=>a+b,0);

function toast(message){const t=$('#admin-toast');t.textContent=message;t.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('visible'),3800);}
function loggedIn(value){
  $('#login-section').hidden=value;$('#dashboard').hidden=!value;document.body.classList.toggle('is-authenticated',value);
  if(!value){authEpoch++;products=[];orders=[];activity=[];$('#admin-products').innerHTML='';$('#admin-orders').innerHTML='';$('#admin-activity').innerHTML='';$('#stats').innerHTML='';$('#product-form').reset();if($('#edit-dialog').open)$('#edit-dialog').close();document.dispatchEvent(new Event('maevi:admin-logout'));}
}
async function api(url,options={}){
  const {timeout=20000,...rest}=options;options=rest;
  let response;try{response=await fetch(url,{signal:AbortSignal.timeout(timeout),...options,headers:{'Content-Type':'application/json','X-Maevi-Request':'1',...options.headers}});}catch{throw new Error('Não foi possível falar com a loja. Confira a conexão e tente de novo.');}
  let result={};try{result=await response.json();}catch{}
  if(!response.ok){if(response.status===401&&!url.endsWith('/login')&&!url.endsWith('/account'))loggedIn(false);const error=new Error(result.error||'Não foi possível concluir.');error.status=response.status;throw error;}return result;
}
async function refresh(silent=false){
  $('#refresh').disabled=true;const epoch=authEpoch;
  try{
    const [list,purchases,events,structure,models,me,settings,waiting,emails,aiStatus]=await Promise.all([api('/api/admin/products'),api('/api/admin/orders'),api('/api/admin/activity'),api('/api/admin/catalog'),api('/api/admin/model-library'),api('/api/admin/account'),api('/api/admin/settings'),api('/api/admin/alerts'),api('/api/admin/subscribers'),api('/api/admin/ai-catalog').catch(()=>({configured:false}))]);alerts=waiting.alerts;subscribers=emails.subscribers;payment=settings.payment||{};
    if(epoch!==authEpoch)return false;
    products=list.products;orders=purchases.orders;activity=events.activity;catalog=structure.catalog;modelLibrary=models.library;aiConfigured=Boolean(aiStatus.configured);$('#ai-generate').disabled=!aiConfigured;account=me.account;sessionMethod=me.session.method;
    loggedIn(true);render();renderStructure();renderModelLibrary();renderAccount();renderCustomers();document.dispatchEvent(new Event('maevi:admin-ready'));
    if(!silent)toast('Dados atualizados.');return true;
  }catch(error){if(!silent&&!$('#dashboard').hidden)$('#dashboard-message').textContent=error.message;return false;}
  finally{$('#refresh').disabled=false;}
}

/* ---------- Abas ---------- */
function showTab(tab){
  if(!TITLES[tab])tab='catalog';
  document.querySelectorAll('[data-tab]').forEach(b=>{const on=b.dataset.tab===tab;b.classList.toggle('active',on);b.setAttribute('aria-current',on?'page':'false');});
  for(const name of Object.keys(TITLES))$('#'+name+'-panel').hidden=name!==tab;
  $('#stats').hidden=tab!=='catalog';$('#panel-title').textContent=TITLES[tab];$('#dashboard-message').textContent='';
  try{sessionStorage.setItem('maevi-admin-tab',tab);}catch{}
}
document.addEventListener('click',event=>{
  const tab=event.target.closest('[data-tab],[data-goto]');if(tab){showTab(tab.dataset.tab||tab.dataset.goto);$('#admin-main').scrollIntoView({behavior:reduced()?'instant':'smooth',block:'start'});}
  const reveal=event.target.closest('.reveal-password');if(reveal){const input=reveal.parentElement.querySelector('input'),show=input.type==='password';input.type=show?'text':'password';reveal.setAttribute('aria-pressed',String(show));reveal.setAttribute('aria-label',show?'Ocultar':'Mostrar');input.focus();}
});

/* ---------- Painel de peças ---------- */
function render(){
  const stock=products.reduce((t,p)=>t+sum(p.stock),0),visible=products.filter(p=>p.active).length,low=products.filter(p=>p.active&&Object.values(p.stock).some(n=>n<=2)).length;
  const open=orders.filter(o=>!['demo_cancelled','demo_completed','demo_expired'].includes(o.status)).length;
  $('#stats').innerHTML=[[visible+' / '+products.length,'Peças na vitrine'],[stock,'Unidades em estoque'],[low,'Peças com estoque baixo'],[open,'Pedidos em andamento']].map(([n,l])=>`<div><strong>${escapeHTML(n)}</strong><span>${l}</span></div>`).join('');
  const filter=$('#admin-category-filter'),chosen=filter.value;
  filter.innerHTML='<option value="">Todas as categorias</option>'+catalog.categories.map(c=>`<option${c===chosen?' selected':''}>${escapeHTML(c)}</option>`).join('');
  const q=$('#admin-product-search').value.trim().toLocaleLowerCase('pt-BR');
  const list=products.filter(p=>[p.name,p.category,p.color].join(' ').toLocaleLowerCase('pt-BR').includes(q)&&(!filter.value||p.category===filter.value)&&(!$('#low-stock-only').checked||Object.values(p.stock).some(n=>n<=2))&&(!$('#hidden-only').checked||!p.active));
  const seen=new Set(),cardsList=list.filter(p=>{const k=p.colorGroup||'p'+p.id;if(seen.has(k))return false;seen.add(k);return true;});
  $('#admin-products').innerHTML=cardsList.length?cardsList.map(p=>{
    const tones=p.colorGroup?products.filter(x=>x.colorGroup===p.colorGroup).sort((a,b)=>a.id-b.id):[p];
    const stockBy=Object.fromEntries(catalog.sizes.map(s=>[s,tones.reduce((t,x)=>t+(x.stock[s]||0),0)])),total=sum(stockBy),photos=tones.reduce((t,x)=>t+[x.image,x.secondaryImage,...(x.extraImages||[])].filter(Boolean).length,0);
    const badges=[!p.active&&'<span class="badge muted">Oculta</span>',p.featured&&'<span class="badge">Destaque</span>',total===0?'<span class="badge alert">Esgotada</span>':tones.some(x=>Object.values(x.stock).some(n=>n<=2))&&'<span class="badge warn">Estoque baixo</span>'].filter(Boolean).join('');
    return `<article class="admin-card${p.active?'':' is-hidden'}"><button type="button" class="admin-card-photo" data-edit="${p.id}" aria-label="Editar ${escapeHTML(p.name)}"><img src="${escapeHTML(p.image)}" alt="" loading="lazy"><span class="badges">${badges}</span><span class="photo-count">${photos} foto${photos===1?'':'s'}</span></button><div class="admin-card-body"><p class="admin-card-cat">${escapeHTML(p.category)} · ${tones.length>1?`<span class="tone-dots">${tones.map(x=>`<i style="background:${escapeHTML(x.hex)}" title="${escapeHTML(x.color)}"></i>`).join('')}</span>${tones.length} cores`:escapeHTML(p.color)}</p><h3>${escapeHTML(p.name)}</h3><p class="admin-card-price">${money(p.priceCents)}</p><ul class="stock-chips" aria-label="Estoque por tamanho${tones.length>1?', somando as cores':''}">${catalog.sizes.map(s=>`<li class="${!(stockBy[s]>0)?'zero':stockBy[s]<=2?'low':''}"><b>${escapeHTML(s)}</b>${stockBy[s]}</li>`).join('')}</ul><div class="admin-card-actions"><button type="button" class="button small" data-edit="${p.id}">Editar</button><button type="button" class="text-link" data-toggle="${p.id}">${p.active?'Ocultar da vitrine':'Mostrar na vitrine'}</button></div></div></article>`;
  }).join(''):`<div class="empty-state"><p>${products.length?'Nenhuma peça com esses filtros.':'Nenhuma peça cadastrada ainda.'}</p><button type="button" class="button" id="empty-new">+ Cadastrar peça</button></div>`;
  const oq=$('#admin-order-search').value.trim().toLocaleLowerCase('pt-BR'),status=$('#admin-order-status').value;
  const visibleOrders=orders.filter(o=>(!status||status===o.status)&&[o.id,o.customer.name,o.customer.email].join(' ').toLocaleLowerCase('pt-BR').includes(oq));
  $('#admin-orders').innerHTML=visibleOrders.length?visibleOrders.map(o=>`<article class="admin-order"><div class="admin-order-head"><div><h3>${escapeHTML(o.id)}</h3><p>${new Date(o.createdAt).toLocaleString('pt-BR')}</p></div><span class="status-pill">${escapeHTML(label(o.status))}</span></div><p>${escapeHTML(o.customer.name)} · ${escapeHTML(o.customer.email)}${o.customer.phone?" · "+escapeHTML(o.customer.phone):""}</p>${o.address?`<p class="order-address">${escapeHTML(o.address.street)}, ${escapeHTML(o.address.number)} ${escapeHTML(o.address.complement)} · ${escapeHTML(o.address.district)} · ${escapeHTML(o.address.city)} / ${escapeHTML(o.address.state)} · CEP ${escapeHTML(o.address.cep)}</p>`:""}<div class="order-lines">${o.items.map(i=>`<div><span>${escapeHTML(i.name)} / ${escapeHTML(i.color)} · ${escapeHTML(i.size)} × ${i.quantity}</span><strong>${money(i.lineCents)}</strong></div>`).join('')}<div><span>${('Total')} · ${o.shipping?.method==="delivery"?"entrega":"retirada"}</span><strong>${money(o.totalCents)}</strong></div></div>${o.discountCents?`<p>Cupom ${escapeHTML(o.coupon.code)} · desconto ${money(o.discountCents)}</p>`:""}<p>Entrega: ${money(o.shippingCents||0)} · ${o.payment?.provider?'Mercado Pago: '+escapeHTML(({approved:'aprovado',pending:'pendente',in_process:'em análise',rejected:'recusado',cancelled:'cancelado',refunded:'estornado',charged_back:'contestado',in_mediation:'em disputa',creating:'abrindo'})[o.payment.status]||o.payment.status):'pagamento não iniciado'}</p><p class="history-note">${(o.history||[{status:o.status,at:o.createdAt}]).map(h=>`${escapeHTML(label(h.status))} · ${escapeHTML(new Date(h.at).toLocaleString('pt-BR'))}`).join(' → ')}</p><div class="admin-order-actions">${nextFor(o).map(s=>`<button data-order="${o.id}" data-status="${s}" class="${s==='demo_cancelled'?'cancel-order':''}">${escapeHTML(actionLabel(o,s))}</button>`).join('')}</div></article>`).join(''):'<p class="empty-state">Nenhum pedido encontrado com esses filtros.</p>';
  const actions={created:'Cadastro criado',updated:'Cadastro atualizado',uploaded:'Foto enviada',deleted:'Excluído',...labels};
  const entities={product:'Peça',order:'Pedido',settings:'Configuração',coupon:'Cupom',image:'Imagem',catalog:'Categorias e tamanhos',account:'Conta de acesso'};
  $('#admin-activity').innerHTML=activity.length?activity.map(a=>`<li><span>${escapeHTML(actions[a.action]||a.action)} · ${entities[a.entity]||'Registro'} ${a.entity==='catalog'||a.entity==='account'?'':escapeHTML(a.entity_id)}</span><time>${escapeHTML(new Date(a.at).toLocaleString('pt-BR'))}</time></li>`).join(''):'<li>Os próximos cadastros e pedidos aparecerão aqui.</li>';
}
['admin-product-search','admin-order-search'].forEach(id=>$('#'+id).addEventListener('input',render));
['low-stock-only','hidden-only','admin-order-status','admin-category-filter'].forEach(id=>$('#'+id).addEventListener('change',render));
$('#refresh').addEventListener('click',()=>refresh());
$('#admin-products').addEventListener('click',async event=>{
  const edit=event.target.closest('[data-edit]');if(edit){openEditor(products.find(p=>p.id===Number(edit.dataset.edit)));return;}
  if(event.target.closest('#empty-new')){openEditor(null);return;}
  const toggle=event.target.closest('[data-toggle]');if(!toggle)return;
  const p=products.find(x=>x.id===Number(toggle.dataset.toggle)),tones=p.colorGroup?products.filter(x=>x.colorGroup===p.colorGroup):[p];toggle.disabled=true;
  try{for(const x of tones)await api('/api/admin/products/'+x.id,{method:'PUT',body:JSON.stringify({...x,active:!p.active,version:x.version||0})});await refresh(true);toast(p.active?'Peça ocultada da vitrine.':'Peça visível na vitrine.');}
  catch(error){toast(error.message);toggle.disabled=false;}
});
$('#admin-orders').addEventListener('click',async event=>{
  const button=event.target.closest('[data-order]');if(!button)return;
  const o=orders.find(x=>x.id===button.dataset.order);
  if(button.dataset.status==='demo_cancelled'&&!await confirmBox(paidOrder(o)?'Cancelar e estornar?':'Cancelar pedido?',paidOrder(o)?`O valor de ${money(o.totalCents)} volta para a cliente pelo Mercado Pago e as peças voltam ao estoque.`:o.status==='demo_payment_review'?'Confira no painel do Mercado Pago se não há pagamento. Se houver, faça o estorno por lá. As peças voltam ao estoque.':'As peças voltam ao estoque.','Cancelar pedido'))return;
  if(button.dataset.status==='demo_preparing'&&o.status==='demo_payment_review'&&!await confirmBox('O pagamento está confirmado?','Confira no painel do Mercado Pago se o valor foi aprovado antes de preparar o pedido.','Sim, está pago'))return;
  button.disabled=true;
  try{const r=await api('/api/admin/orders/'+button.dataset.order,{method:'PATCH',body:JSON.stringify({status:button.dataset.status})});await refresh(true);toast(r.refunded?'Pedido cancelado e valor estornado.':'Situação do pedido atualizada.');}catch(error){toast(error.message);button.disabled=false;}
});

/* ---------- Editor de peça (cores, fotos e estoque) ---------- */
const form=$('#product-form'),MAX_PHOTOS=8;
let editing=null,snapshot='',uploads=0,variants=[],vIndex=0,groupKey='',removedIds=[],selectedModelSizes=null;
let lookSel=new Set(),chart={columns:['Busto','Cintura','Quadril'],rows:{}};
const newGroup=()=>'g'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const groupOf=p=>p?.colorGroup?products.filter(x=>x.colorGroup===p.colorGroup).sort((a,b)=>a.id-b.id):p?[p]:[];
function variantFrom(p){return {id:p?.id||null,version:p?.version||0,color:p?.color||'',hex:p?.hex||'#303521',photos:[p?.image,p?.secondaryImage,...(p?.extraImages||[])].filter(Boolean),stock:{...(p?.stock||{})}};}
function stockInputs(stock){
  $('#stock-grid').innerHTML=catalog.sizes.filter(s=>!selectedModelSizes||selectedModelSizes.includes(s)).map(s=>`<div class="stepper"><span>${escapeHTML(s)}</span><button type="button" data-step="-1" aria-label="Diminuir ${escapeHTML(s)}">−</button><input type="number" inputmode="numeric" min="0" max="10000" value="${Number(stock?.[s])||0}" data-size="${escapeHTML(s)}" aria-label="Estoque do tamanho ${escapeHTML(s)}"><button type="button" data-step="1" aria-label="Aumentar ${escapeHTML(s)}">+</button></div>`).join('');
}
function readStock(){const existing=variants[vIndex]?.stock||{};return Object.fromEntries(catalog.sizes.map(s=>{const i=[...$('#stock-grid').querySelectorAll('input[data-size]')].find(input=>input.dataset.size===s);return [s,i?Math.max(0,Math.min(10000,Math.trunc(Number(i.value))||0)):(existing[s]||0)];}));}
function syncVariant(){const v=variants[vIndex];if(!v||!$('#stock-grid').querySelector('input'))return;v.color=$('#v-color').value.trim();v.hex=$('#v-hex').value;v.stock=readStock();}
function renderTabs(){
  $('#variant-tabs').innerHTML=variants.map((v,i)=>`<button type="button" role="tab" data-variant="${i}" aria-selected="${i===vIndex}"><i style="background:${escapeHTML(/^#[0-9a-f]{6}$/i.test(v.hex)?v.hex:'#303521')}"></i>${escapeHTML(v.color||'Nova cor')}${v.photos[0]?'':'<em>sem foto</em>'}</button>`).join('')+`<button type="button" class="add-variant" id="add-variant">+ Adicionar cor</button>`;
  $('#remove-color').hidden=variants.length<2;
  const used=new Set(variants.map(v=>v.id));
  $('#join-color').innerHTML='<option value="">Escolher peça…</option>'+products.filter(x=>!used.has(x.id)&&(!x.colorGroup||x.colorGroup!==groupKey)).map(x=>`<option value="${x.id}">${escapeHTML(x.name)} · ${escapeHTML(x.color)}</option>`).join('');
}
function renderPhotos(){
  const v=variants[vIndex],n=v.photos.length;
  $('#photo-grid').innerHTML=v.photos.map((src,i)=>`<figure class="photo-tile${i===0?' is-cover':''}"><img src="${escapeHTML(src)}" alt="Foto ${i+1}">${i===0?'<span class="cover-tag">Capa</span>':''}<button type="button" class="photo-remove-x" data-photo-remove="${i}" aria-label="Remover foto">×</button><div class="photo-tools"><button type="button" data-photo-move="${i}" data-dir="-1" aria-label="Mover para a esquerda"${i===0?' disabled':''}>‹</button>${i?`<button type="button" data-photo-cover="${i}">Capa</button>`:''}<button type="button" data-photo-move="${i}" data-dir="1" aria-label="Mover para a direita"${i===n-1?' disabled':''}>›</button></div></figure>`).join('')+(n<MAX_PHOTOS?`<label for="photo-input" class="photo-add${n?'':' is-empty'}"><b>+</b><span>${n?'Adicionar fotos':'Adicionar fotos desta cor'}</span><small>${n}/${MAX_PHOTOS}</small></label>`:'');
}
function loadVariant(i){
  syncVariant();vIndex=i;const v=variants[i];
  $('#v-color').value=v.color;$('#v-hex').value=/^#[0-9a-f]{6}$/i.test(v.hex)?v.hex:'#303521';$('#hex-label').textContent=$('#v-hex').value;
  stockInputs(v.stock);renderPhotos();renderTabs();preview();
  $('#photo-note').textContent=v.photos.length?`${v.photos.length} foto${v.photos.length===1?'':'s'} nesta cor. A primeira é a capa.`:'Até 8 fotos. Pode mandar direto da galeria do celular: o painel reduz o tamanho antes de enviar. A primeira é a capa.';
}
function formData(){
  syncVariant();const f=new FormData(form),ids=new Set(variants.map(v=>v.id).filter(Boolean));
  return {name:f.get('name').trim(),category:f.get('category'),priceCents:Math.round(Number(String(f.get('price')).replace(',','.'))*100),description:f.get('description').trim(),material:f.get('material'),care:f.get('care'),measurements:f.get('measurements'),featured:f.get('featured')==='on',active:f.get('active')==='on',look:[...lookSel].filter(id=>!ids.has(id)),sizeChart:readChart(),variants:variants.map(v=>({id:v.id,color:v.color,hex:v.hex,photos:[...v.photos],stock:{...v.stock}})),removed:[...removedIds]};
}
function preview(){
  const d=formData(),v=d.variants[vIndex]||{photos:[],stock:{}},total=sum(v.stock);$('#hex-label').textContent=$('#v-hex').value;$('#stock-total').textContent=`${total} unidade${total===1?'':'s'} desta cor`;
  $('#product-preview').innerHTML=`<article class="preview-card"><div class="preview-photo">${v.photos[0]?`<img src="${escapeHTML(v.photos[0])}" alt="">`:'<span>A capa desta cor aparece aqui</span>'}${total===0?'<span class="tag">ESGOTADO</span>':d.featured?'<span class="tag">CURADORIA MAÉVI</span>':''}</div><p class="preview-cat">${escapeHTML(d.category||'Categoria')}</p><h3>${escapeHTML(d.name||'Nome da peça')}</h3><p class="preview-price">${d.priceCents>0?money(d.priceCents):'R$ 0,00'}</p><p class="preview-color">${d.variants.length>1?d.variants.map(x=>`<i style="background:${escapeHTML(/^#[0-9a-f]{6}$/i.test(x.hex)?x.hex:'#303521')}"></i>`).join('')+d.variants.length+' cores':`<i style="background:${escapeHTML(v.hex||'#303521')}"></i>${escapeHTML(v.color||'Cor')}`}</p><p class="preview-sizes">${catalog.sizes.filter(s=>!selectedModelSizes||selectedModelSizes.includes(s)).map(s=>`<span class="${v.stock[s]>0?'':'off'}">${escapeHTML(s)}</span>`).join('')}</p>${v.photos.length>1?`<p class="preview-hidden" style="color:var(--muted)">${v.photos.length} fotos nesta cor</p>`:''}${d.active?'':'<p class="preview-hidden">Oculta: não aparece para as clientes</p>'}</article>`;
}
function openEditor(p){
  aiRequestVersion++;editing=p||null;form.reset();aiDraft=null;$('#ai-notes').value='';$('#ai-generate').disabled=!aiConfigured;$('#ai-message').textContent=aiConfigured?'':'Assistente de IA não configurado. O cadastro manual continua disponível.';$('#ai-review').hidden=true;$('#ai-model-suggestion').hidden=true;$('#ai-model-unknown').hidden=true;$('#edit-message').textContent='';$('#edit-title').textContent=p?'Editar peça':'Nova peça';$('#delete-product').hidden=!p;
  $('#product-category').innerHTML=catalog.categories.map(c=>`<option>${escapeHTML(c)}</option>`).join('');
  selectedModelSizes=null;renderModelSelect();
  const v=p?{...p,price:(p.priceCents/100).toFixed(2)}:{category:catalog.categories[0]||''};
  for(const name of ['name','category','price','description','material','care','measurements']){const input=form.elements.namedItem(name);if(input&&v[name]!==undefined)input.value=v[name];}
  form.elements.active.checked=p?p.active:true;form.elements.featured.checked=Boolean(p?.featured);
  const group=groupOf(p);variants=group.length?group.map(variantFrom):[variantFrom(null)];vIndex=Math.max(0,variants.findIndex(x=>x.id===p?.id));groupKey=p?.colorGroup||'';removedIds=[];
  $('#stock-grid').innerHTML='';
  lookSel=new Set(p?.look||[]);
  chart=p?.sizeChart?{columns:[...p.sizeChart.columns],rows:Object.fromEntries(Object.entries(p.sizeChart.rows).map(([k,x])=>[k,[...x]]))}:{columns:['Busto','Cintura','Quadril'],rows:{}};
  $('#chart-copy').innerHTML='<option value="">Copiar tabela de outra peça…</option>'+products.filter(x=>x.sizeChart&&!group.some(g=>g.id===x.id)).map(x=>`<option value="${x.id}">${escapeHTML(x.name)} · ${escapeHTML(x.color)}</option>`).join('');
  $('#look-search').value='';renderChart();renderPickers();
  const i=vIndex;vIndex=0;loadVariant(i);
  if(variants.length>1)$('#edit-title').textContent=`Editar peça · ${variants.length} cores`;
  snapshot=JSON.stringify(formData());$('#edit-dialog').showModal();form.elements.name.focus();
}
function closeEditor(){if(JSON.stringify(formData())!==snapshot&&!confirm('Sair sem salvar as alterações desta peça?'))return;aiRequestVersion++;$('#edit-dialog').close();}
// Draft assistant: never saves or publishes a product.
let aiDraft=null,aiRequestVersion=0;
async function aiImagePreview(){
  const src=variants[vIndex]?.photos[0];if(!src)return null;
  const image=new Image();image.decoding='async';image.src=src;
  try{await image.decode();}catch{return null;}
  const canvas=document.createElement('canvas'),scale=Math.min(1,320/Math.max(image.naturalWidth,image.naturalHeight));
  canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/jpeg',.55);
}
$('#ai-generate').addEventListener('click',async()=>{
  const button=$('#ai-generate'),message=$('#ai-message');
  if(uploads){message.textContent='Espere as fotos terminarem de carregar.';return;}
  const requestVersion=++aiRequestVersion;
  if(!aiConfigured){message.textContent='Assistente de IA não configurado. O cadastro manual continua disponível.';return;}
  button.disabled=true;message.textContent='Preparando sugestão…';$('#ai-review').hidden=true;aiDraft=null;
  try{
    let image=null;try{image=await aiImagePreview();}catch{message.textContent='A foto não pôde ser analisada; usaremos apenas os detalhes informados.';}
    const notes=$('#ai-notes').value.trim();
    if(!image&&!notes){message.textContent='Adicione uma foto ou descreva a peça antes de gerar.';return;}
    message.textContent='Analisando informações e preparando descrição…';
    const result=await api('/api/admin/ai-catalog',{method:'POST',body:JSON.stringify({notes,image,category:form.elements.category.value}),timeout:35000});
    if(requestVersion!==aiRequestVersion||!$('#edit-dialog').open)return;
    aiDraft=result.draft;
    $('#ai-suggested-name').textContent=aiDraft.name;
    $('#ai-suggested-description').textContent=aiDraft.description;
    $('#ai-suggested-category').textContent=aiDraft.category||'Conferir manualmente';
    $('#ai-observations').textContent=aiDraft.observations?'Verificar: '+aiDraft.observations:'';
    const suggested=modelLibrary.models.find(m=>m.id===aiDraft.modelSuggestion?.id);
    $('#ai-model-suggestion').hidden=!suggested;
    $('#ai-model-unknown').hidden=Boolean(suggested)||modelLibrary.models.length===0;
    if(suggested){$('#ai-suggested-model').textContent=suggested.name+' · '+suggested.category+' · '+money(suggested.priceCents);$('#ai-model-reason').textContent=aiDraft.modelSuggestion.reason||'Confira as características antes de confirmar.';}
    $('#ai-review').hidden=false;message.textContent='Sugestão pronta para sua conferência.';
  }catch(error){if(requestVersion===aiRequestVersion&&$('#edit-dialog').open)message.textContent=error.message;}
  finally{if(requestVersion===aiRequestVersion)button.disabled=!aiConfigured;}
});
$('#ai-apply').addEventListener('click',()=>{
  if(!aiDraft)return;
  form.elements.name.value=aiDraft.name;
  form.elements.description.value=aiDraft.description;
  const selected=modelLibrary.models.find(m=>m.id===$('#product-model').value);
  if(aiDraft.category&&catalog.categories.includes(aiDraft.category)){
    if(!selected||selected.category===aiDraft.category)form.elements.category.value=aiDraft.category;
    else $('#ai-message').textContent='Categoria sugerida diferente da do modelo selecionado. Modelo e preço preservados.';
  }
  if(!editing)form.elements.active.checked=false; // AI-assisted new pieces stay hidden until explicitly published.
  preview();$('#ai-message').textContent='Textos aplicados. Produto novo ficará oculto até você autorizar a publicação. Confira preço, cor, tamanhos e estoque antes de salvar.';
});
$('#ai-apply-model').addEventListener('click',()=>{
  if(!aiDraft?.modelSuggestion)return;
  const matching=modelLibrary.models.find(m=>m.id===aiDraft.modelSuggestion.id);
  if(!matching){$('#ai-message').textContent='Modelo não está mais na biblioteca. Atualize os dados.';return;}
  $('#product-model').value=matching.id;
  $('#product-model').dispatchEvent(new Event('change',{bubbles:true}));
  if(!editing)form.elements.active.checked=false;
  $('#ai-message').textContent='Modelo confirmado. Preço e tamanhos sugeridos pela biblioteca; confira e ajuste antes de salvar.';
});
function renderModelSelect(){
  const select=$('#product-model');
  select.innerHTML='<option value="">Cadastro manual (sem modelo)</option>'+modelLibrary.models.map(m=>`<option value="${escapeHTML(m.id)}">${escapeHTML(m.category)} · ${escapeHTML(m.name)} · ${money(m.priceCents)}</option>`).join('');
  $('#product-model-hint').textContent='Selecione um modelo para sugerir categoria, preço e tamanhos. O valor continua editável.';
}
$('#product-model').addEventListener('change',event=>{
  const m=modelLibrary.models.find(x=>x.id===event.target.value);
  syncVariant();selectedModelSizes=m&&!editing?m.sizes:null;
  if(m){
    form.elements.category.value=m.category;form.elements.price.value=(m.priceCents/100).toFixed(2);
    if(!form.elements.name.value.trim())form.elements.name.value=m.name;
    $('#product-model-hint').textContent='Preço sugerido pelo modelo, pode alterar. Tamanhos: '+m.sizes.join(', ')+'.';
  }else $('#product-model-hint').textContent='Cadastro manual: informe categoria, preço e quantidades.';
  stockInputs(variants[vIndex].stock);preview();
});
$('#new-product').addEventListener('click',()=>openEditor(null));
$('#close-edit').addEventListener('click',closeEditor);$('#cancel-edit').addEventListener('click',closeEditor);
$('#edit-dialog').addEventListener('cancel',event=>{event.preventDefault();closeEditor();});
form.addEventListener('input',e=>{if(e.target.id==='v-color'||e.target.id==='v-hex'){syncVariant();renderTabs();}preview();});
form.addEventListener('change',preview);
$('#stock-grid').addEventListener('click',event=>{const b=event.target.closest('[data-step]');if(!b)return;const input=b.parentElement.querySelector('input');input.value=Math.max(0,Math.min(10000,(Number(input.value)||0)+Number(b.dataset.step)));preview();});
$('#variant-tabs').addEventListener('click',e=>{
  if(e.target.closest('#add-variant')){syncVariant();variants.push({id:null,version:0,color:'',hex:'#303521',photos:[],stock:{}});loadVariant(variants.length-1);$('#v-color').focus();return;}
  const t=e.target.closest('[data-variant]');if(t)loadVariant(Number(t.dataset.variant));
});
$('#remove-color').addEventListener('click',async()=>{
  if(variants.length<2)return;syncVariant();const v=variants[vIndex];
  if(!await confirmBox(`Remover a cor ${v.color||'nova'}?`,v.id?'Esta cor sai da vitrine quando você salvar. As fotos dela também são apagadas.':'A cor ainda não foi salva.','Remover cor'))return;
  if(v.id)removedIds.push(v.id);variants.splice(vIndex,1);vIndex=0;$('#stock-grid').innerHTML='';loadVariant(0);
});
$('#join-color').addEventListener('change',e=>{const x=products.find(p=>p.id===Number(e.target.value));e.target.value='';if(!x)return;syncVariant();variants.push(variantFrom(x));loadVariant(variants.length-1);toast(`${x.name} (${x.color}) virou uma cor desta peça. Salve para confirmar.`);});
// Reduz a foto no aparelho antes de enviar: fotos de celular têm 3 a 8 MB; na loja bastam ~2000 px.
async function prepareImage(file){
  const MAX=2000;let bitmap;
  try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});}
  catch{if(['image/jpeg','image/png','image/webp'].includes(file.type)&&file.size<=4194304)return file;throw new Error(`Não foi possível abrir ${file.name||'a foto'}. Use JPG ou PNG (no iPhone: Ajustes, Câmera, Formatos, Mais Compatível).`);}
  const scale=Math.min(1,MAX/Math.max(bitmap.width,bitmap.height)),w=Math.round(bitmap.width*scale),h=Math.round(bitmap.height*scale);
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(bitmap,0,0,w,h);bitmap.close?.();
  let blob=null;for(const q of [0.86,0.78,0.7]){blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',q));if(blob&&blob.size<=1800000)break;}
  if(!blob)throw new Error('Não foi possível preparar a foto.');
  if(['image/jpeg','image/png','image/webp'].includes(file.type)&&file.size<=blob.size&&file.size<=4194304&&scale===1)return file;
  if(blob.size>4194304)throw new Error('A foto continua grande demais depois de reduzida.');
  return new File([blob],(file.name||'foto').replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg'});
}
async function uploadPhotos(files){
  const v=variants[vIndex],note=$('#photo-note'),list=[...files].filter(Boolean),room=MAX_PHOTOS-v.photos.length;
  if(!list.length)return;if(room<=0){toast('Esta cor já tem 8 fotos.');return;}
  const valid=list.filter(f=>!f.type||f.type.startsWith('image/')||/\.(heic|heif|jpe?g|png|webp)$/i.test(f.name||'')).slice(0,room);
  if(valid.length<Math.min(list.length,room))toast('Alguns arquivos não são fotos e foram ignorados.');
  if(list.length>room)toast(`Só cabem mais ${room} foto${room===1?'':'s'} nesta cor.`);
  const failures=[];
  uploads++;$('#save-product').disabled=true;$('#photo-grid').classList.add('is-uploading');
  try{
    for(const [i,original] of valid.entries()){
      const label=valid.length>1?` ${i+1} de ${valid.length}`:'';
      try{note.textContent=`Preparando foto${label}…`;const file=await prepareImage(original);
        note.textContent=`Enviando foto${label} (${Math.max(1,Math.round(file.size/1024))} KB)…`;
        const r=await api('/api/admin/images',{method:'POST',headers:{'Content-Type':file.type},body:file,timeout:90000});v.photos.push(r.image);if(variants[vIndex]===v)renderPhotos();}
      catch(error){failures.push(`${original.name||'foto'}: ${error.message}`);}
    }
    note.textContent=failures.length?`${valid.length-failures.length} de ${valid.length} fotos enviadas. ${failures[0]}`:`${v.photos.length} foto${v.photos.length===1?'':'s'} nesta cor. A primeira é a capa.`;
  }
  finally{uploads--;$('#photo-grid').classList.remove('is-uploading');$('#save-product').disabled=uploads>0;renderTabs();preview();}
}
$('#photo-input').addEventListener('change',e=>{$('#edit-dialog').scrollTop=0;uploadPhotos(e.target.files);e.target.value='';});
for(const id of ['edit-dialog','manager-dialog'])$('#'+id).addEventListener('scroll',e=>{if(e.target.scrollTop)e.target.scrollTop=0;});
$('#photo-grid').addEventListener('dragover',e=>{e.preventDefault();$('#photo-grid').classList.add('is-over');});
$('#photo-grid').addEventListener('dragleave',()=>$('#photo-grid').classList.remove('is-over'));
$('#photo-grid').addEventListener('drop',e=>{e.preventDefault();$('#photo-grid').classList.remove('is-over');uploadPhotos(e.dataTransfer?.files||[]);});
$('#photo-grid').addEventListener('click',e=>{
  const v=variants[vIndex],b=e.target.closest('button');if(!b)return;
  if(b.dataset.photoRemove!==undefined)v.photos.splice(Number(b.dataset.photoRemove),1);
  else if(b.dataset.photoCover!==undefined){const [x]=v.photos.splice(Number(b.dataset.photoCover),1);v.photos.unshift(x);}
  else if(b.dataset.photoMove!==undefined){const i=Number(b.dataset.photoMove),j=i+Number(b.dataset.dir);if(j<0||j>=v.photos.length)return;[v.photos[i],v.photos[j]]=[v.photos[j],v.photos[i]];}
  renderPhotos();renderTabs();preview();
});
form.addEventListener('submit',async event=>{
  event.preventDefault();const d=formData(),message=$('#edit-message');
  const missing=[!d.name&&'o nome',!d.category&&'a categoria',!(d.priceCents>0)&&'o preço',!d.description&&'a descrição'].filter(Boolean);
  if(missing.length){message.textContent='Falta preencher '+missing.join(', ')+'.';return;}
  const bad=d.variants.findIndex(v=>!v.color||!v.photos.length);
  if(bad>=0){loadVariant(bad);message.textContent=d.variants[bad].color?`Envie ao menos uma foto da cor ${d.variants[bad].color}.`:'Dê um nome a esta cor.';return;}
  const names=d.variants.map(v=>v.color.toLocaleLowerCase('pt-BR'));if(new Set(names).size!==names.length){message.textContent='Há duas cores com o mesmo nome.';return;}
  $('#save-product').disabled=true;message.textContent='Salvando…';
  const group=d.variants.length>1?(groupKey||newGroup()):'';
  try{
    for(const [i,v] of d.variants.entries()){
      if(d.variants.length>1)message.textContent=`Salvando cor ${i+1} de ${d.variants.length}…`;
      const payload={name:d.name,category:d.category,priceCents:d.priceCents,description:d.description,material:d.material,care:d.care,measurements:d.measurements,featured:d.featured,active:d.active,look:d.look,sizeChart:d.sizeChart,color:v.color,hex:v.hex,image:v.photos[0],secondaryImage:v.photos[1]||'',extraImages:v.photos.slice(2),stock:v.stock,colorGroup:group,version:variants[i].version||0};
      const r=await api('/api/admin/products'+(v.id?'/'+v.id:''),{method:v.id?'PUT':'POST',body:JSON.stringify(payload)});
      variants[i].id=r.product.id;variants[i].version=r.product.version;
    }
    for(const id of removedIds)await api('/api/admin/products/'+id,{method:'DELETE',body:JSON.stringify({force:true})});
    removedIds=[];snapshot=JSON.stringify(formData());$('#edit-dialog').close();await refresh(true);
    toast(`${editing?'Peça atualizada':'Peça cadastrada'+(d.variants.length>1?' com '+d.variants.length+' cores':'')}. ${d.active?'Visível na vitrine.':'Oculta da vitrine.'}`);
  }catch(error){message.textContent=error.message+' Atualize os dados e confira as cores antes de tentar de novo.';await refresh(true);}
  finally{$('#save-product').disabled=uploads>0;}
});

/* ---------- Editor: medidas e look ---------- */
function renderChart(){
  $('#chart-editor').innerHTML=`<table><thead><tr><th>Tamanho</th>${chart.columns.map((c,i)=>`<th><span class="chart-col"><input value="${escapeHTML(c)}" maxlength="20" data-col="${i}" aria-label="Nome da medida ${i+1}"><button type="button" data-remove-col="${i}" aria-label="Remover medida">×</button></span></th>`).join('')}</tr></thead><tbody>${catalog.sizes.map(s=>`<tr><th>${escapeHTML(s)}</th>${chart.columns.map((c,i)=>`<td><input value="${escapeHTML(chart.rows[s]?.[i]||'')}" maxlength="12" inputmode="decimal" data-size="${escapeHTML(s)}" data-cell="${i}" aria-label="${escapeHTML(c)} do tamanho ${escapeHTML(s)}"></td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function syncChart(){
  const cols=[...$('#chart-editor').querySelectorAll('[data-col]')].map(i=>i.value);const rows={};
  for(const input of $('#chart-editor').querySelectorAll('[data-cell]')){(rows[input.dataset.size]??=Array(cols.length).fill(''))[Number(input.dataset.cell)]=input.value;}
  chart={columns:cols,rows};
}
function readChart(){
  if(!$('#chart-editor').querySelector('table'))return null;syncChart();
  const cols=chart.columns.map(c=>c.trim()),keep=cols.map(c=>Boolean(c));if(!keep.some(Boolean))return null;
  const rows={};for(const [s,values] of Object.entries(chart.rows)){const v=values.filter((_,i)=>keep[i]).map(x=>x.trim());if(v.some(Boolean))rows[s]=v;}
  return Object.keys(rows).length?{columns:cols.filter(Boolean),rows}:null;
}
function pickerItem(x,checked,kind){return `<label class="pick${checked?' is-on':''}"><input type="checkbox" data-pick="${kind}" value="${x.id}"${checked?' checked':''}><img src="${escapeHTML(x.image)}" alt="" loading="lazy"><span><b>${escapeHTML(x.name)}</b><small><i style="background:${escapeHTML(x.hex)}"></i>${escapeHTML(x.color)} · ${money(x.priceCents)}</small></span></label>`;}
function renderPickers(){
  const own=new Set(variants.map(v=>v.id).concat(editing?.id||[])),q=$('#look-search').value.trim().toLocaleLowerCase('pt-BR');
  const others=products.filter(x=>!own.has(x.id)&&!(groupKey&&x.colorGroup===groupKey));
  $('#look-picker').innerHTML=others.filter(x=>lookSel.has(x.id)||[x.name,x.category,x.color].join(' ').toLocaleLowerCase('pt-BR').includes(q)).sort((a,b)=>Number(lookSel.has(b.id))-Number(lookSel.has(a.id))).slice(0,30).map(x=>pickerItem(x,lookSel.has(x.id),'look')).join('')||'<p class="field-note">Nenhuma peça encontrada.</p>';
}
$('#chart-editor').addEventListener('click',e=>{const b=e.target.closest('[data-remove-col]');if(!b)return;syncChart();const i=Number(b.dataset.removeCol);chart.columns.splice(i,1);for(const v of Object.values(chart.rows))v.splice(i,1);if(!chart.columns.length)chart.columns=['Medida'];renderChart();});
$('#chart-add-col').addEventListener('click',()=>{syncChart();if(chart.columns.length>=6){toast('Use até 6 medidas.');return;}chart.columns.push('');for(const v of Object.values(chart.rows))v.push('');renderChart();$('#chart-editor').querySelector(`[data-col="${chart.columns.length-1}"]`).focus();});
$('#chart-clear').addEventListener('click',()=>{chart={columns:['Busto','Cintura','Quadril'],rows:{}};renderChart();});
$('#chart-copy').addEventListener('change',e=>{const x=products.find(p=>p.id===Number(e.target.value));if(x?.sizeChart){chart={columns:[...x.sizeChart.columns],rows:Object.fromEntries(Object.entries(x.sizeChart.rows).map(([k,v])=>[k,[...v]]))};renderChart();toast('Tabela copiada de '+x.name+'.');}e.target.value='';});
$('#look-search').addEventListener('input',renderPickers);
form.addEventListener('change',e=>{const t=e.target;if(t.dataset?.pick!=='look')return;const id=Number(t.value);
  if(t.checked){if(lookSel.size>=6){t.checked=false;toast('O look aceita até 6 peças.');return;}lookSel.add(id);}else lookSel.delete(id);
  t.closest('.pick').classList.toggle('is-on',t.checked);});

/* ---------- Clientes: avise-me e lista de e-mails ---------- */
const back=a=>{const p=products.find(x=>x.id===a.productId);return Boolean(p&&p.active&&p.stock[a.size]>0);};
function alertLink(a){
  const p=products.find(x=>x.id===a.productId),url=location.origin+'/?produto='+a.productId;
  const text=`Olá! Aqui é da MAÉVI. A peça ${a.productName} (${a.color}, tamanho ${a.size}) que você pediu para avisar ${back(a)?'voltou ao estoque':'ainda está esgotada, mas lembramos de você'}: ${url}`;
  return a.type==='whatsapp'?`https://wa.me/55${a.contact}?text=${encodeURIComponent(text)}`:`mailto:${a.contact}?subject=${encodeURIComponent((back(a)?'Voltou: ':'')+a.productName+' · MAÉVI')}&body=${encodeURIComponent(text)}`;
}
function renderCustomers(){
  const pendingBack=alerts.filter(a=>a.status==='pending'&&back(a));
  $('#restock-banner').hidden=!pendingBack.length;$('#restock-title').textContent=pendingBack.length===1?'1 cliente esperando uma peça que voltou.':`${pendingBack.length} clientes esperando peças que voltaram.`;
  const only=$('#alerts-pending-only').checked,list=alerts.filter(a=>!only||a.status==='pending').sort((a,b)=>Number(back(b))-Number(back(a)));
  $('#alert-list').innerHTML=list.length?list.map(a=>{const p=products.find(x=>x.id===a.productId);return `<div class="crow${a.status==='notified'?' is-off':''}">${p?`<img src="${escapeHTML(p.image)}" alt="">`:'<span class="mbadge">—</span>'}<div class="minfo"><strong>${escapeHTML(a.productName)}</strong><small>${escapeHTML(a.color)} · tamanho ${escapeHTML(a.size)} · ${escapeHTML(a.type==='whatsapp'?a.contact.replace(/^(\d{2})(\d{4,5})(\d{4})$/,'($1) $2-$3'):a.contact)} · ${new Date(a.createdAt).toLocaleDateString('pt-BR')}</small></div>${a.status==='notified'?'<span class="badge muted">Avisada</span>':back(a)?'<span class="badge ok">Voltou ao estoque</span>':'<span class="badge warn">Esgotado</span>'}<div class="mactions"><a class="mlink" href="${escapeHTML(alertLink(a))}" target="_blank" rel="noopener">${a.type==='whatsapp'?'Avisar no WhatsApp':'Enviar e-mail'}</a>${a.status==='pending'?`<button type="button" data-alert="${a.id}" data-alert-act="notified">Marcar avisada</button>`:`<button type="button" data-alert="${a.id}" data-alert-act="pending">Reabrir</button>`}<button type="button" class="danger-link" data-alert="${a.id}" data-alert-act="delete">Excluir</button></div></div>`;}).join(''):'<p class="empty-state">Nenhum pedido de aviso por aqui.</p>';
  $('#subscriber-list').innerHTML=subscribers.length?subscribers.map(x=>`<div class="crow"><span class="mbadge">@</span><div class="minfo"><strong>${escapeHTML(x.email)}</strong><small>Cadastro em ${new Date(x.createdAt).toLocaleDateString('pt-BR')}</small></div><div class="mactions"><button type="button" class="danger-link" data-unsubscribe="${escapeHTML(x.email)}">Remover</button></div></div>`).join(''):'<p class="empty-state">Ainda não há e-mails cadastrados. Ligue o pop-up de boas-vindas em Loja.</p>';
}
$('#alerts-pending-only').addEventListener('change',renderCustomers);
$('#customers-panel').addEventListener('click',async e=>{
  const b=e.target.closest('[data-alert]');
  if(b){const act=b.dataset.alertAct;if(act==='delete'&&!await confirmBox('Excluir este aviso?','A cliente sai da lista de espera desta peça.'))return;b.disabled=true;
    try{await api('/api/admin/alerts/'+b.dataset.alert,{method:act==='delete'?'DELETE':'PATCH',body:JSON.stringify(act==='delete'?{}:{status:act})});alerts=(await api('/api/admin/alerts')).alerts;renderCustomers();}catch(error){toast(error.message);b.disabled=false;}return;}
  const u=e.target.closest('[data-unsubscribe]');
  if(u){if(!await confirmBox('Remover este e-mail?',`${u.dataset.unsubscribe} sai da lista de novidades.`,'Remover'))return;
    try{await api('/api/admin/subscribers',{method:'DELETE',body:JSON.stringify({email:u.dataset.unsubscribe})});subscribers=(await api('/api/admin/subscribers')).subscribers;renderCustomers();toast('E-mail removido.');}catch(error){toast(error.message);}}
  const link=e.target.closest('.mlink');if(link){const id=link.closest('.crow')?.querySelector('[data-alert-act="notified"]')?.dataset.alert;if(id)setTimeout(()=>toast('Depois de enviar, toque em "Marcar avisada".'),400);}
});
$('#copy-emails').addEventListener('click',async()=>{if(!subscribers.length){toast('A lista está vazia.');return;}try{await navigator.clipboard.writeText(subscribers.map(x=>x.email).join(', '));toast(`${subscribers.length} e-mail${subscribers.length===1?' copiado':'s copiados'}.`);}catch{toast('Não foi possível copiar.');}});
$('#export-emails').addEventListener('click',()=>{if(!subscribers.length){toast('A lista está vazia.');return;}const csv='email,cadastro\n'+subscribers.map(x=>`${x.email},${x.createdAt.slice(0,10)}`).join('\n');const url=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='maevi-emails.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);});

/* ---------- Categorias e tamanhos ---------- */
function row(kind,value,original){
  const count=kind==='category'&&original?products.filter(p=>p.category===original).length:null;
  return `<li data-original="${escapeHTML(original||'')}"><input value="${escapeHTML(value)}" maxlength="${kind==='category'?40:10}" aria-label="${kind==='category'?'Nome da categoria':'Tamanho'}" required>${count!==null?`<small>${count} peça${count===1?'':'s'}</small>`:''}<span class="row-actions"><button type="button" data-move="-1" aria-label="Subir">↑</button><button type="button" data-move="1" aria-label="Descer">↓</button><button type="button" data-remove aria-label="Remover">×</button></span></li>`;
}
function renderStructure(){
  $('#category-list').innerHTML=catalog.categories.map(c=>row('category',c,c)).join('');
  $('#size-list').innerHTML=catalog.sizes.map(s=>row('size',s,s)).join('');$('#structure-message').textContent='';
}
$('#structure-form').addEventListener('click',event=>{
  const add=event.target.closest('[data-add]');if(add){const list=$(add.dataset.add==='category'?'#category-list':'#size-list');list.insertAdjacentHTML('beforeend',row(add.dataset.add,'',''));list.lastElementChild.querySelector('input').focus();return;}
  const li=event.target.closest('li');if(!li)return;
  if(event.target.closest('[data-remove]')){li.remove();return;}
  const move=event.target.closest('[data-move]');if(move){if(move.dataset.move==='-1'&&li.previousElementSibling)li.previousElementSibling.before(li);else if(move.dataset.move==='1'&&li.nextElementSibling)li.nextElementSibling.after(li);}
});
$('#structure-form').addEventListener('submit',async event=>{
  event.preventDefault();const message=$('#structure-message');
  const read=id=>[...$(id).children].map(li=>({value:li.querySelector('input').value.trim(),original:li.dataset.original})).filter(x=>x.value);
  const cats=read('#category-list'),sizes=read('#size-list'),renames=list=>Object.fromEntries(list.filter(x=>x.original&&x.original!==x.value).map(x=>[x.original,x.value]));
  $('#save-structure').disabled=true;message.textContent='Salvando…';
  try{await api('/api/admin/catalog',{method:'PUT',body:JSON.stringify({version:catalog.version,categories:cats.map(x=>x.value),sizes:sizes.map(x=>x.value),renames:{categories:renames(cats),sizes:renames(sizes)}})});await refresh(true);toast('Categorias e tamanhos salvos.');}
  catch(error){message.textContent=error.message;}finally{$('#save-structure').disabled=false;}
});

/* ---------- Biblioteca de modelos reutilizáveis ---------- */
const modelForm=$('#model-library-form');
function renderModelLibrary(){
  const list=$('#model-library-list');
  list.innerHTML=modelLibrary.models.map(modelRow).join('');
  $('#model-library-message').textContent='';
}
function modelRow(m){
  const cats=catalog.categories.map(c=>`<option value="${escapeHTML(c)}"${c===m.category?' selected':''}>${escapeHTML(c)}</option>`).join('');
  const sizes=catalog.sizes.map(s=>`<label class="model-size"><input type="checkbox" data-model-size="${escapeHTML(s)}"${m.sizes.includes(s)?' checked':''}><span>${escapeHTML(s)}</span></label>`).join('');
  return `<fieldset class="model-library-item" data-model-id="${escapeHTML(m.id)}"><legend>${escapeHTML(m.name||'Novo modelo')}</legend>
    <div class="form-row"><label>Nome do modelo<input data-model-name maxlength="100" value="${escapeHTML(m.name)}" required placeholder="Ex.: Calça pantalona"></label>
    <label>Categoria<select data-model-category>${cats}</select></label>
    <label>Preço padrão (R$)<input data-model-price type="number" min="0.01" max="100000" step="0.01" value="${(m.priceCents/100).toFixed(2)}" required></label></div>
    <div class="model-sizes"><span>Tamanhos</span>${sizes}</div>
    <button type="button" class="text-link danger-link" data-delete-model>Remover modelo</button></fieldset>`;
}
$('#add-model').addEventListener('click',()=>{
  const m={id:crypto.randomUUID(),name:'',category:catalog.categories[0]||'',priceCents:0,sizes:catalog.sizes.filter(s=>['P','M','G'].includes(s))};
  if(!m.sizes.length)m.sizes=catalog.sizes.slice(0,1);
  $('#model-library-list').insertAdjacentHTML('beforeend',modelRow(m));
  $('#model-library-list').lastElementChild.querySelector('[data-model-name]').focus();
});
$('#model-library-list').addEventListener('click',e=>{const b=e.target.closest('[data-delete-model]');if(b)b.closest('[data-model-id]').remove();});
modelForm.addEventListener('submit',async e=>{
  e.preventDefault();
  const message=$('#model-library-message'),button=$('#save-models');
  const models=[...$('#model-library-list').querySelectorAll('[data-model-id]')].map(row=>({
    id:row.dataset.modelId,name:row.querySelector('[data-model-name]').value.trim(),
    category:row.querySelector('[data-model-category]').value,
    priceCents:Math.round(Number(row.querySelector('[data-model-price]').value)*100),
    sizes:[...row.querySelectorAll('[data-model-size]:checked')].map(i=>i.dataset.modelSize)
  }));
  button.disabled=true;message.textContent='Salvando biblioteca…';
  try{
    const result=await api('/api/admin/model-library',{method:'PUT',body:JSON.stringify({version:modelLibrary.version,models})});
    modelLibrary=result.library;renderModelLibrary();toast('Biblioteca de modelos salva.');
  }catch(error){message.textContent=error.message;}
  finally{button.disabled=false;}
});
/* ---------- Conta ---------- */
const accountForm=$('#account-form');
function renderAccount(){
  const needsCurrent=account.configured&&sessionMethod==='password';
  $('#current-password-field').hidden=!needsCurrent;accountForm.elements.currentPassword.required=needsCurrent;
  if(!accountForm.elements.email.value||document.activeElement!==accountForm.elements.email)accountForm.elements.email.value=account.email||'';
  $('#account-status').textContent=account.configured?`Você entra com ${account.email}. Atualizado em ${new Date(account.updatedAt).toLocaleDateString('pt-BR')}.`:'Crie o e-mail e a senha que você vai usar para entrar no painel.';
  $('#account-banner').hidden=account.configured;$('#admin-greeting').textContent=account.configured?account.email.toUpperCase():'VISÃO DA LOJA';
}
function strength(value){let score=0;if(value.length>=10)score++;if(value.length>=14)score++;if(/[a-z]/i.test(value)&&/\d/.test(value))score++;if(/[^a-z0-9]/i.test(value)||/\s|-/.test(value))score++;return score;}
accountForm.elements.password.addEventListener('input',e=>{const s=strength(e.target.value);accountForm.querySelector('.strength').dataset.level=String(s);$('#strength-note').textContent=e.target.value.length<10?'Pelo menos 10 caracteres. Uma frase curta funciona bem, como "vestido-verde-de-sabado".':['Fraca','Razoável','Boa','Forte','Muito forte'][s];});
accountForm.addEventListener('submit',async event=>{
  event.preventDefault();const f=new FormData(accountForm),message=$('#account-message');
  if(f.get('password')!==f.get('confirm')){message.textContent='As duas senhas não estão iguais.';return;}
  $('#save-account').disabled=true;message.textContent='Salvando…';
  try{const result=await api('/api/admin/account',{method:'PUT',body:JSON.stringify({email:f.get('email'),password:f.get('password'),currentPassword:f.get('currentPassword')||undefined})});account=result.account;accountForm.reset();renderAccount();message.textContent='';toast('Acesso salvo. Use este e-mail e esta senha na próxima vez.');}
  catch(error){message.textContent=error.message;}finally{$('#save-account').disabled=false;}
});

/* ---------- Login ---------- */
let keyMode=false;
$('#login-switch').addEventListener('click',()=>{keyMode=!keyMode;$('#login-form').hidden=keyMode;$('#key-form').hidden=!keyMode;$('#login-switch').textContent=keyMode?'Entrar com e-mail e senha':'Primeiro acesso ou esqueceu a senha? Entrar com a chave';$('#admin-message').textContent='';(keyMode?$('#key-form'):$('#login-form')).querySelector('input').focus();});
async function login(formElement,payload){
  const button=formElement.querySelector('.button');button.disabled=true;$('#admin-message').textContent='';
  try{await api('/api/admin/login',{method:'POST',body:JSON.stringify(payload)});formElement.reset();if(await refresh(true)){let tab='catalog';try{tab=sessionStorage.getItem('maevi-admin-tab')||tab;}catch{}showTab(!account.configured?'account':tab);toast('Bom te ver por aqui.');}}
  catch(error){$('#admin-message').textContent=error.status===401&&!keyMode&&error.message.includes('E-mail')?'E-mail ou senha incorretos. No primeiro acesso, entre com a chave e crie seu acesso.':error.message;}
  finally{button.disabled=false;}
}
$('#login-form').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.target);if(!f.get('email')||!f.get('password')){$('#admin-message').textContent='Informe e-mail e senha.';return;}login(e.target,{email:f.get('email'),password:f.get('password')});});
$('#key-form').addEventListener('submit',e=>{e.preventDefault();const key=String(new FormData(e.target).get('key')||'').trim();if(!key){$('#admin-message').textContent='Cole a chave de acesso.';return;}login(e.target,{key});});
$('#logout').addEventListener('click',async()=>{try{await api('/api/admin/logout',{method:'POST',body:'{}'});}catch{}loggedIn(false);$('#admin-message').textContent='Você saiu do painel.';});


/* ---------- Confirmação ---------- */
function confirmBox(title,text,label='Excluir'){
  const d=$('#confirm-dialog');$('#confirm-title').textContent=title;$('#confirm-text').textContent=text;$('#confirm-ok').textContent=label;d.returnValue='';d.showModal();
  return new Promise(resolve=>d.addEventListener('close',()=>resolve(d.returnValue==='ok'),{once:true}));
}

/* ---------- Gerenciamento (pop-up) ---------- */
const OPEN_ORDER=['demo_received','demo_payment_pending','demo_payment_review','demo_paid','demo_preparing','demo_ready'];
const canDeleteOrder=o=>!OPEN_ORDER.includes(o.status)&&!(o.payment?.provider&&!['demo_expired','demo_cancelled'].includes(o.status));
const blockedDelete=o=>o.payment?.provider&&(OPEN_ORDER.includes(o.status)||paidOrder(o));
const canCancelOrder=o=>nextFor(o).includes('demo_cancelled')&&!paidOrder(o)&&o.status!=='demo_payment_review';
const manager={tab:'products',selected:new Set(),coupons:[],busy:false};
const FILTERS={
  products:()=>[['','Todas as peças'],['active','Na vitrine'],['hidden','Ocultas'],['featured','Em destaque'],['soldout','Esgotadas'],['low','Estoque baixo'],...catalog.categories.map(c=>['cat:'+c,c])],
  orders:()=>[['','Todos os pedidos'],['open','Em andamento'],['done','Finalizados (podem ser excluídos)'],...Object.keys(labels).map(k=>['status:'+k,label(k)])],
  coupons:()=>[['','Todos os cupons'],['active','Ativos'],['inactive','Inativos'],['expired','Expirados']]
};
const couponExpired=c=>c.expiresAt&&Date.parse(c.expiresAt)<=Date.now();
function managerItems(){
  const q=$('#manager-search').value.trim().toLocaleLowerCase('pt-BR'),f=$('#manager-filter').value,has=t=>t.toLocaleLowerCase('pt-BR').includes(q);
  if(manager.tab==='products')return products.filter(p=>has([p.name,p.category,p.color].join(' '))&&(!f||(f==='active'&&p.active)||(f==='hidden'&&!p.active)||(f==='featured'&&p.featured)||(f==='soldout'&&sum(p.stock)===0)||(f==='low'&&Object.values(p.stock).some(n=>n<=2))||(f.startsWith('cat:')&&p.category===f.slice(4))));
  if(manager.tab==='orders')return orders.filter(o=>has([o.id,o.customer.name,o.customer.email].join(' '))&&(!f||(f==='open'&&OPEN_ORDER.includes(o.status))||(f==='done'&&canDeleteOrder(o))||(f.startsWith('status:')&&o.status===f.slice(7))));
  return manager.coupons.filter(c=>has(c.code)&&(!f||(f==='active'&&c.active&&!couponExpired(c))||(f==='inactive'&&!c.active)||(f==='expired'&&couponExpired(c))));
}
const keyOf=item=>String(manager.tab==='products'?item.id:manager.tab==='orders'?item.id:item.code);
const sw=(action,key,on,label)=>`<label class="mini-switch" title="${label}"><input type="checkbox" data-mact="${action}" data-key="${escapeHTML(key)}"${on?' checked':''}><span></span><em>${label}</em></label>`;
function renderManager(){
  const d=$('#manager-dialog');if(!d.open)return;
  $('#manager-title').textContent={products:'Vitrine',orders:'Pedidos',coupons:'Cupons'}[manager.tab];
  document.querySelectorAll('[data-mtab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.mtab===manager.tab)));
  $('#mcount-products').textContent=products.length;$('#mcount-orders').textContent=orders.length;$('#mcount-coupons').textContent=manager.coupons.length;
  const filter=$('#manager-filter'),chosen=filter.value,options=FILTERS[manager.tab]();
  filter.innerHTML=options.map(([v,l])=>`<option value="${escapeHTML(v)}"${v===chosen?' selected':''}>${escapeHTML(l)}</option>`).join('');
  const items=managerItems(),keys=new Set(items.map(keyOf));for(const k of manager.selected)if(!keys.has(k))manager.selected.delete(k);
  let html='';
  if(manager.tab==='products')html=items.map(p=>{const k=keyOf(p),total=sum(p.stock);return `<div class="mrow${p.active?'':' is-off'}" role="listitem"><input type="checkbox" class="mcheck" data-key="${k}" aria-label="Selecionar ${escapeHTML(p.name)}"${manager.selected.has(k)?' checked':''}><img src="${escapeHTML(p.image)}" alt="" loading="lazy"><div class="minfo"><strong>${escapeHTML(p.name)}</strong><small>${escapeHTML(p.category)} · ${escapeHTML(p.color)} · ${money(p.priceCents)} · ${total} em estoque${total===0?' · esgotada':''}</small></div><div class="mtoggles">${sw('active',k,p.active,'Vitrine')}${sw('featured',k,p.featured,'Destaque')}</div><div class="mactions"><button type="button" data-mact="edit" data-key="${k}">Editar</button><button type="button" class="danger-link" data-mact="delete" data-key="${k}">Excluir</button></div></div>`;}).join('');
  else if(manager.tab==='orders')html=items.map(o=>{const k=keyOf(o),del=canDeleteOrder(o);return `<div class="mrow" role="listitem"><input type="checkbox" class="mcheck" data-key="${k}" aria-label="Selecionar ${escapeHTML(o.id)}"${manager.selected.has(k)?' checked':''}><span class="mbadge">${o.items.reduce((a,i)=>a+i.quantity,0)}</span><div class="minfo"><strong>${escapeHTML(o.id)}</strong><small>${escapeHTML(o.customer.name)} · ${new Date(o.createdAt).toLocaleDateString('pt-BR')} · ${money(o.totalCents)}</small></div><span class="status-pill">${escapeHTML(label(o.status))}</span><div class="mactions">${nextFor(o).filter(s=>s!=='demo_cancelled'&&o.status!=='demo_payment_review').map(s=>`<button type="button" data-mact="status" data-status="${s}" data-key="${k}">${escapeHTML(label(s))}</button>`).join('')}${canCancelOrder(o)?`<button type="button" data-mact="cancel" data-key="${k}">Cancelar</button>`:''}<button type="button" class="danger-link" data-mact="delete" data-key="${k}"${blockedDelete(o)?' disabled title="Pedido com pagamento pelo Mercado Pago fica no histórico. Use a aba Pedidos para cancelar e estornar."':del?'':' title="Será cancelado e excluído"'}>Excluir</button></div></div>`;}).join('');
  else html=items.map(c=>{const k=keyOf(c);return `<div class="mrow${c.active?'':' is-off'}" role="listitem"><input type="checkbox" class="mcheck" data-key="${escapeHTML(k)}" aria-label="Selecionar ${escapeHTML(c.code)}"${manager.selected.has(k)?' checked':''}><span class="mbadge">${c.percent}%</span><div class="minfo"><strong>${escapeHTML(c.code)}</strong><small>Mínimo ${money(c.minCents)} · ${c.used}/${c.maxUses} usos${c.expiresAt?' · até '+new Date(c.expiresAt).toLocaleDateString('pt-BR'):''}${couponExpired(c)?' · expirado':''}</small></div><div class="mtoggles">${sw('active',k,c.active,'Ativo')}</div><div class="mactions"><button type="button" data-mact="edit" data-key="${escapeHTML(k)}">Editar</button><button type="button" class="danger-link" data-mact="delete" data-key="${escapeHTML(k)}">Excluir</button></div></div>`;}).join('');
  $('#manager-list').innerHTML=html||`<p class="empty-state">Nada por aqui${$('#manager-search').value||filter.value?' com esses filtros':''}.</p>`;
  const all=$('#manager-all');all.checked=items.length>0&&items.every(i=>manager.selected.has(keyOf(i)));all.indeterminate=!all.checked&&manager.selected.size>0;
  const n=manager.selected.size;$('#manager-bulk').hidden=n===0;$('#manager-selected').textContent=`${n} selecionad${n===1?'a':'as'}`;
  const bulk={products:[['show','Mostrar na vitrine'],['hide','Ocultar'],['feature','Destacar'],['unfeature','Tirar destaque'],['delete','Excluir']],orders:[['cancel','Cancelar'],['delete','Excluir']],coupons:[['enable','Ativar'],['disable','Desativar'],['delete','Excluir']]}[manager.tab];
  $('#manager-bulk-actions').innerHTML=bulk.map(([a,l])=>`<button type="button" class="button small${a==='delete'?' danger':' outline'}" data-bulk="${a}"${manager.busy?' disabled':''}>${l}</button>`).join('');
}
async function loadCoupons(){try{manager.coupons=(await api('/api/admin/coupons')).coupons;}catch{manager.coupons=[];}}
async function openManager(tab='products'){manager.tab=tab;manager.selected.clear();$('#manager-search').value='';$('#manager-filter').innerHTML='';await loadCoupons();$('#manager-dialog').showModal();renderManager();}
const find=key=>manager.tab==='products'?products.find(p=>String(p.id)===key):manager.tab==='orders'?orders.find(o=>o.id===key):manager.coupons.find(c=>c.code===key);
const couponInput=(c,changes)=>({code:c.code,percent:c.percent,minCents:c.minCents,maxUses:c.maxUses,active:c.active,firstPurchase:Boolean(c.firstPurchase),expiresAt:c.expiresAt||'',version:c.version,...changes});
async function act(action,item){
  if(manager.tab==='products'){
    if(action==='delete')return api('/api/admin/products/'+item.id,{method:'DELETE',body:JSON.stringify({force:true})});
    const change={show:{active:true},hide:{active:false},feature:{featured:true},unfeature:{featured:false}}[action];
    return api('/api/admin/products/'+item.id,{method:'PUT',body:JSON.stringify({...item,...change,version:item.version||0})});
  }
  if(manager.tab==='orders'){
    if(action==='delete')return api('/api/admin/orders/'+item.id,{method:'DELETE',body:JSON.stringify({force:true})});
    return api('/api/admin/orders/'+item.id,{method:'PATCH',body:JSON.stringify({status:action==='cancel'?'demo_cancelled':action})});
  }
  if(action==='delete')return api('/api/admin/coupons/'+encodeURIComponent(item.code),{method:'DELETE',body:'{}'});
  return api('/api/admin/coupons',{method:'POST',body:JSON.stringify(couponInput(item,{active:action==='enable'}))});
}
async function afterChange(){await refresh(true);await loadCoupons();document.dispatchEvent(new Event('maevi:coupons-changed'));renderManager();}
const nouns={products:['peça','peças'],orders:['pedido','pedidos'],coupons:['cupom','cupons']};
async function runBulk(action,list){
  if(action==='delete'){
    const [one,many]=nouns[manager.tab];
    const inOrders=manager.tab==='products'?list.filter(p=>orders.some(o=>OPEN_ORDER.includes(o.status)&&o.items.some(i=>i.id===p.id))).length:0,open=manager.tab==='orders'?list.filter(o=>!canDeleteOrder(o)).length:0;
    const extra={products:' As fotos enviadas também serão apagadas.'+(inOrders?` ${inOrders===list.length?(list.length===1?'Ela está':'Elas estão'):inOrders+' delas estão'} em pedido em andamento: o pedido continua registrado com o nome e o preço.`:' Pedidos antigos continuam registrados.'),orders:open?` ${open===list.length?(list.length===1?'Ele ainda está':'Eles ainda estão'):open+' deles ainda estão'} em andamento: ${open===1?'será cancelado':'serão cancelados'} antes (as peças voltam ao estoque).`:'',coupons:' Pedidos que já usaram o cupom continuam registrados.'}[manager.tab];
    if(!await confirmBox(`Excluir ${list.length===1?'1 '+one:list.length+' '+many}?`,`Esta ação não pode ser desfeita.${extra}`))return;
  }
  if(action==='cancel'&&!await confirmBox(`Cancelar ${list.length===1?'1 pedido':list.length+' pedidos'}?`,'As peças voltam para o estoque.','Cancelar pedidos'))return;
  manager.busy=true;renderManager();let ok=0;const errors=[];
  for(const item of list){
    if(manager.tab==='orders'&&action==='cancel'&&!canCancelOrder(item)){errors.push(item.id+(paidOrder(item)?': pago, use Cancelar e estornar na aba Pedidos':': não pode ser cancelado por aqui'));continue;}
    if(manager.tab==='orders'&&action==='delete'&&blockedDelete(item)){errors.push(item.id+': pedido com pagamento fica no histórico');continue;}
    try{await act(action,item);ok++;}catch(error){errors.push(list.length===1?error.message:(item.name||item.id||item.code)+': '+error.message);}
  }
  manager.busy=false;manager.selected.clear();await afterChange();
  const done={delete:'excluíd',hide:'ocultad',show:'visíve',feature:'destacad',unfeature:'sem destaque',cancel:'cancelad',enable:'ativad',disable:'desativad'}[action]||'atualizad';
  if(list.length===1){toast(errors[0]||`${nouns[manager.tab][0][0].toUpperCase()+nouns[manager.tab][0].slice(1)} ${done==='visíve'?'visível na vitrine':done==='sem destaque'?'sem destaque':done+(manager.tab==='products'?'a':'o')}.`);return;}
  toast(errors.length?`${ok} concluído${ok===1?'':'s'}. ${errors.length} não ${errors.length===1?'foi':'foram'}: ${errors[0]}${errors.length>1?' …':''}`:`Pronto: ${ok} ${ok===1?'item atualizado':'itens atualizados'}.`);
}
document.addEventListener('click',event=>{const b=event.target.closest('[data-manage]');if(b)openManager(b.dataset.manage);});
$('#manager-dialog').addEventListener('click',async event=>{
  if(event.target.closest('[data-close-manager]')){$('#manager-dialog').close();return;}
  const tab=event.target.closest('[data-mtab]');if(tab){manager.tab=tab.dataset.mtab;manager.selected.clear();$('#manager-search').value='';$('#manager-filter').innerHTML='';renderManager();return;}
  const bulk=event.target.closest('[data-bulk]');if(bulk){const list=[...manager.selected].map(find).filter(Boolean);if(list.length)runBulk(bulk.dataset.bulk,list);return;}
  const b=event.target.closest('button[data-mact]');if(!b||manager.busy)return;
  const item=find(b.dataset.key);if(!item)return;
  if(b.dataset.mact==='edit'){
    if(manager.tab==='products')openEditor(item);
    else{$('#manager-dialog').close();showTab('coupons');document.querySelector(`[data-coupon="${CSS.escape(item.code)}"]`)?.click();}
    return;
  }
  if(b.dataset.mact==='status'){b.disabled=true;try{await act(b.dataset.status,item);await afterChange();toast('Situação atualizada.');}catch(error){toast(error.message);b.disabled=false;}return;}
  runBulk(b.dataset.mact,[item]);
});
$('#manager-dialog').addEventListener('change',async event=>{
  const t=event.target;
  if(t.id==='manager-all'){for(const i of managerItems())t.checked?manager.selected.add(keyOf(i)):manager.selected.delete(keyOf(i));renderManager();return;}
  if(t.classList.contains('mcheck')){t.checked?manager.selected.add(t.dataset.key):manager.selected.delete(t.dataset.key);renderManager();return;}
  if(t.id==='manager-filter'){renderManager();return;}
  if(t.dataset.mact==='active'||t.dataset.mact==='featured'){
    const item=find(t.dataset.key);if(!item)return;t.disabled=true;
    const action=manager.tab==='coupons'?(t.checked?'enable':'disable'):t.dataset.mact==='active'?(t.checked?'show':'hide'):(t.checked?'feature':'unfeature');
    try{await act(action,item);await afterChange();}catch(error){toast(error.message);t.checked=!t.checked;t.disabled=false;}
  }
});
$('#manager-search').addEventListener('input',renderManager);
document.addEventListener('maevi:admin-ready',renderManager);
$('#delete-product').addEventListener('click',async()=>{
  if(!editing)return;const ids=variants.map(v=>v.id).filter(Boolean).concat(removedIds),busy=orders.some(o=>OPEN_ORDER.includes(o.status)&&o.items.some(i=>ids.includes(i.id)));
  if(!await confirmBox(`Excluir ${editing.name}${ids.length>1?` e as ${ids.length} cores`:''}?`,'A peça sai da vitrine e do painel, com as fotos. Esta ação não pode ser desfeita.'+(busy?' Ela está em pedido em andamento: o pedido continua registrado com o nome e o preço.':'')))return;
  try{for(const id of ids)await api('/api/admin/products/'+id,{method:'DELETE',body:JSON.stringify({force:true})});snapshot=JSON.stringify(formData());$('#edit-dialog').close();await refresh(true);renderManager();toast('Peça excluída.');}
  catch(error){$('#edit-message').textContent=error.message;await refresh(true);}
});
window.MaeviAdmin=Object.freeze({api,money,escapeHTML,refresh,toast});
(async()=>{if(await refresh(true)){let tab='catalog';try{tab=sessionStorage.getItem('maevi-admin-tab')||tab;}catch{}showTab(tab);}else loggedIn(false);})();
