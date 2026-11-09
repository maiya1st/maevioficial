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
      if(phone){const a=document.createElement('a');a.href='https://wa.me/55'+phone;a.textContent='WhatsApp da loja';a.target='_blank';a.rel='noopener noreferrer';footer.append(a);}
      if(handle){
        const url='https://www.instagram.com/'+encodeURIComponent(handle)+'/';
        document.querySelectorAll('[data-instagram-link]').forEach(a=>{a.href=url;a.hidden=false;});
        document.querySelectorAll('[data-instagram-handle]').forEach(node=>node.textContent='@'+handle);
        popup.dataset.ready='true';document.getElementById('instagram-show').hidden=false;
        timer=setTimeout(()=>show(),5000);
      }
      if(store.email){const a=document.createElement('a');a.href='mailto:'+store.email;a.textContent='E-mail da loja';footer.append(a);}
    }catch{document.getElementById('contact-status').textContent='Não foi possível carregar os contatos. Atualize a página com o servidor em execução.';}
  }
  load();
})();
