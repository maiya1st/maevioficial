(() => {
  'use strict';
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const header=document.getElementById('store-header'),back=document.getElementById('back-top'),menu=document.getElementById('menu-dialog');
  let queued=false;
  function updateScroll(){header.classList.toggle('is-scrolled',scrollY>30);back.hidden=scrollY<650;queued=false;}
  addEventListener('scroll',()=>{if(!queued){queued=true;requestAnimationFrame(updateScroll);}},{passive:true});updateScroll();
  back.addEventListener('click',()=>{window.scrollTo({top:0,behavior:reduced.matches?'instant':'smooth'});header.querySelector('a').focus({preventScroll:true});});
  document.getElementById('menu-open').addEventListener('click',()=>menu.showModal());
  menu.querySelectorAll('a').forEach(link=>link.addEventListener('click',()=>menu.close()));
  if(!reduced.matches&&'IntersectionObserver' in window){
    const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-visible');observer.unobserve(entry.target);}}),{threshold:0.12});
    document.querySelectorAll('.reveal').forEach(node=>{node.classList.add('will-reveal');observer.observe(node);});
    reduced.addEventListener('change',()=>{if(reduced.matches){observer.disconnect();document.querySelectorAll('.will-reveal').forEach(node=>node.classList.add('is-visible'));}});
  }
  function fallback(image){
    if(!(image instanceof HTMLImageElement)||image.dataset.fallback)return;image.dataset.fallback='true';image.hidden=true;
    if(image.classList.contains('secondary-photo'))return;
    const note=document.createElement('span');note.className='image-placeholder';note.textContent='MAÉVI · imagem em preparação';image.parentElement.append(note);
  }
  document.addEventListener('error',event=>fallback(event.target),true);
  document.querySelectorAll('img').forEach(image=>{if(image.complete&&image.naturalWidth===0)fallback(image);});
})();
