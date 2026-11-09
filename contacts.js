(() => {
  'use strict';
  const popup=document.getElementById('instagram-popup'),footer=document.getElementById('store-contact');
  const sessionKey='maevi-instagram-dismissed-v1';let dismissed=false,attempts=0,timer;
  try{dismissed=sessionStorage.getItem(sessionKey)==='yes';}catch{}
  function close(){popup.hidden=true;dismissed=true;clearTimeout(timer);try{sessionStorage.setItem(sessionKey,'yes');}catch{}}
  function show(manual=false){
    if(!popup.dataset.ready||(!manual&&dismissed))return;
    if(!manual&&(document.hidden||document.querySelector('dialog[open]')||document.activeElement?.matches('input,textarea,select'))){if(++attempts<20)timer=setTimeout(()=>show(),3000);return;}
    popup.hidden=false;
  }
  document.addEventListener('click',event=>{if(event.target.closest('#policy-open,[data-open-policy]'))document.getElementById('policy-dialog').showModal();});
  document.getElementById('instagram-dismiss').addEventListener('click',close);
  document.getElementById('instagram-popup-link').addEventListener('click',close);
  document.getElementById('instagram-show').addEventListener('click',()=>show(true));
  popup.addEventListener('keydown',event=>{if(event.key==='Escape'){close();document.getElementById('instagram-show').focus();}});
  async function load(){
    try{
      const {store}=await window.MaeviStore.api('/api/store');footer.replaceChildren();
      const legal=[store.legalName,store.documentId&&(store.documentId.length>14?'CNPJ ':'CPF ')+store.documentId,store.legalAddress].filter(Boolean);
      const legalNode=document.getElementById('store-legal');legalNode.textContent=legal.join(' · ');legalNode.hidden=!legal.length;
      const policy=typeof store.policy==='string'?store.policy.trim():'';
      document.getElementById('policy-text').textContent=policy;
      for(const button of document.querySelectorAll('#policy-open,[data-open-policy]'))button.hidden=!policy;
      const phone=typeof store.whatsapp==='string'&&/^\d{10,11}$/.test(store.whatsapp)?store.whatsapp:'';
      const handle=typeof store.instagram==='string'&&/^[a-zA-Z0-9._]{1,30}$/.test(store.instagram)?store.instagram:'';
      window.MaeviContacts=Object.freeze({whatsapp:phone});document.dispatchEvent(new CustomEvent('maevi:contacts'));
      for(const link of document.querySelectorAll('[data-whatsapp-link]')){link.hidden=!phone;if(phone)link.href='https://wa.me/55'+phone;}
      document.getElementById('whatsapp-pending').hidden=Boolean(phone);
      document.getElementById('whatsapp-number').textContent=phone?`(${phone.slice(0,2)}) ${phone.slice(2,-4)}-${phone.slice(-4)}`:'Número em confirmação';
      const float=document.getElementById('whatsapp-float');if(phone){float.href='https://wa.me/55'+phone+'?text='+encodeURIComponent('Olá, MAÉVI! Vim pelo site.');float.hidden=false;}
      if(phone){const a=document.createElement('a');a.href='https://wa.me/55'+phone;a.textContent='WhatsApp da loja';a.target='_blank';a.rel='noopener noreferrer';footer.append(a);}
      if(handle){
        const url='https://www.instagram.com/'+encodeURIComponent(handle)+'/';
        document.querySelectorAll('[data-instagram-link]').forEach(a=>{a.href=url;a.hidden=false;});
        document.querySelectorAll('[data-instagram-handle]').forEach(node=>node.textContent='@'+handle);
        popup.dataset.ready='true';document.getElementById('instagram-show').hidden=false;
        if(!welcomeWaiting(store))timer=setTimeout(()=>show(),5000);
      }
      window.MaeviWelcome?.start(store);
      if(store.email){const a=document.createElement('a');a.href='mailto:'+store.email;a.textContent='E-mail da loja';footer.append(a);}
    }catch{document.getElementById('contact-status').textContent='Não foi possível carregar os contatos. Atualize a página com o servidor em execução.';}
  }
  /* Pop-up de boas-vindas: cupom de primeira compra em troca do e-mail. */
  const welcome=document.getElementById('welcome-popup'),welcomeKey='maevi-welcome-v1';
  function welcomeState(){try{return localStorage.getItem(welcomeKey)||'';}catch{return 'blocked';}}
  function welcomeWaiting(store){return Boolean(store.welcome)&&!welcomeState();}
  function closeWelcome(value){welcome.hidden=true;try{if(!welcomeState())localStorage.setItem(welcomeKey,value);}catch{}}
  function showWelcome(tries=0){
    if(document.hidden||document.querySelector('dialog[open]')||document.activeElement?.matches('input,textarea,select')){if(tries<20)setTimeout(()=>showWelcome(tries+1),3000);return;}
    welcome.hidden=false;
  }
  document.getElementById('welcome-dismiss').addEventListener('click',()=>closeWelcome('dismissed'));
  welcome.addEventListener('keydown',e=>{if(e.key==='Escape')closeWelcome('dismissed');});
  document.getElementById('welcome-shop').addEventListener('click',()=>closeWelcome('subscribed'));
  document.getElementById('welcome-code').addEventListener('click',async e=>{try{await navigator.clipboard.writeText(e.currentTarget.textContent);window.MaeviStore.toast('Cupom copiado.');}catch{}});
  document.getElementById('welcome-form').addEventListener('submit',async event=>{
    event.preventDefault();const f=new FormData(event.target),message=document.getElementById('welcome-message'),button=event.target.querySelector('.button');
    if(!f.get('email').trim()){message.textContent='Informe seu e-mail.';return;}
    if(f.get('consent')!=='on'){message.textContent='Marque a autorização para receber o cupom.';return;}
    button.disabled=true;message.textContent='Enviando…';
    try{
      const r=await window.MaeviStore.api('/api/subscribers',{method:'POST',body:JSON.stringify({email:f.get('email').trim(),consent:true})});
      try{localStorage.setItem(welcomeKey,'subscribed');if(r.coupon)sessionStorage.setItem('maevi-welcome-coupon',r.coupon.code);}catch{}
      event.target.hidden=true;document.getElementById('welcome-done').hidden=false;
      if(r.coupon){document.getElementById('welcome-code').textContent=r.coupon.code;document.getElementById('welcome-note').textContent=`${r.coupon.percent}% de desconto${r.coupon.minCents?' em compras a partir de '+window.MaeviStore.money(r.coupon.minCents):''}. Ele já vai preenchido no checkout.`;}
      else{document.getElementById('welcome-code').hidden=true;document.getElementById('welcome-note').textContent='Cadastro feito! Fique de olho no seu e-mail.';}
    }catch(error){message.textContent=error.message;button.disabled=false;}
  });
  window.MaeviWelcome={start(store){if(!welcomeWaiting(store))return;document.getElementById('welcome-percent').textContent=store.welcome.percent+'%';setTimeout(()=>showWelcome(),6000);}};
  load();
})();
