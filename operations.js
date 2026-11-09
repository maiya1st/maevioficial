(() => {
  'use strict';
  const {api,money,escapeHTML:esc,refresh}=window.MaeviAdmin,el=id=>document.getElementById(id);
  const form=el('store-settings-form'),couponForm=el('coupon-form');let config=null,coupons=[],dirty=false,generation=0;
  function values(form){return new FormData(form);}
  function populate(store){
    config=store;const data={...store,deliveryPrice:(store.deliveryCents/100).toFixed(2),freeShippingFrom:(store.freeShippingFromCents/100).toFixed(2)};
    for(const [name,value] of Object.entries(data)){const input=form.elements.namedItem(name);if(input){if(input.type==='checkbox')input.checked=value;else input.value=value;}}
    dirty=false;
  }
  function renderCoupons(){
    el('coupon-list').innerHTML=coupons.length?coupons.map(c=>`<tr><td><strong>${esc(c.code)}</strong></td><td>${c.percent}%</td><td>${money(c.minCents)}</td><td>${c.used} / ${c.maxUses}</td><td>${!c.active?'Inativo':c.expiresAt&&Date.parse(c.expiresAt)<=Date.now()?'Expirado':'Ativo'}</td><td><button data-coupon="${esc(c.code)}">Editar</button></td></tr>`).join(''):'<tr><td colspan="6">Nenhum cupom cadastrado. Crie um quando quiser testar descontos.</td></tr>';
  }
  async function load(){
    const id=++generation;
    try{const [settings,discounts]=await Promise.all([api('/api/admin/settings'),api('/api/admin/coupons')]);if(id!==generation||el('dashboard').hidden)return;if(!dirty)populate(settings.store);document.querySelector('.gateway-card p').textContent=settings.payment.message;coupons=discounts.coupons;renderCoupons();}
    catch(error){if(!el('dashboard').hidden)el('settings-message').textContent=error.message;}
  }
  document.addEventListener('maevi:admin-ready',load);
  document.addEventListener('maevi:admin-logout',()=>{generation++;config=null;coupons=[];dirty=false;form.reset();couponForm.reset();couponForm.hidden=true;el('coupon-list').replaceChildren();});
  form.addEventListener('input',()=>{dirty=true;el('settings-message').textContent='Há alterações ainda não salvas.';});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!config){el('settings-message').textContent='Atualize os dados para carregar as configurações.';return;}
    const data=values(form),input={version:config.version,name:data.get('name'),email:data.get('email'),whatsapp:data.get('whatsapp'),instagram:data.get('instagram'),pickupAddress:data.get('pickupAddress'),pickupEnabled:data.get('pickupEnabled')==='on',deliveryEnabled:data.get('deliveryEnabled')==='on',deliveryLabel:data.get('deliveryLabel'),deliveryCents:Math.round(Number(data.get('deliveryPrice'))*100),deliveryMinDays:Number(data.get('deliveryMinDays')),deliveryMaxDays:Number(data.get('deliveryMaxDays')),freeShippingFromCents:Math.round(Number(data.get('freeShippingFrom'))*100),reservationMinutes:Number(data.get('reservationMinutes'))};
    el('save-settings').disabled=true;el('settings-message').textContent='Salvando…';
    try{const result=await api('/api/admin/settings',{method:'PUT',body:JSON.stringify(input)});populate(result.store);await refresh(true);el('settings-message').textContent='Configurações salvas. Atualize a vitrine para ver as mudanças.';}
    catch(error){el('settings-message').textContent=error.message;}finally{el('save-settings').disabled=false;}
  });
  function editCoupon(c){
    couponForm.reset();couponForm.hidden=false;el('coupon-title').textContent=c?'Editar cupom':'Novo cupom';el('coupon-admin-message').textContent='';couponForm.dataset.version=String(c?.version||0);
    const data=c?{...c,minPrice:(c.minCents/100).toFixed(2)}:{code:'',percent:10,minPrice:'0.00',maxUses:100,active:true,expiresAt:''};
    for(const [name,value] of Object.entries(data)){const field=couponForm.elements.namedItem(name);if(field&&name!=='expiresAt'){if(field.type==='checkbox')field.checked=value;else field.value=value;}}
    const date=c?.expiresAt?new Date(c.expiresAt):null;if(date){date.setMinutes(date.getMinutes()-date.getTimezoneOffset());couponForm.elements.expiresAt.value=date.toISOString().slice(0,16);}
    couponForm.elements.code.readOnly=Boolean(c);couponForm.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});couponForm.elements.percent.focus({preventScroll:true});
  }
  document.addEventListener('maevi:coupons-changed',load);
  el('new-coupon').addEventListener('click',()=>editCoupon(null));el('close-coupon').addEventListener('click',()=>{couponForm.hidden=true;});
  el('coupon-list').addEventListener('click',event=>{const button=event.target.closest('[data-coupon]');if(button)editCoupon(coupons.find(c=>c.code===button.dataset.coupon));});
  couponForm.addEventListener('submit',async event=>{
    event.preventDefault();const data=values(couponForm),date=data.get('expiresAt');const input={code:data.get('code').trim().toUpperCase(),percent:Number(data.get('percent')),minCents:Math.round(Number(data.get('minPrice'))*100),maxUses:Number(data.get('maxUses')),active:data.get('active')==='on',expiresAt:date?new Date(date).toISOString():'',version:Number(couponForm.dataset.version)};
    el('save-coupon').disabled=true;el('coupon-admin-message').textContent='Salvando…';
    try{await api('/api/admin/coupons',{method:'POST',body:JSON.stringify(input)});couponForm.hidden=true;await refresh(true);el('dashboard-message').textContent='Cupom salvo. Ele já pode ser validado no checkout.';}
    catch(error){el('coupon-admin-message').textContent=error.message;}finally{el('save-coupon').disabled=false;}
  });
  if(!el('dashboard').hidden)load();
})();
