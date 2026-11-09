// Camada imersiva da vitrine: seda líquida em WebGL, vitrine 3D em órbita,
// inclinação holográfica, cursor e botões magnéticos. Sem dependências externas
// (a política de segurança só aceita scripts do próprio domínio).
// Respeita prefers-reduced-motion e pausa tudo fora da tela ou em abas ocultas.
(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const $ = s => document.querySelector(s);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  document.documentElement.classList.add('immersive');

  /* ---------- 1. Seda líquida (WebGL) ---------- */
  const FRAG = `precision mediump float;
uniform vec2 r;uniform float t;uniform vec2 m;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
return mix(mix(h(i),h(i+vec2(1.,0.)),u.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;mat2 R=mat2(.8,.6,-.6,.8);for(int i=0;i<5;i++){v+=a*n(p);p=R*p*2.02;a*=.5;}return v;}
void main(){
vec2 uv=gl_FragCoord.xy/r;vec2 p=(gl_FragCoord.xy-.5*r)/min(r.x,r.y);
p+=(m-.5)*.35;float k=t*.05;
vec2 q=vec2(fbm(p*1.3+k),fbm(p*1.3+vec2(5.2,1.3)-k));
vec2 w=vec2(fbm(p*1.5+3.*q+vec2(1.7,9.2)+k*1.4),fbm(p*1.5+3.*q+vec2(8.3,2.8)-k));
float f=fbm(p*1.1+3.4*w);
float folds=pow(abs(sin(f*8.5+w.x*4.+t*.08)),7.);
vec3 deep=vec3(.05,.065,.038),olive=vec3(.2,.225,.14),champ=vec3(.93,.8,.7),rose=vec3(.86,.66,.6);
vec3 col=mix(deep,olive,smoothstep(.15,.85,f));
col=mix(col,mix(champ,rose,clamp(w.y*1.4-.2,0.,1.)),folds*.6*smoothstep(.25,.9,f));
col+=.05*vec3(sin(f*14.+t*.25),sin(f*14.+2.1+t*.25),sin(f*14.+4.2+t*.25))*folds;
float glow=smoothstep(.7,0.,length(p-(m-.5)*vec2(1.6,1.)));col+=vec3(.9,.75,.62)*glow*.07;
col*=.5+.5*smoothstep(1.3,.15,length(uv-.5)*1.7);
col+=(h(gl_FragCoord.xy+fract(t))-.5)*.03;
gl_FragColor=vec4(col,1.);}`;

  function silk() {
    const canvas = $('#silk'), hero = $('.hero-x');
    if (!canvas || !hero) return;
    let gl = null;
    try { gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, powerPreference: 'low-power' }); } catch {}
    if (!gl) { canvas.classList.add('is-fallback'); return; }
    const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
    const vs = shader(gl.VERTEX_SHADER, 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}'), fs = shader(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) { canvas.classList.add('is-fallback'); return; }
    const prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.classList.add('is-fallback'); return; }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uR = gl.getUniformLocation(prog, 'r'), uT = gl.getUniformLocation(prog, 't'), uM = gl.getUniformLocation(prog, 'm');
    const mouse = [.5, .5], target = [.5, .5];
    let visible = true, raf = 0, lost = false;
    const t0 = performance.now() - 12000;
    function resize() {
      const rect = canvas.getBoundingClientRect(), scale = innerWidth < 700 ? .45 : .6;
      canvas.width = Math.max(2, Math.round(rect.width * scale)); canvas.height = Math.max(2, Math.round(rect.height * scale));
      gl.viewport(0, 0, canvas.width, canvas.height); draw(performance.now());
    }
    function draw(now) {
      if (lost) return;
      mouse[0] += (target[0] - mouse[0]) * .04; mouse[1] += (target[1] - mouse[1]) * .04;
      gl.uniform2f(uR, canvas.width, canvas.height); gl.uniform1f(uT, (now - t0) / 1000); gl.uniform2f(uM, mouse[0], mouse[1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function loop(now) { draw(now); raf = requestAnimationFrame(loop); }
    function sync() {
      const run = visible && !document.hidden && !reduce.matches && !lost;
      if (run && !raf) raf = requestAnimationFrame(loop);
      if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
    }
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); }).observe(hero);
    document.addEventListener('visibilitychange', sync); reduce.addEventListener('change', sync);
    addEventListener('pointermove', e => { target[0] = e.clientX / innerWidth; target[1] = 1 - e.clientY / innerHeight; }, { passive: true });
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; sync(); canvas.classList.add('is-fallback'); });
    new ResizeObserver(resize).observe(canvas);
    canvas.classList.add('is-live'); sync();
  }

  /* ---------- 2. Parallax da abertura conforme a rolagem ---------- */
  function heroScroll() {
    const hero = $('.hero-x'); if (!hero) return;
    let queued = false;
    const update = () => { queued = false; hero.style.setProperty('--p', clamp(scrollY / Math.max(1, hero.offsetHeight), 0, 1).toFixed(3)); };
    addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true }); update();
  }

  /* ---------- 3. Faixa cinética: inclina com a velocidade da rolagem ---------- */
  function marquee() {
    const track = $('.marquee-track'); if (!track || reduce.matches) return;
    let last = scrollY, skew = 0, raf = 0;
    const tick = () => { const v = scrollY - last; last = scrollY; skew += (clamp(v * .35, -14, 14) - skew) * .12; track.style.setProperty('--skew', skew.toFixed(2) + 'deg'); raf = Math.abs(skew) > .05 || Math.abs(v) > 0 ? requestAnimationFrame(tick) : 0; };
    addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(tick); }, { passive: true });
  }

  /* ---------- 4. Inclinação 3D + brilho holográfico ---------- */
  function tilt() {
    if (!fine.matches || reduce.matches) return;
    const SELECTOR = '.product-photo,.edit-card,.hero-trio,.contact-card';
    let current = null;
    const reset = el => { el.classList.remove('is-tilting'); el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); };
    document.addEventListener('pointermove', e => {
      const el = e.target instanceof Element ? e.target.closest(SELECTOR) : null;
      if (current && current !== el) reset(current);
      current = el; if (!el) return;
      const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      const max = el.classList.contains('hero-trio') ? 12 : 8;
      el.classList.add('is-tilting');
      el.style.setProperty('--rx', ((.5 - y) * max).toFixed(2) + 'deg'); el.style.setProperty('--ry', ((x - .5) * max).toFixed(2) + 'deg');
      el.style.setProperty('--mx', (x * 100).toFixed(1) + '%'); el.style.setProperty('--my', (y * 100).toFixed(1) + '%');
    }, { passive: true });
    document.addEventListener('pointerleave', () => { if (current) reset(current); current = null; });
  }

  /* ---------- 5. Cursor em anel e botões magnéticos ---------- */
  function cursor() {
    if (!fine.matches || reduce.matches) return;
    const ring = document.createElement('div'); ring.className = 'cursor-ring'; ring.setAttribute('aria-hidden', 'true'); document.body.append(ring);
    let x = innerWidth / 2, y = innerHeight / 2, cx = x, cy = y, raf = 0, magnet = null;
    const tick = () => { cx += (x - cx) * .2; cy += (y - cy) * .2; ring.style.transform = `translate3d(${cx}px,${cy}px,0)`; raf = Math.hypot(x - cx, y - cy) > .3 ? requestAnimationFrame(tick) : 0; };
    document.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      x = e.clientX; y = e.clientY; ring.classList.add('is-active'); if (!raf) raf = requestAnimationFrame(tick);
      const t = e.target instanceof Element ? e.target : null;
      const label = t?.closest('.orbit-viewport') ? 'Girar' : t?.closest('.product-photo,.edit-card,.trio-card[data-pos=center][data-product]') ? 'Ver' : '';
      ring.dataset.label = label; ring.classList.toggle('is-hover', Boolean(label || t?.closest('a,button,summary,select,label')));
      const m = t?.closest('main .button,.orbit-arrow');
      if (magnet && magnet !== m) { magnet.style.translate = ''; magnet = null; }
      if (m) { const r = m.getBoundingClientRect(); magnet = m; m.style.translate = `${((x - r.left - r.width / 2) * .22).toFixed(1)}px ${((y - r.top - r.height / 2) * .3).toFixed(1)}px`; }
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => ring.classList.remove('is-active'));
  }

  /* ---------- 6. Vitrine 3D em órbita ---------- */
  function orbit() {
    const section = $('#orbita'), ring = $('#orbit-ring'), view = $('#orbit-viewport'), caption = $('#orbit-caption'), ghost = $('#orbit-ghost');
    if (!section || !ring || !view) return;
    let products = [], items = [], cards = [], N = 0, step = 0, radius = 0;
    let rot = 0, vel = 0, snap = null, dragging = false, lastX = 0, moved = 0, front = -1, idleUntil = 0, inView = false, hover = false, raf = 0, started = false;
    const store = () => window.MaeviStore;

    function build() {
      products = (store()?.getProducts() || []).filter(p => p.image);
      section.hidden = !products.length; if (!products.length) return;
      const count = products.length >= 8 ? Math.min(products.length, 14) : Math.ceil(8 / products.length) * products.length;
      items = Array.from({ length: count }, (_, i) => products[i % products.length]);
      const esc = store().escapeHTML;
      ring.innerHTML = items.map((p, i) => `<button type="button" class="orbit-card" data-index="${i}" tabindex="-1" aria-hidden="true"><img src="${esc(p.image)}" alt="" width="600" height="800" loading="${i < 3 || i > count - 3 ? 'eager' : 'lazy'}" decoding="async" draggable="false"><span class="orbit-card-label">${esc(p.name)}</span></button>`).join('');
      cards = [...ring.children]; N = count; step = 360 / N; front = -1; layout(); render(true);
    }
    function layout() {
      if (!cards.length) return;
      const w = cards[0].offsetWidth || 220; radius = Math.round(w / 2 / Math.tan(Math.PI / N) + w * .32);
      cards.forEach((c, i) => { c.style.transform = `rotateY(${i * step}deg) translateZ(${radius}px)`; });
      render(true);
    }
    const norm = a => ((a % 360) + 540) % 360 - 180;
    function render(force) {
      ring.style.transform = `translateZ(${-radius}px) rotateX(-6deg) rotateY(${-rot}deg)`;
      cards.forEach((c, i) => c.style.setProperty('--face', Math.cos(norm(i * step - rot) * Math.PI / 180).toFixed(3)));
      const f = ((Math.round(rot / step) % N) + N) % N;
      if (f !== front || force) {
        front = f; const p = items[f]; if (!p) return;
        cards.forEach((c, i) => c.classList.toggle('is-front', i === f));
        const esc = store().escapeHTML, available = Object.values(p.stock || {}).some(n => n > 0);
        caption.innerHTML = `<p class="orbit-cat">${esc(p.category)}${available ? '' : ' · esgotado'}</p><h3>${esc(p.name)}</h3><p class="orbit-price">${store().money(p.priceCents)}</p><button type="button" class="button light" data-orbit-open="${p.id}">Conhecer a peça <span aria-hidden="true"><svg class="ico" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg></span></button>`;
        if (ghost) ghost.textContent = p.name;
      }
    }
    function goTo(index) { snap = rot + norm(index * step - rot); vel = 0; idleUntil = performance.now() + 6000; if (reduce.matches) { rot = snap; snap = null; render(); } else kick(); }
    function loop(now) {
      raf = 0;
      if (!dragging) {
        if (Math.abs(vel) > .02) { rot += vel; vel *= .93; if (Math.abs(vel) <= .02) snap = Math.round(rot / step) * step; }
        else if (snap !== null) { rot += (snap - rot) * .1; if (Math.abs(snap - rot) < .05) { rot = snap; snap = null; } }
        else if (!reduce.matches && !hover && now > idleUntil) rot += .07;
      }
      render();
      if (inView && !document.hidden) raf = requestAnimationFrame(loop);
    }
    const kick = () => { if (!raf && inView) raf = requestAnimationFrame(loop); };
    const open = id => store()?.openProduct(Number(id));

    view.addEventListener('pointerdown', e => { if (e.button > 0) return; dragging = true; lastX = e.clientX; moved = 0; vel = 0; snap = null; view.setPointerCapture(e.pointerId); view.classList.add('is-dragging'); });
    view.addEventListener('pointermove', e => { if (!dragging) return; const dx = e.clientX - lastX; lastX = e.clientX; moved += Math.abs(dx); rot -= dx * .28; vel = -dx * .28; render(); });
    const end = (e, cancelled) => {
      if (!dragging) return; dragging = false; view.classList.remove('is-dragging'); idleUntil = performance.now() + 5000;
      if (!cancelled && moved < 6) {
        const card = document.elementFromPoint(e.clientX, e.clientY)?.closest('.orbit-card');
        if (card) { const i = Number(card.dataset.index); if (i === front) open(items[i].id); else goTo(i); return; }
      }
      if (Math.abs(vel) <= .02) snap = Math.round(rot / step) * step; kick();
    };
    view.addEventListener('pointerup', e => end(e, false)); view.addEventListener('pointercancel', e => end(e, true));
    view.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') hover = true; });
    view.addEventListener('pointerleave', () => { hover = false; });
    view.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(front - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goTo(front + 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(items[front].id); }
    });
    view.addEventListener('focus', () => { idleUntil = Infinity; }); view.addEventListener('blur', () => { idleUntil = performance.now() + 3000; });
    $('#orbit-prev').addEventListener('click', () => goTo(front - 1));
    $('#orbit-next').addEventListener('click', () => goTo(front + 1));
    caption.addEventListener('click', e => { const b = e.target.closest('[data-orbit-open]'); if (b) open(b.dataset.orbitOpen); });
    new IntersectionObserver(([e]) => { inView = e.isIntersecting; if (inView) kick(); }).observe(view);
    document.addEventListener('visibilitychange', kick);
    new ResizeObserver(() => layout()).observe(view);
    const init = () => { started = true; build(); kick(); };
    document.addEventListener('maevi:products', init);
    if (store()?.getProducts().length) init();
  }

  /* ---------- 7. Trio 3D da abertura: uma peça na frente e duas atrás ---------- */
  function heroTrio() {
    const trio = $('#hero-trio'); if (!trio) return;
    const cards = [...trio.querySelectorAll('.trio-card')];
    let pool = [], next = 0, timer = 0, visible = true;
    const order = ['left', 'center', 'right'];
    function fill() {
      const list = (window.MaeviStore?.getProducts() || []).filter(p => p.image && p.active !== false);
      const seen = new Set(); pool = [];
      for (const p of [...list].sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)))) { const key = p.colorGroup || 'p' + p.id; if (seen.has(key)) continue; seen.add(key); pool.push(p); }
      if (pool.length < 3) return;
      const byPos = Object.fromEntries(cards.map(c => [c.dataset.pos, c]));
      [['center', pool[0]], ['left', pool[1]], ['right', pool[2]]].forEach(([pos, p]) => setCard(byPos[pos], p));
      next = 3 % pool.length; schedule();
    }
    function setCard(card, p) { const img = card.querySelector('img'); img.src = p.image; img.alt = p.name; card.dataset.product = p.id; }
    function rotate() {
      // A da direita vem para a frente, a da frente vai para trás à esquerda, a da esquerda passa para trás à direita.
      for (const card of cards) { const i = order.indexOf(card.dataset.pos); card.dataset.pos = order[(i + 2) % 3]; }
      if (pool.length > 3) { const back = cards.find(c => c.dataset.pos === 'right'); setTimeout(() => { setCard(back, pool[next]); next = (next + 1) % pool.length; }, 700); }
    }
    function schedule() { clearInterval(timer); timer = 0; if (pool.length >= 3 && !reduce.matches && visible && !document.hidden) timer = setInterval(rotate, 5200); }
    trio.addEventListener('click', e => { const card = e.target.closest('.trio-card'); if (!card?.dataset.product) return; if (card.dataset.pos === 'center') window.MaeviStore?.openProduct(Number(card.dataset.product)); else { while (card.dataset.pos !== 'center') rotate(); schedule(); } });
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; schedule(); }).observe(trio);
    document.addEventListener('visibilitychange', schedule);
    document.addEventListener('maevi:products', fill);
    if (window.MaeviStore?.getProducts().length) fill();
  }

  silk(); heroScroll(); heroTrio(); marquee(); tilt(); cursor(); orbit();
})();
