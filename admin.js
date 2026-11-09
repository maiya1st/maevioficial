const $=s=>document.querySelector(s);
const escapeHTML=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=c=>(c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const labels={demo_received:'Teste recebido',demo_preparing:'Em preparação (teste)',demo_ready:'Pronto para recebimento (teste)',demo_completed:'Teste concluído',demo_cancelled:'Teste cancelado',demo_expired:'Reserva expirada'};
Object.assign(labels,{demo_payment_pending:'Checkout de teste iniciado',demo_payment_review:'Pagamento em conferência (teste)',demo_paid:'Pagamento aprovado (teste)'});
const next={demo_payment_pending:[],demo_payment_review:[],demo_paid:['demo_preparing'],demo_received:['demo_preparing','demo_cancelled'],demo_preparing:['demo_ready','demo_cancelled'],demo_ready:['demo_completed','demo_cancelled'],demo_completed:[],demo_cancelled:[],demo_expired:[]};
const TITLES={catalog:'Peças',orders:'Pedidos',structure:'Categorias e tamanhos',settings:'Loja',coupons:'Cupons',account:'Minha conta'};
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
let products=[],orders=[],activity=[],catalog={categories:[],sizes:[],version:0},account={configured:false,email:''},sessionMethod='',authEpoch=0,toastTimer;
const sum=stock=>Object.values(stock||{}).reduce((a,b)=>a+b,0);

function toast(message){const t=$('#admin-toast');t.textContent=message;t.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('visible'),3800);}
function loggedIn(value){
  $('#login-section').hidden=value;$('#dashboard').hidden=!value;document.body.classList.toggle('is-authenticated',value);
  if(!value){authEpoch++;products=[];orders=[];activity=[];$('#admin-products').innerHTML='';$('#admin-orders').innerHTML='';$('#admin-activity').innerHTML='';$('#stats').innerHTML='';$('#product-form').reset();if($('#edit-dialog').open)$('#edit-dialog').close();document.dispatchEvent(new Event('maevi:admin-logout'));}
}
async function api(url,options={}){
  let response;try{response=await fetch(url,{signal:AbortSignal.timeout(20000),...options,headers:{'Content-Type':'application/json','X-Maevi-Request':'1',...options.headers}});}catch{throw new Error('Não foi possível falar com a loja. Confira a conexão e tente de novo.');}
  let result={};try{result=await response.json();}catch{}
  if(!response.ok){if(response.status===401&&!url.endsWith('/login')&&!url.endsWith('/account'))loggedIn(false);const error=new Error(result.error||'Não foi possível concluir.');error.status=response.status;throw error;}return result;
}
async function refresh(silent=false){
  $('#refresh').disabled=true;const epoch=authEpoch;
  try{
    const [list,purchases,events,structure,me]=await Promise.all([api('/api/admin/products'),api('/api/admin/orders'),api('/api/admin/activity'),api('/api/admin/catalog'),api('/api/admin/account')]);
    if(epoch!==authEpoch)return false;
    products=list.products;orders=purchases.orders;activity=events.activity;catalog=structure.catalog;account=me.account;sessionMethod=me.session.method;
    loggedIn(true);render();renderStructure();renderAccount();document.dispatchEvent(new Event('maevi:admin-ready'));
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
  $('#admin-products').innerHTML=list.length?list.map(p=>{
    const total=sum(p.stock),badges=[!p.active&&'<span class="badge muted">Oculta</span>',p.featured&&'<span class="badge">Destaque</span>',total===0?'<span class="badge alert">Esgotada</span>':Object.values(p.stock).some(n=>n<=2)&&'<span class="badge warn">Estoque baixo</span>'].filter(Boolean).join('');
    return `<article class="admin-card${p.active?'':' is-hidden'}"><button type="button" class="admin-card-photo" data-edit="${p.id}" aria-label="Editar ${escapeHTML(p.name)}"><img src="${escapeHTML(p.image)}" alt="" loading="lazy"><span class="badges">${badges}</span></button><div class="admin-card-body"><p class="admin-card-cat">${escapeHTML(p.category)} · ${escapeHTML(p.color)}</p><h3>${escapeHTML(p.name)}</h3><p class="admin-card-price">${money(p.priceCents)}</p><ul class="stock-chips" aria-label="Estoque por tamanho">${catalog.sizes.map(s=>`<li class="${!(p.stock[s]>0)?'zero':p.stock[s]<=2?'low':''}"><b>${escapeHTML(s)}</b>${p.stock[s]??0}</li>`).join('')}</ul><div class="admin-card-actions"><button type="button" class="button small" data-edit="${p.id}">Editar</button><button type="button" class="text-link" data-toggle="${p.id}">${p.active?'Ocultar da vitrine':'Mostrar na vitrine'}</button></div></div></article>`;
  }).join(''):`<div class="empty-state"><p>${products.length?'Nenhuma peça com esses filtros.':'Nenhuma peça cadastrada ainda.'}</p><button type="button" class="button" id="empty-new">+ Cadastrar peça</button></div>`;
  const oq=$('#admin-order-search').value.trim().toLocaleLowerCase('pt-BR'),status=$('#admin-order-status').value;
  const visibleOrders=orders.filter(o=>(!status||status===o.status)&&[o.id,o.customer.name,o.customer.email].join(' ').toLocaleLowerCase('pt-BR').includes(oq));
  $('#admin-orders').innerHTML=visibleOrders.length?visibleOrders.map(o=>`<article class="admin-order"><div class="admin-order-head"><div><h3>${escapeHTML(o.id)}</h3><p>${new Date(o.createdAt).toLocaleString('pt-BR')}</p></div><span class="status-pill">${escapeHTML(labels[o.status]||o.status)}</span></div><p>${escapeHTML(o.customer.name)} · ${escapeHTML(o.customer.email)}${o.customer.phone?" · "+escapeHTML(o.customer.phone):""}</p>${o.address?`<p class="order-address">${escapeHTML(o.address.street)}, ${escapeHTML(o.address.number)} ${escapeHTML(o.address.complement)} · ${escapeHTML(o.address.district)} · ${escapeHTML(o.address.city)} / ${escapeHTML(o.address.state)} · CEP ${escapeHTML(o.address.cep)}</p>`:""}<div class="order-lines">${o.items.map(i=>`<div><span>${escapeHTML(i.name)} / ${escapeHTML(i.color)} · ${escapeHTML(i.size)} × ${i.quantity}</span><strong>${money(i.lineCents)}</strong></div>`).join('')}<div><span>Total de teste · ${o.shipping?.method==="delivery"?"entrega":"retirada"}</span><strong>${money(o.totalCents)}</strong></div></div>${o.discountCents?`<p>Cupom ${escapeHTML(o.coupon.code)} · desconto ${money(o.discountCents)}</p>`:""}<p>Entrega: ${money(o.shippingCents||0)} · ${o.payment?.provider?escapeHTML(o.payment.status)+' (Mercado Pago teste)':'pagamento não solicitado'}</p><p class="history-note">${(o.history||[{status:o.status,at:o.createdAt}]).map(h=>`${escapeHTML(labels[h.status]||h.status)} · ${escapeHTML(new Date(h.at).toLocaleString('pt-BR'))}`).join(' → ')}</p><div class="admin-order-actions">${(next[o.status]||[]).filter(s=>!(o.payment?.provider&&s==='demo_cancelled')).map(s=>`<button data-order="${o.id}" data-status="${s}" class="${s==='demo_cancelled'?'cancel-order':''}">${s==='demo_cancelled'?'Cancelar teste e devolver estoque':labels[s]}</button>`).join('')}</div></article>`).join(''):'<p class="empty-state">Nenhum pedido encontrado. Crie um teste na vitrine ou ajuste os filtros.</p>';
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
  const p=products.find(x=>x.id===Number(toggle.dataset.toggle));toggle.disabled=true;
  try{await api('/api/admin/products/'+p.id,{method:'PUT',body:JSON.stringify({...p,active:!p.active,version:p.version||0})});await refresh(true);toast(p.active?'Peça ocultada da vitrine.':'Peça visível na vitrine.');}
  catch(error){toast(error.message);toggle.disabled=false;}
});
$('#admin-orders').addEventListener('click',async event=>{
  const button=event.target.closest('[data-order]');if(!button)return;
  if(button.dataset.status==='demo_cancelled'&&!confirm('Cancelar este teste e devolver as peças ao estoque?'))return;
  button.disabled=true;
  try{await api('/api/admin/orders/'+button.dataset.order,{method:'PATCH',body:JSON.stringify({status:button.dataset.status})});await refresh(true);toast('Situação do pedido atualizada.');}catch(error){toast(error.message);button.disabled=false;}
});

/* ---------- Editor de peça ---------- */
const form=$('#product-form');let editing=null,snapshot='',uploads=0;
function stockInputs(stock){
  $('#stock-grid').innerHTML=catalog.sizes.map(s=>`<div class="stepper"><span>${escapeHTML(s)}</span><button type="button" data-step="-1" aria-label="Diminuir ${escapeHTML(s)}">−</button><input type="number" inputmode="numeric" min="0" max="10000" value="${Number(stock?.[s])||0}" data-size="${escapeHTML(s)}" aria-label="Estoque do tamanho ${escapeHTML(s)}"><button type="button" data-step="1" aria-label="Aumentar ${escapeHTML(s)}">+</button></div>`).join('');
}
function readStock(){return Object.fromEntries([...$('#stock-grid').querySelectorAll('input[data-size]')].map(i=>[i.dataset.size,Math.max(0,Math.min(10000,Math.trunc(Number(i.value))||0))]));}
function setPhoto(slot,value){
  const box=form.querySelector(`[data-slot="${slot}"]`),img=box.querySelector('img');form.elements[slot].value=value||'';
  img.hidden=!value;if(value)img.src=value;else img.removeAttribute('src');box.querySelector('.photo-empty').hidden=Boolean(value);box.querySelector('.photo-remove').hidden=!value;box.classList.toggle('has-photo',Boolean(value));
}
function formData(){
  const f=new FormData(form);
  return {name:f.get('name').trim(),category:f.get('category'),priceCents:Math.round(Number(String(f.get('price')).replace(',','.'))*100),color:f.get('color').trim(),hex:f.get('hex'),description:f.get('description').trim(),image:f.get('image').trim(),secondaryImage:f.get('secondaryImage').trim(),material:f.get('material'),care:f.get('care'),measurements:f.get('measurements'),featured:f.get('featured')==='on',active:f.get('active')==='on',stock:readStock(),version:Number(f.get('version'))||0};
}
function preview(){
  const d=formData(),total=sum(d.stock);$('#hex-label').textContent=d.hex;$('#stock-total').textContent=`${total} unidade${total===1?'':'s'} no total`;
  $('#product-preview').innerHTML=`<article class="preview-card"><div class="preview-photo">${d.image?`<img src="${escapeHTML(d.image)}" alt="">`:'<span>Sua foto aparece aqui</span>'}${total===0?'<span class="tag">ESGOTADO</span>':d.featured?'<span class="tag">CURADORIA MAÉVI</span>':''}</div><p class="preview-cat">${escapeHTML(d.category||'Categoria')}</p><h3>${escapeHTML(d.name||'Nome da peça')}</h3><p class="preview-price">${d.priceCents>0?money(d.priceCents):'R$ 0,00'}</p><p class="preview-color"><i style="background:${escapeHTML(/^#[0-9a-f]{6}$/i.test(d.hex)?d.hex:'#303521')}"></i>${escapeHTML(d.color||'Cor')}</p><p class="preview-sizes">${catalog.sizes.map(s=>`<span class="${d.stock[s]>0?'':'off'}">${escapeHTML(s)}</span>`).join('')}</p>${d.active?'':'<p class="preview-hidden">Oculta: não aparece para as clientes</p>'}</article>`;
}
function openEditor(p){
  editing=p||null;form.reset();$('#edit-message').textContent='';$('#edit-title').textContent=p?'Editar peça':'Nova peça';$('#delete-product').hidden=!p;
  $('#product-category').innerHTML=catalog.categories.map(c=>`<option>${escapeHTML(c)}</option>`).join('');
  const v=p?{...p,price:(p.priceCents/100).toFixed(2)}:{id:'',version:'',hex:'#303521',category:catalog.categories[0]||''};
  for(const name of ['id','version','name','category','price','color','hex','description','material','care','measurements']){const input=form.elements.namedItem(name);if(input&&v[name]!==undefined)input.value=v[name];}
  form.elements.active.checked=p?p.active:true;form.elements.featured.checked=Boolean(p?.featured);
  setPhoto('image',p?.image||'');setPhoto('secondaryImage',p?.secondaryImage||'');stockInputs(p?.stock);
  form.querySelectorAll('.photo-slot .field-note').forEach((n,i)=>n.textContent=i?'Aparece ao passar o mouse e na galeria':'JPG, PNG ou WebP · até 4 MB · de preferência em pé (3:4)');
  preview();snapshot=JSON.stringify(formData());$('#edit-dialog').showModal();form.elements.name.focus();
}
function closeEditor(){if(JSON.stringify(formData())!==snapshot&&!confirm('Sair sem salvar as alterações desta peça?'))return;$('#edit-dialog').close();}
$('#new-product').addEventListener('click',()=>openEditor(null));
$('#close-edit').addEventListener('click',closeEditor);$('#cancel-edit').addEventListener('click',closeEditor);
$('#edit-dialog').addEventListener('cancel',event=>{event.preventDefault();closeEditor();});
form.addEventListener('input',event=>{if(event.target.name==='image'||event.target.name==='secondaryImage')setPhoto(event.target.name,event.target.value.trim());preview();});
form.addEventListener('change',preview);
$('#stock-grid').addEventListener('click',event=>{const b=event.target.closest('[data-step]');if(!b)return;const input=b.parentElement.querySelector('input');input.value=Math.max(0,Math.min(10000,(Number(input.value)||0)+Number(b.dataset.step)));preview();});
async function upload(slot,file){
  const box=form.querySelector(`[data-slot="${slot}"]`),note=box.querySelector('.field-note');
  if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>4194304){note.textContent='Escolha uma foto JPG, PNG ou WebP de até 4 MB.';return;}
  uploads++;$('#save-product').disabled=true;box.classList.add('is-uploading');note.textContent='Enviando a foto…';
  try{const result=await api('/api/admin/images',{method:'POST',headers:{'Content-Type':file.type},body:file});setPhoto(slot,result.image);preview();note.textContent=`Foto enviada · ${result.width} × ${result.height}${result.height<result.width?' · dica: fotos em pé ficam melhores na vitrine':''}`;}
  catch(error){note.textContent=error.message;}
  finally{uploads--;box.classList.remove('is-uploading');$('#save-product').disabled=uploads>0;}
}
form.querySelectorAll('.photo-slot').forEach(box=>{
  const slot=box.dataset.slot,input=box.querySelector('input[type=file]'),drop=box.querySelector('.photo-drop');
  input.addEventListener('change',()=>{upload(slot,input.files?.[0]);input.value='';});
  ['dragenter','dragover'].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault();box.classList.add('is-over');}));
  ['dragleave','drop'].forEach(type=>drop.addEventListener(type,()=>box.classList.remove('is-over')));
  drop.addEventListener('drop',e=>{e.preventDefault();upload(slot,e.dataTransfer?.files?.[0]);});
  box.querySelector('.photo-remove').addEventListener('click',()=>{if(slot==='image')input.click();else{setPhoto(slot,'');preview();}});
});
form.addEventListener('submit',async event=>{
  event.preventDefault();const data=formData(),message=$('#edit-message');
  const missing=[!data.image&&'a foto principal',!data.name&&'o nome',!data.category&&'a categoria',!(data.priceCents>0)&&'o preço',!data.color&&'a cor',!data.description&&'a descrição'].filter(Boolean);
  if(missing.length){message.textContent='Falta preencher '+missing.join(', ')+'.';return;}
  $('#save-product').disabled=true;message.textContent='Salvando…';
  try{await api('/api/admin/products'+(editing?'/'+editing.id:''),{method:editing?'PUT':'POST',body:JSON.stringify(data)});snapshot=JSON.stringify(formData());$('#edit-dialog').close();await refresh(true);toast(editing?'Peça atualizada. Já está na vitrine.':'Peça cadastrada. Já está na vitrine.');}
  catch(error){message.textContent=error.message;}finally{$('#save-product').disabled=uploads>0;}
});

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
const canCancelOrder=o=>(next[o.status]||[]).includes('demo_cancelled')&&!o.payment?.provider;
const manager={tab:'products',selected:new Set(),coupons:[],busy:false};
const FILTERS={
  products:()=>[['','Todas as peças'],['active','Na vitrine'],['hidden','Ocultas'],['featured','Em destaque'],['soldout','Esgotadas'],['low','Estoque baixo'],...catalog.categories.map(c=>['cat:'+c,c])],
  orders:()=>[['','Todos os pedidos'],['open','Em andamento'],['done','Finalizados (podem ser excluídos)'],...Object.entries(labels).map(([k,v])=>['status:'+k,v])],
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
  else if(manager.tab==='orders')html=items.map(o=>{const k=keyOf(o),del=canDeleteOrder(o);return `<div class="mrow" role="listitem"><input type="checkbox" class="mcheck" data-key="${k}" aria-label="Selecionar ${escapeHTML(o.id)}"${manager.selected.has(k)?' checked':''}><span class="mbadge">${o.items.reduce((a,i)=>a+i.quantity,0)}</span><div class="minfo"><strong>${escapeHTML(o.id)}</strong><small>${escapeHTML(o.customer.name)} · ${new Date(o.createdAt).toLocaleDateString('pt-BR')} · ${money(o.totalCents)}</small></div><span class="status-pill">${escapeHTML(labels[o.status]||o.status)}</span><div class="mactions">${(next[o.status]||[]).filter(s=>s!=='demo_cancelled').map(s=>`<button type="button" data-mact="status" data-status="${s}" data-key="${k}">${escapeHTML(labels[s])}</button>`).join('')}${canCancelOrder(o)?`<button type="button" data-mact="cancel" data-key="${k}">Cancelar</button>`:''}<button type="button" class="danger-link" data-mact="delete" data-key="${k}"${del?'':' disabled title="Cancele ou conclua o pedido antes de excluir"'}>Excluir</button></div></div>`;}).join('');
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
const couponInput=(c,changes)=>({code:c.code,percent:c.percent,minCents:c.minCents,maxUses:c.maxUses,active:c.active,expiresAt:c.expiresAt||'',version:c.version,...changes});
async function act(action,item){
  if(manager.tab==='products'){
    if(action==='delete')return api('/api/admin/products/'+item.id,{method:'DELETE',body:'{}'});
    const change={show:{active:true},hide:{active:false},feature:{featured:true},unfeature:{featured:false}}[action];
    return api('/api/admin/products/'+item.id,{method:'PUT',body:JSON.stringify({...item,...change,version:item.version||0})});
  }
  if(manager.tab==='orders'){
    if(action==='delete')return api('/api/admin/orders/'+item.id,{method:'DELETE',body:'{}'});
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
    const extra={products:' As fotos enviadas para elas também serão apagadas. Pedidos antigos continuam registrados.',orders:' Só pedidos finalizados ou cancelados podem ser excluídos.',coupons:' Pedidos que já usaram o cupom continuam registrados.'}[manager.tab];
    if(!await confirmBox(`Excluir ${list.length===1?'1 '+one:list.length+' '+many}?`,`Esta ação não pode ser desfeita.${extra}`))return;
  }
  if(action==='cancel'&&!await confirmBox(`Cancelar ${list.length===1?'1 pedido':list.length+' pedidos'}?`,'As peças voltam para o estoque.','Cancelar pedidos'))return;
  manager.busy=true;renderManager();let ok=0;const errors=[];
  for(const item of list){
    if(manager.tab==='orders'&&action==='delete'&&!canDeleteOrder(item)){errors.push(item.id+': ainda em andamento');continue;}
    if(manager.tab==='orders'&&action==='cancel'&&!canCancelOrder(item)){errors.push(item.id+': não pode ser cancelado');continue;}
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
  if(!editing)return;if(!await confirmBox(`Excluir ${editing.name}?`,'A peça sai da vitrine e do painel. Esta ação não pode ser desfeita.'))return;
  try{await api('/api/admin/products/'+editing.id,{method:'DELETE',body:'{}'});snapshot=JSON.stringify(formData());$('#edit-dialog').close();await refresh(true);renderManager();toast('Peça excluída.');}
  catch(error){$('#edit-message').textContent=error.message;}
});
window.MaeviAdmin=Object.freeze({api,money,escapeHTML,refresh,toast});
(async()=>{if(await refresh(true)){let tab='catalog';try{tab=sessionStorage.getItem('maevi-admin-tab')||tab;}catch{}showTab(tab);}else loggedIn(false);})();
