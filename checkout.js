(() => {
  'use strict';
  const storeApp=window.MaeviStore,{api,money,escapeHTML:esc,toast}=storeApp;
  const el=id=>document.getElementById(id),form=el('checkout-form'),field=name=>form.elements.namedItem(name);
  const liveLabels={demo_received:'Pedido recebido · aguardando pagamento',demo_payment_pending:'Aguardando pagamento',demo_payment_review:'Pagamento em conferência',demo_paid:'Pagamento aprovado',demo_preparing:'Em preparação',demo_ready:'Pronto para envio ou retirada',demo_completed:'Pedido concluído',demo_cancelled:'Pedido cancelado',demo_expired:'Reserva expirada'};
  const label=status=>liveLabels[status]||status;
  let paymentOptions=null,store=null,items=[],step=0,quote=null,requestId=0,currentOrder=null,attempt=null,submitting=false,postalRequest=0;
  try{const saved=JSON.parse(sessionStorage.getItem('maevi-attempt'));if(saved&&/^[a-f0-9]{64}$/.test(saved.signature)&&typeof saved.key==='string')attempt=saved;}catch{}
  const access=()=>{const value=storeApp.getLastOrder();return value&&/^MV-[A-F0-9]{16}$/.test(value.id)&&/^[a-f0-9]{48}$/.test(value.token)?value:null;};
  function shippingSelection(){return {method:field('shippingMethod').value, ...(field('shippingMethod').value==='delivery'?{cep:field('cep').value.replace(/\D/g,'')}:{})};}
  function checkoutAddress(){return Object.fromEntries(['cep','street','number','complement','district','city','state'].map(name=>[name,field(name).value.trim()]));}
  function invalidate(){requestId++;quote=null;el('place-order').disabled=true;}
  function showStep(value){
    step=value;document.querySelectorAll('[data-checkout-panel]').forEach(node=>node.hidden=Number(node.dataset.checkoutPanel)!==step);
    document.querySelectorAll('[data-checkout-step]').forEach(node=>{if(Number(node.dataset.checkoutStep)===step)node.setAttribute('aria-current','step');else node.removeAttribute('aria-current');});
    el('checkout-back').hidden=false;el('checkout-back').textContent=step===0?'← Sacola':'← Voltar';el('checkout-next').hidden=step===2;el('place-order').hidden=step!==2;
    el('order-message').textContent='';el('checkout-title').focus({preventScroll:true});el('checkout-dialog').scrollTop=0;
  }
  function validateCurrent(){
    const panel=document.querySelector(`[data-checkout-panel="${step}"]`);
    for(const input of panel.querySelectorAll('input,select'))if(!input.checkValidity()){input.reportValidity();return false;}
    if(step===0){const phone=field('phone').value.replace(/\D/g,'').replace(/^55(?=\d{10,11}$)/,'');if(!/^\d{10,11}$/.test(phone)){field('phone').setCustomValidity('Informe um celular com DDD.');field('phone').reportValidity();return false;}}
    if(step===1&&shippingSelection().method==='delivery'&&field('cep').value.replace(/\D/g,'').length!==8){field('cep').setCustomValidity('Informe um CEP de oito dígitos.');field('cep').reportValidity();return false;}
    return true;
  }
  function summary(totals){
    const lines=totals.items.map(i=>`<div><span>${esc(i.name)} · ${i.size} × ${i.quantity}</span><strong>${money(i.lineCents)}</strong></div>`).join('');
    return `<div class="order-lines">${lines}<div><span>Subtotal</span><strong>${money(totals.subtotalCents)}</strong></div>${totals.discountCents?`<div class="discount-line"><span>Cupom ${esc(totals.coupon.code)}</span><strong>− ${money(totals.discountCents)}</strong></div>`:''}<div><span>${totals.shipping?.method==='delivery'?(('Entrega')):(('Retirada'))}</span><strong>${money(totals.shippingCents||0)}</strong></div><div class="order-total"><span>${('Total')}</span><strong>${money(totals.totalCents)}</strong></div></div>`;
  }
  function initialSummary(){
    const catalog=storeApp.getProducts();const selected=items.map(i=>{const p=catalog.find(p=>p.id===i.id);return {...i,name:p?.name||'Peça',lineCents:(p?.priceCents||0)*i.quantity};});
    el('checkout-lines').innerHTML=`<div class="order-lines">${selected.map(i=>`<div><span>${esc(i.name)} · ${i.size} × ${i.quantity}</span><strong>${money(i.lineCents)}</strong></div>`).join('')}<div><span>Subtotal estimado</span><strong>${money(selected.reduce((s,i)=>s+i.lineCents,0))}</strong></div></div><p class="field-note">Frete, cupom e disponibilidade serão conferidos antes da confirmação.</p>`;
  }
  function review(){
    const s=shippingSelection(),a=checkoutAddress();
    el('checkout-review').innerHTML=`<div class="review-block"><button type="button" data-edit-step="0">Editar</button><strong>SEUS DADOS</strong>${esc(field('name').value)}<br>${esc(field('email').value)}<br>${esc(field('phone').value)}</div><div class="review-block"><button type="button" data-edit-step="1">Editar</button><strong>${s.method==='delivery'?'ENTREGA':'RETIRADA'}</strong>${s.method==='delivery'?`${esc(a.street)}, ${esc(a.number)} ${esc(a.complement)}<br>${esc(a.district)} · ${esc(a.city)} / ${esc(a.state)}<br>CEP ${esc(a.cep)}`:esc(store.pickupAddress||'Combine a retirada pelo WhatsApp da loja.')}<p class="field-note">${((s.method==='delivery'?'Prazo estimado a partir da confirmação do pagamento.':'Avisaremos pelo seu contato quando o pedido estiver pronto para retirada.'))}</p></div>`;
  }
  async function updateQuote(){
    const id=++requestId;quote=null;el('place-order').disabled=true;el('coupon-message').textContent='Conferindo os valores…';
    try{
      const value=await api('/api/quote',{method:'POST',body:JSON.stringify({items,coupon:field('coupon').value.trim().toUpperCase(),shipping:shippingSelection()})});
      if(id!==requestId)return false;quote=value;el('checkout-lines').innerHTML=summary(value);el('checkout-mobile-summary').innerHTML=summary(value);el('coupon-message').textContent=value.coupon?'Cupom aplicado. O desconto aparece no resumo.':'';el('place-order').disabled=false;return true;
    }catch(error){if(id===requestId){el('coupon-message').textContent=error.message;el('order-message').textContent='Não foi possível confirmar os valores. Corrija as informações ou volte à sacola.';}return false;}
  }
  function renderMethods(){
    const choices=[];
    if(store.pickupEnabled)choices.push({id:'pickup',name:'Retirar na loja',detail:((store.pickupAddress?'Sem custo · '+store.pickupAddress:'Sem custo de entrega'))});
    if(store.deliveryEnabled)choices.push({id:'delivery',name:store.deliveryLabel,detail:`A partir de ${money(store.deliveryCents)} · prazo estimado de ${store.deliveryMinDays} a ${store.deliveryMaxDays} dias úteis`});
    el('shipping-methods').innerHTML=choices.map((m,index)=>`<label class="shipping-option"><input name="shippingMethod" type="radio" value="${m.id}" ${index===0?'checked':''}><span><strong>${esc(m.name)}</strong><small>${esc(m.detail)}</small></span></label>`).join('');
    el('pickup-details').textContent=store.pickupAddress||'Combine a retirada pelo WhatsApp da loja.';toggleDelivery();
  }
  function toggleDelivery(){
    const delivery=shippingSelection().method==='delivery';el('delivery-fields').hidden=!delivery;el('pickup-details').hidden=delivery;
    for(const name of ['cep','street','number','district','city','state'])field(name).required=delivery;invalidate();
  }
  el('shipping-methods').addEventListener('change',toggleDelivery);
  form.addEventListener('input',event=>{event.target.setCustomValidity?.('');if(event.target.name==='coupon'){invalidate();el('coupon-message').textContent='Clique em Aplicar para conferir o cupom.';}});
  el('checkout').addEventListener('click',async()=>{
    el('checkout').disabled=true;el('checkout-message').textContent='Preparando seu checkout…';
    try{const config=await api('/api/store');store=config.store;paymentOptions=config.payment;document.querySelector('.payment-notice strong').textContent=paymentOptions.configured?'Pagamento seguro pelo Mercado Pago':'Pagamentos indisponíveis no momento';document.querySelector('.payment-notice p').textContent=paymentOptions.message;items=storeApp.getCart();if(!items.length)throw Error('Sua sacola está vazia.');renderMethods();initialSummary();el('cart-dialog').close();el('checkout-dialog').showModal();showStep(0);el('checkout-message').textContent='';}
    catch(error){el('checkout-message').textContent=error.message;}finally{el('checkout').disabled=!storeApp.getCart().length;}
  });
  el('checkout-next').addEventListener('click',async()=>{
    if(!validateCurrent())return;
    if(step===0){showStep(1);return;}
    review();showStep(2);await updateQuote();
  });
  el('checkout-back').addEventListener('click',()=>{invalidate();if(step===0){el('checkout-dialog').close();storeApp.openCart();}else showStep(step-1);});
  el('checkout-review').addEventListener('click',event=>{const button=event.target.closest('[data-edit-step]');if(button){invalidate();showStep(Number(button.dataset.editStep));}});
  el('apply-coupon').addEventListener('click',()=>{field('coupon').value=field('coupon').value.trim().toUpperCase();updateQuote();});
  el('lookup-cep').addEventListener('click',async()=>{
    const code=field('cep').value.replace(/\D/g,'');if(code.length!==8){el('postal-message').textContent='Informe os oito dígitos do CEP.';field('cep').focus();return;}
    const id=++postalRequest;el('lookup-cep').disabled=true;el('postal-message').textContent='Consultando endereço…';
    try{const result=await api('/api/postal-code/'+code);if(id!==postalRequest||field('cep').value.replace(/\D/g,'')!==code)return;for(const name of ['street','district','city','state']){field(name).value=result.address[name];field(name).setCustomValidity('');}el('postal-message').textContent='Endereço encontrado. Confira os dados e preencha o número.';field('number').focus();}
    catch(error){el('postal-message').textContent=error.message;}finally{el('lookup-cep').disabled=false;}
  });
  field('cep').addEventListener('input',()=>{postalRequest++;invalidate();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(submitting)return;if(step!==2){el('checkout-next').click();return;}
    if(!validateCurrent())return;
    if(!quote){el('order-message').textContent='Confira os valores com o botão Aplicar antes de confirmar.';return;}
    submitting=true;el('place-order').disabled=true;el('order-message').textContent='Registrando seu pedido…';
    const shipping=shippingSelection();const payload={checkoutVersion:2,items,customer:{name:field('name').value.trim(),email:field('email').value.trim(),phone:field('phone').value.trim()},shipping,address:shipping.method==='delivery'?checkoutAddress():null,coupon:field('coupon').value.trim().toUpperCase(),fulfillment:shipping.method==='delivery'?'demo_delivery':'demo_pickup',demoAccepted:field('demoAccepted').checked,expectedTotalCents:quote.totalCents,expectedSettingsVersion:quote.settingsVersion};
    try{
      const body=JSON.stringify(payload),signature=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body))),b=>b.toString(16).padStart(2,'0')).join('');
      if(!attempt||attempt.signature!==signature){attempt={signature,key:crypto.randomUUID()};try{sessionStorage.setItem('maevi-attempt',JSON.stringify(attempt));}catch{}}
      const result=await api('/api/orders',{method:'POST',headers:{'Idempotency-Key':attempt.key},body});
      storeApp.rememberOrder({id:result.order.id,token:result.token});attempt=null;try{sessionStorage.removeItem('maevi-attempt');}catch{}
      storeApp.emptyCart();form.reset();el('checkout-dialog').close();el('last-order').hidden=false;showOrder(result.order);await storeApp.refreshCatalog();if(paymentOptions?.configured&&result.order.status==='demo_received')startPayment();
    }catch(error){el('order-message').textContent=error.message+' Se a conexão falhou, tente novamente sem alterar os dados: a mesma tentativa não duplica o pedido.';if(error.status===409){quote=null;storeApp.refreshCatalog();}}
    finally{submitting=false;el('place-order').disabled=!quote;}
  });
  function showOrder(order){
    currentOrder=order;const delivery=order.shipping?.method==='delivery',a=order.address;
    el('order-detail').innerHTML=`<div class="checkmark" aria-hidden="true">✓</div><h2>${['demo_cancelled','demo_expired'].includes(order.status)?'Seu pedido foi atualizado.':((order.status==='demo_paid'?'Pagamento aprovado!':'Recebemos seu pedido.'))}</h2><p class="order-number">${esc(order.id)}</p><p class="status-pill">${esc(label(order.status))}</p>${summary(order)}<div class="receipt-identity"><p>${esc(order.customer.name)} · ${esc(order.customer.email)}</p>${a?`<p>${esc(a.street)}, ${esc(a.number)} · ${esc(a.city)} / ${esc(a.state)} · CEP ${esc(a.cep)}</p>`:''}<p>${delivery?esc(order.shipping.label):('Retirada na loja'+(order.shipping?.addressLabel?' · '+esc(order.shipping.addressLabel):''))}</p></div>${order.status==='demo_received'&&order.reservationExpiresAt?`<p class="reservation-note">${('Suas peças estão reservadas até '+esc(new Date(order.reservationExpiresAt).toLocaleString('pt-BR'))+'. Finalize o pagamento antes desse horário.')}</p>`:''}<ol class="order-timeline">${(order.history||[{status:order.status,at:order.createdAt}]).map(h=>`<li>${esc(label(h.status))}<small>${esc(new Date(h.at).toLocaleString('pt-BR'))}</small></li>`).join('')}</ol><details class="access-key"><summary>Guardar os dados para consultar depois</summary><p>Guarde o número do pedido e esta chave privada. Ela permite consultar os dados deste pedido; não compartilhe.</p><label>Chave de consulta<input readonly value="${esc(access()?.token||'')}" aria-label="Chave privada de consulta"></label></details><p class="delivery-note">${('Guarde o número e a chave do pedido para acompanhar a situação por aqui.')}</p>`;
    el('cancel-order').hidden=order.status!=='demo_received';el('pay-order').hidden=!(paymentOptions?.configured&&order.status==='demo_received'||order.status==='demo_payment_pending'&&order.payment?.checkoutUrl&&Date.parse(order.payment.expiresAt)>Date.now());el('order-status-message').textContent='';
    if(order.payment?.provider){const note=el('order-detail').querySelector('.delivery-note');if(note)note.textContent=((order.status==='demo_paid'?'Recebemos a confirmação do Mercado Pago. Vamos preparar suas peças e avisar você pelo contato informado.':'Pagamento pelo Mercado Pago. Assim que ele for aprovado, a situação muda para Pagamento aprovado. Pix pode levar alguns instantes. Guarde o número e a chave do pedido para acompanhar.'));}
    if(!el('order-dialog').open)el('order-dialog').showModal();
  }
  async function refreshOrder(){
    const saved=access();if(!saved){el('lookup-dialog').showModal();return;}
    el('refresh-order').disabled=true;el('order-status-message').textContent='';
    try{paymentOptions=(await api('/api/store')).payment;const current=await api('/api/orders/'+saved.id,{headers:{'X-Order-Token':saved.token}});showOrder(current.order);if(current.order.payment?.preferenceId&&paymentOptions.configured){const result=await api('/api/orders/'+saved.id+'/payment-refresh',{method:'POST',headers:{'X-Order-Token':saved.token},body:'{}'});showOrder(result.order);}}
    catch(error){if(!el('order-dialog').open)el('order-dialog').showModal();el('order-status-message').textContent=error.message;}finally{el('refresh-order').disabled=false;}
  }
  el('refresh-order').addEventListener('click',refreshOrder);el('last-order').addEventListener('click',refreshOrder);el('last-order').hidden=!access();
  async function startPayment(){
    const saved=access();if(!saved)return;el('pay-order').disabled=true;el('order-status-message').textContent=('Abrindo o pagamento seguro do Mercado Pago…');
    try{const result=await api('/api/orders/'+saved.id+'/payment-session',{method:'POST',headers:{'X-Order-Token':saved.token},body:'{}'});const url=new URL(result.session.url);if(url.protocol!=='https:'||url.hostname!=='www.mercadopago.com.br'||url.port||url.username||url.password||!url.pathname.startsWith('/checkout/'))throw Error('Endereço de pagamento inválido.');location.assign(url.href);}
    catch(error){el('order-status-message').textContent=error.message;}finally{el('pay-order').disabled=false;}
  }
  el('pay-order').addEventListener('click',startPayment);
  if(new URLSearchParams(location.search).get('retorno')==='mp'){
    history.replaceState(null,'',location.pathname);refreshOrder();
  }
  el('cancel-order').addEventListener('click',async()=>{
    const saved=access();if(!saved||!confirm(('Cancelar este pedido e liberar as peças reservadas?')))return;
    el('cancel-order').disabled=true;
    try{const result=await api('/api/orders/'+saved.id+'/cancel',{method:'POST',headers:{'X-Order-Token':saved.token},body:'{}'});showOrder(result.order);await storeApp.refreshCatalog();}
    catch(error){el('order-status-message').textContent=error.message;}finally{el('cancel-order').disabled=false;}
  });
  el('print-order').addEventListener('click',()=>{if(currentOrder)window.print();});
  el('lookup-open').addEventListener('click',()=>el('lookup-dialog').showModal());
  el('lookup-order-form').addEventListener('submit',async event=>{
    event.preventDefault();const f=new FormData(event.target),id=f.get('id').trim().toUpperCase(),token=f.get('token').trim(),button=event.target.querySelector('button');button.disabled=true;el('lookup-message').textContent='Consultando…';
    try{if(!/^MV-[A-F0-9]{16}$/.test(id)||!/^[a-f0-9]{48}$/.test(token))throw Error('Confira o número e a chave fornecidos na confirmação.');const result=await api('/api/orders/'+id,{headers:{'X-Order-Token':token}});storeApp.rememberOrder({id,token});el('last-order').hidden=false;event.target.reset();el('lookup-message').textContent='';el('lookup-dialog').close();showOrder(result.order);}
    catch(error){el('lookup-message').textContent=error.message;}finally{button.disabled=false;}
  });
})();
