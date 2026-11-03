const $=s=>document.querySelector(s);
const escapeHTML=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=c=>(c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const labels={demo_received:'Teste recebido',demo_preparing:'Em preparação (teste)',demo_ready:'Pronto para recebimento (teste)',demo_completed:'Teste concluído',demo_cancelled:'Teste cancelado',demo_expired:'Reserva expirada'};
Object.assign(labels,{demo_payment_pending:'Checkout de teste iniciado',demo_payment_review:'Pagamento em conferência (teste)',demo_paid:'Pagamento aprovado (teste)'});
const next={demo_payment_pending:[],demo_payment_review:[],demo_paid:['demo_preparing'],demo_received:['demo_preparing','demo_cancelled'],demo_preparing:['demo_ready','demo_cancelled'],demo_ready:['demo_completed','demo_cancelled'],demo_completed:[],demo_cancelled:[],demo_expired:[]};
let products=[],orders=[],activity=[],authEpoch=0;
function loggedIn(value){$('#login-section').hidden=value;$('#dashboard').hidden=!value;$('#logout').hidden=!value;if(!value){authEpoch++;products=[];orders=[];activity=[];$('#admin-products').innerHTML='';$('#admin-orders').innerHTML='';$('#admin-activity').innerHTML='';$('#stats').innerHTML='';$('#product-form').reset();if($('#edit-dialog').open)$('#edit-dialog').close();document.dispatchEvent(new Event('maevi:admin-logout'));}}
async function api(url,options={}){
  let response;try{response=await fetch(url,{signal:AbortSignal.timeout(20000),...options,headers:{'Content-Type':'application/json','X-Maevi-Request':'1',...options.headers}});}catch{throw new Error('Servidor indisponível. Confira o terminal e tente novamente.');}
  const result=await response.json();if(!response.ok){if(response.status===401)loggedIn(false);throw new Error(result.error||'Não foi possível concluir.');}return result;
}
async function refresh(silent=false){
  $('#refresh').disabled=true;const epoch=authEpoch;
  try{const [catalog,purchases,events]=await Promise.all([api('/api/admin/products'),api('/api/admin/orders'),api('/api/admin/activity')]);if(epoch!==authEpoch)return false;products=catalog.products;orders=purchases.orders;activity=events.activity;loggedIn(true);render();document.dispatchEvent(new Event('maevi:admin-ready'));if(!silent)$('#admin-message').textContent='Dados atualizados.';return true;}
  catch(error){if(!silent)$('#admin-message').textContent=error.message;return false;}finally{$('#refresh').disabled=false;}
}
function render(){
  const stock=products.reduce((total,p)=>total+Object.values(p.stock).reduce((a,b)=>a+b,0),0);
  $('#stats').innerHTML=`<div><strong>${products.length}</strong><span>Peças cadastradas</span></div><div><strong>${stock}</strong><span>Unidades disponíveis</span></div><div><strong>${orders.filter(o=>!['demo_cancelled','demo_completed','demo_expired'].includes(o.status)).length}</strong><span>Testes em andamento (últimos 200)</span></div>`;
  const productQuery=$('#admin-product-search').value.trim().toLocaleLowerCase('pt-BR');
  const inventory=products.filter(p=>[p.name,p.category,p.color].join(' ').toLocaleLowerCase('pt-BR').includes(productQuery)&&(!$('#low-stock-only').checked||Object.values(p.stock).some(n=>n<=2)));
  $('#admin-products').innerHTML=inventory.length?inventory.map(p=>`<tr><td><div class="admin-product-name"><img src="${escapeHTML(p.image)}" alt=""><div>${escapeHTML(p.name)}<small>${escapeHTML(p.category)} · ${escapeHTML(p.color)}${p.featured?' · destaque':''}</small></div></div></td><td>${money(p.priceCents)}</td><td>${Object.values(p.stock).reduce((a,b)=>a+b,0)}<br><small class="${Object.values(p.stock).some(n=>n<=2)?'stock-warning':''}">P ${p.stock.P} / M ${p.stock.M} / G ${p.stock.G} / GG ${p.stock.GG}</small></td><td>${p.active?'Visível':'Oculta'}</td><td><button data-edit="${p.id}">Editar</button></td></tr>`).join(''):'<tr><td colspan="5">Nenhuma peça encontrada com esses filtros.</td></tr>';
  const orderQuery=$('#admin-order-search').value.trim().toLocaleLowerCase('pt-BR'),status=$('#admin-order-status').value;
  const visibleOrders=orders.filter(o=>(!status||status===o.status)&&[o.id,o.customer.name,o.customer.email].join(' ').toLocaleLowerCase('pt-BR').includes(orderQuery));
  $('#admin-orders').innerHTML=visibleOrders.length?visibleOrders.map(o=>`<article class="admin-order"><div class="admin-order-head"><div><h3>${escapeHTML(o.id)}</h3><p>${new Date(o.createdAt).toLocaleString('pt-BR')}</p></div><span class="status-pill">${labels[o.status]}</span></div><p>${escapeHTML(o.customer.name)} · ${escapeHTML(o.customer.email)}${o.customer.phone?" · "+escapeHTML(o.customer.phone):""}</p>${o.address?`<p class="order-address">${escapeHTML(o.address.street)}, ${escapeHTML(o.address.number)} ${escapeHTML(o.address.complement)} · ${escapeHTML(o.address.district)} · ${escapeHTML(o.address.city)} / ${escapeHTML(o.address.state)} · CEP ${escapeHTML(o.address.cep)}</p>`:""}<div class="order-lines">${o.items.map(i=>`<div><span>${escapeHTML(i.name)} / ${escapeHTML(i.color)} · ${i.size} × ${i.quantity}</span><strong>${money(i.lineCents)}</strong></div>`).join('')}<div><span>Total de teste · ${o.shipping?.method==="delivery"?"entrega":"retirada"}</span><strong>${money(o.totalCents)}</strong></div></div>${o.discountCents?`<p>Cupom ${escapeHTML(o.coupon.code)} · desconto ${money(o.discountCents)}</p>`:""}<p>Entrega: ${money(o.shippingCents||0)} · ${o.payment?.provider?escapeHTML(o.payment.status)+' (Mercado Pago teste)':'pagamento não solicitado'}</p><p class="history-note">${(o.history||[{status:o.status,at:o.createdAt}]).map(h=>`${escapeHTML(labels[h.status]||h.status)} · ${escapeHTML(new Date(h.at).toLocaleString('pt-BR'))}`).join(' → ')}</p><div class="admin-order-actions">${(next[o.status]||[]).filter(status=>!(o.payment?.provider&&status==='demo_cancelled')).map(status=>`<button data-order="${o.id}" data-status="${status}" class="${status==='demo_cancelled'?'cancel-order':''}">${status==='demo_cancelled'?'Cancelar teste e devolver estoque':labels[status]}</button>`).join('')}</div></article>`).join(''):'<p>Nenhum pedido encontrado. Crie um teste na vitrine ou ajuste os filtros.</p>';
  const actions={created:'Cadastro criado',updated:'Cadastro atualizado',uploaded:'Foto enviada',...labels};
  $('#admin-activity').innerHTML=activity.length?activity.map(a=>`<li><span>${escapeHTML(actions[a.action]||a.action)} · ${({product:'Peça',order:'Pedido',settings:'Configuração',coupon:'Cupom',image:'Imagem'})[a.entity]||'Registro'} ${escapeHTML(a.entity_id)}</span><time>${escapeHTML(new Date(a.at).toLocaleString('pt-BR'))}</time></li>`).join(''):'<li>Os próximos cadastros e pedidos aparecerão aqui.</li>';
}
$('#login-form').addEventListener('submit',async event=>{event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;$('#admin-message').textContent='';try{await api('/api/admin/login',{method:'POST',body:JSON.stringify({key:new FormData(event.target).get('key')})});event.target.reset();await refresh();}catch(error){$('#admin-message').textContent=error.message;}finally{button.disabled=false;}});
$('#logout').addEventListener('click',async()=>{try{await api('/api/admin/logout',{method:'POST',body:'{}'});loggedIn(false);products=[];orders=[];$('#admin-products').innerHTML='';$('#admin-orders').innerHTML='';$('#admin-message').textContent='Você saiu do painel.';}catch(error){$('#admin-message').textContent=error.message;}});
$('#refresh').addEventListener('click',()=>refresh());
['admin-product-search','admin-order-search'].forEach(id=>$('#'+id).addEventListener('input',render));
['low-stock-only','admin-order-status'].forEach(id=>$('#'+id).addEventListener('change',render));
document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b===button));$('#catalog-panel').hidden=button.dataset.tab!=='catalog';$('#orders-panel').hidden=button.dataset.tab!=='orders';}));
function edit(p){
  const form=$('#product-form');form.reset();$('#edit-message').textContent='';$('#edit-title').textContent=p?'Editar peça':'Nova peça';
  const values=p?{...p,price:(p.priceCents/100).toFixed(2),...p.stock}:{id:'',version:'',hex:'#303521',category:'Vestidos',P:0,M:0,G:0,GG:0};
  for(const [key,value] of Object.entries(values)){const input=form.elements.namedItem(key);if(input&&input.type!=='checkbox')input.value=value;}
  form.elements.active.checked=p?p.active:true;form.elements.featured.checked=Boolean(p?.featured);$('#edit-dialog').showModal();
}
$('#new-product').addEventListener('click',()=>edit(null));$('#close-edit').addEventListener('click',()=>$('#edit-dialog').close());
$('#admin-products').addEventListener('click',event=>{const button=event.target.closest('[data-edit]');if(button)edit(products.find(p=>p.id===Number(button.dataset.edit)));});
$('#product-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=new FormData(event.target),id=form.get('id');$('#save-product').disabled=true;$('#edit-message').textContent='';
  const data={name:form.get('name'),category:form.get('category'),priceCents:Math.round(Number(form.get('price'))*100),color:form.get('color'),hex:form.get('hex'),description:form.get('description'),image:form.get('image'),secondaryImage:form.get('secondaryImage'),material:form.get('material'),care:form.get('care'),measurements:form.get('measurements'),featured:form.get('featured')==='on',stock:Object.fromEntries(['P','M','G','GG'].map(s=>[s,Number(form.get(s))])),active:form.get('active')==='on',version:Number(form.get('version'))};
  try{await api('/api/admin/products'+(id?'/'+id:''),{method:id?'PUT':'POST',body:JSON.stringify(data)});$('#edit-dialog').close();await refresh(true);$('#admin-message').textContent='Peça salva. Atualize a vitrine para ver a alteração.';}catch(error){$('#edit-message').textContent=error.message;}finally{$('#save-product').disabled=false;}
});
$('#admin-orders').addEventListener('click',async event=>{
  const button=event.target.closest('[data-order]');if(!button)return;
  if(button.dataset.status==='demo_cancelled'&&!confirm('Cancelar este teste e devolver as peças ao estoque?'))return;
  button.disabled=true;
  try{await api('/api/admin/orders/'+button.dataset.order,{method:'PATCH',body:JSON.stringify({status:button.dataset.status})});await refresh(true);$('#admin-message').textContent='Situação do teste atualizada.';}catch(error){$('#admin-message').textContent=error.message;button.disabled=false;}
});
window.MaeviAdmin=Object.freeze({api,money,escapeHTML,refresh});
refresh(true);
