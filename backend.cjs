const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {createDatabase}=require('./database.cjs');
const {Problem,fail}=require('./errors.cjs');
const commerce=require('./commerce.cjs');
const {createGateway}=require('./payments.cjs');
const images=require('./images.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const same = (a,b) => crypto.timingSafeEqual(Buffer.from(hash(a)),Buffer.from(hash(b)));
function createApp({ dataDir = path.join(__dirname,'data'), assetDir=path.join(__dirname,'assets'), adminKey, port=5173, now=Date.now, network=fetch, paymentEnv={}, paymentNetwork=network, seedProducts=[], mysql, publicOrigin='', publicAdmin=false, databaseImages=!!mysql }={}) {
  const payments=createGateway({env:paymentEnv,network:paymentNetwork,now});
  if(publicOrigin){const u=new URL(publicOrigin);if(u.protocol!=='https:'||u.origin!==publicOrigin||u.username||u.password||u.port||!u.hostname.includes('.')||/^(localhost|127\.|\[|\d+\.)/i.test(u.hostname))throw Error('Informe a origem HTTPS pública sem caminho ou barra final.');}
  if(publicAdmin&&(!publicOrigin||typeof adminKey!=='string'||!/^[a-f0-9]{48}$/.test(adminKey)))throw Error('O painel online exige origem HTTPS e chave administrativa de 48 caracteres hexadecimais.');
  fs.mkdirSync(dataDir,{recursive:true});
  fs.mkdirSync(assetDir,{recursive:true});
  const keyFile = path.join(dataDir,'admin-key.txt');
  if (!adminKey) {
    if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile,crypto.randomBytes(24).toString('hex'),{mode:0o600,flag:'wx'});
    adminKey=fs.readFileSync(keyFile,'utf8').trim();
    if(!/^[a-f0-9]{48}$/.test(adminKey))throw new Error('Chave local inválida. Restaure data/admin-key.txt a partir do seu backup privado.');
  }
  const db=createDatabase({dataDir,mysql});
  const ready=db.init(seedProducts,commerce.defaults,assetDir);
  const sessions=new Map(), limits=new Map();let rejectedHostLogs=0;
  const allProducts=async ()=>(await db.prepare('SELECT data FROM products ORDER BY id').all()).map(r=>JSON.parse(r.data));
  const getProduct=async id=>{const row=(await db.prepare('SELECT data FROM products WHERE id=?').get(id));return row ? JSON.parse(row.data):null;};
  const saveProduct=async p=>{p.version=(p.version||0)+1;return (await db.prepare('INSERT INTO products(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(p.id,JSON.stringify(p)));};
  const transaction=fn=>db.transaction(fn);
  const record=async (action,entity,id)=>(await db.prepare('INSERT INTO activity(at,action,entity,entity_id) VALUES(?,?,?,?)').run(new Date(now()).toISOString(),action,entity,String(id)));
  const getSettings=async ()=>JSON.parse((await db.prepare('SELECT data FROM settings WHERE key=?').get('store')).data);
  const getSetting=async key=>{const row=await db.prepare('SELECT data FROM settings WHERE key=?').get(key);return row?JSON.parse(row.data):null;};
  const putSetting=async (key,value)=>{if(await db.prepare('SELECT data FROM settings WHERE key=?').get(key))await db.prepare('UPDATE settings SET data=? WHERE key=?').run(JSON.stringify(value),key);else await db.prepare(db.kind==='mysql'?'INSERT INTO settings(`key`,data) VALUES(?,?)':'INSERT INTO settings(key,data) VALUES(?,?)').run(key,JSON.stringify(value));};
  const getCatalog=async()=>{const value=await getSetting('catalog');return value?{categories:value.categories,sizes:value.sizes,version:value.version}:{...commerce.catalogDefaults,version:0};};
  const scrypt=(password,salt)=>new Promise((resolve,reject)=>crypto.scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:67108864},(error,key)=>error?reject(error):resolve(key)));
  async function passwordMatches(password,owner){if(typeof password!=='string'||password.length>200||!owner?.hash)return false;const key=await scrypt(password,Buffer.from(owner.salt,'hex'));return crypto.timingSafeEqual(key,Buffer.from(owner.hash,'hex'));}
  const getCoupon=async code=>{const row=(await db.prepare('SELECT data FROM coupons WHERE code=?').get(code));return row?JSON.parse(row.data):null;};
  const saveCoupon=async c=>(await db.prepare('INSERT INTO coupons(code,data) VALUES(?,?) ON CONFLICT(code) DO UPDATE SET data=excluded.data').run(c.code,JSON.stringify(c)));
  async function restore(order){
    for(const item of order.items){const p=(await getProduct(item.id));if(p&&Object.hasOwn(p.stock,item.size)){p.stock[item.size]+=item.quantity;(await saveProduct(p));}}
    if(order.coupon?.code){const c=(await getCoupon(order.coupon.code));if(c&&c.used>0){c.used--;(await saveCoupon(c));}}
  }
  async function changeOrder(order,status){
    if(['demo_cancelled','demo_expired'].includes(status))(await restore(order));
    order.history=order.history||[{status:order.status,at:order.createdAt}];order.status=status;order.updatedAt=new Date(now()).toISOString();order.history.push({status,at:order.updatedAt});
    (await db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify(order),order.id));(await record(status,'order',order.id));return order;
  }
  let sweeping=false;
  async function sweepPayments(){
    if(sweeping||!payments.options().configured)return 0;sweeping=true;let done=0;
    try{
      const rows=(await db.prepare("SELECT data FROM orders WHERE json_extract(data,'$.status')='demo_payment_pending' LIMIT 200").all()).map(r=>JSON.parse(r.data)).filter(o=>Date.parse(o.payment?.expiresAt)+10*60000<=now()).slice(0,5);
      for(const o of rows){try{await reconcile(o.id);done++;}catch{}}
    }finally{sweeping=false;}
    return done;
  }
  async function runMaintenance(){
    return (await transaction(async()=>{const rows=(await db.prepare("SELECT data FROM orders WHERE json_extract(data,'$.status')='demo_received' AND json_extract(data,'$.reservationExpiresAt')<=? LIMIT 200").all(new Date(now()).toISOString()));for(const row of rows)(await changeOrder(JSON.parse(row.data),'demo_expired'));return rows.length;}));
  }
  const readOrder=async id=>{if(typeof id!=='string'||!/^MV-[A-F0-9]{16}$/.test(id))return null;const row=(await db.prepare('SELECT data FROM orders WHERE id=?').get(id));return row?JSON.parse(row.data):null;};
  const saveOrder=async o=>(await db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify(o),o.id));
  async function startPayment(id){
    if(!payments.options().configured)fail(503,'Pagamentos indisponíveis no momento. Nenhuma cobrança foi criada.');
    const order=(await transaction(async()=>{
      const o=(await readOrder(id));
      if(o.payment?.checkoutUrl&&o.status==='demo_payment_pending'&&Date.parse(o.payment.expiresAt)>now())return o;
      if(o.status!=='demo_received'||Date.parse(o.reservationExpiresAt)<=now())fail(409,'Este pedido não permite iniciar outro checkout. Atualize a situação.');
      o.payment={provider:'mercado_pago',mode:payments.options().mode,status:'creating'};(await changeOrder(o,'demo_payment_pending'));return o;
    }));
    if(order.payment.checkoutUrl)return {order,session:{url:order.payment.checkoutUrl}};
    try{
      const session=await payments.createSession(order);
      return (await transaction(async()=>{const current=(await readOrder(id));current.payment=session;(await saveOrder(current));(await record('payment_session','order',id));return {order:current,session:{url:session.checkoutUrl}};}));
    }catch(e){(await transaction(async()=>{const current=(await readOrder(id));current.payment.status='review';(await changeOrder(current,'demo_payment_review'));}));throw e;}
  }
  async function applyPayment(payment){
    const snapshot=(await readOrder(payment.external_reference));
    if(!snapshot)return false;
    if(!snapshot.payment?.preferenceId)fail(503,'Sessão ainda sendo registrada. Reenvie a notificação.');
    await payments.checkPayment(payment,snapshot);
    (await transaction(async()=>{
      const order=(await readOrder(snapshot.id)),p=order.payment;
      const updated=Date.parse(payment.date_last_updated||payment.date_created);
      if(!Number.isFinite(updated))fail(409,'Pagamento sem data válida.');
      if(p.paymentId&&p.paymentId!==String(payment.id)&&p.status==='approved'){
        if(payment.status==='approved')(await changeOrder(order,'demo_payment_review'));return;
      }
      if(p.paymentId===String(payment.id)&&p.providerUpdatedAt&&updated<Date.parse(p.providerUpdatedAt))return;
      const status=payment.status;
      if(!['approved','pending','in_process','authorized','rejected','cancelled','refunded','charged_back','in_mediation'].includes(status))fail(409,'Situação de pagamento desconhecida.');
      // Uma recusa em outra tentativa não apaga a aprovação já confirmada.
      if(p.status==='approved'&&['pending','in_process','authorized','rejected','cancelled'].includes(status))return;
      const previous=p.status;
      Object.assign(p,{status,paymentId:String(payment.id),providerUpdatedAt:new Date(updated).toISOString(),checkedAt:new Date(now()).toISOString()});
      if(['refunded','charged_back','in_mediation'].includes(status)||Number(payment.transaction_amount_refunded||0)>0){if(order.status!=='demo_payment_review')(await changeOrder(order,'demo_payment_review'));else (await saveOrder(order));}
      else if(status==='approved'&&previous!=='approved'){
        if(order.status!=='demo_payment_pending'||Date.parse(p.expiresAt)<Date.parse(payment.date_approved||payment.date_created))(await changeOrder(order,'demo_payment_review'));else (await changeOrder(order,'demo_paid'));
      }else (await saveOrder(order));
    }));
    return true;
  }
  async function reconcile(id){
    const order=(await readOrder(id));
    if(order.payment?.preferenceId){
      const candidates=await payments.findPayments(order);
      for(const candidate of candidates)await applyPayment(await payments.getPayment(candidate.id));
      // Checkout vencido: sem pagamento em andamento, a reserva volta ao estoque; pagamento ainda pendente após 24 h vai para conferência.
      (await transaction(async()=>{const current=(await readOrder(id));if(current.status!=='demo_payment_pending')return;const expires=Date.parse(current.payment.expiresAt);if(!(expires+10*60000<=now()))return;
        const open=candidates.some(c=>['pending','in_process','authorized','approved'].includes(c.status));
        if(!open)(await changeOrder(current,'demo_expired'));else if(expires+24*60*60000<=now())(await changeOrder(current,'demo_payment_review'));}));
    }
    return (await readOrder(id));
  }
  const postalCache=new Map();
  async function postalLookup(value){
    const code=commerce.cep(value),cached=postalCache.get(code);if(cached&&cached.until>now())return cached.data;
    try{
      const response=await network(`https://viacep.com.br/ws/${code}/json/`,{signal:AbortSignal.timeout(7000),redirect:'error',headers:{Accept:'application/json'}});
      if(!response.ok)fail(503,'Consulta de CEP indisponível. Preencha o endereço manualmente.');
      let size=0,chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>16384)fail(502,'Resposta do serviço de CEP inválida.');chunks.push(Buffer.from(chunk));}
      const data=JSON.parse(Buffer.concat(chunks).toString());if(data.erro)fail(404,'CEP não encontrado. Confira os números ou preencha manualmente.');
      const result={cep:code,street:commerce.text(data.logradouro||'','Rua',150,true),district:commerce.text(data.bairro||'','Bairro',100,true),city:commerce.text(data.localidade,'Cidade',100),state:commerce.text(data.uf,'UF',2)};
      if(!commerce.states.has(result.state))fail(502,'Resposta do serviço de CEP inválida.');
      if(postalCache.size>=500)postalCache.delete(postalCache.keys().next().value);postalCache.set(code,{data:result,until:now()+24*60*60*1000});return result;
    }catch(error){if(error instanceof Problem)throw error;fail(503,'Não foi possível consultar o CEP. Você pode preencher o endereço manualmente.');}
  }
  function text(value,label,max=200){if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))fail(400,`${label} inválido.`);return value.trim();}
  async function quote(items,{coupon:code='',shipping:shippingInput,customer}={}) {
    if(!Array.isArray(items)||!items.length||items.length>50)fail(400,'Sua sacola precisa ter de 1 a 50 itens.');
    const normalized=new Map();
    for(const item of items){
      if(!item||!Number.isSafeInteger(item.id)||item.id<1||typeof item.size!=='string'||!item.size||item.size.length>10||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>20)fail(400,'Item ou quantidade inválida.');
      const key=`${item.id}:${item.size}`, previous=normalized.get(key);
      normalized.set(key,{id:item.id,size:item.size,quantity:item.quantity+(previous?.quantity||0)});
    }
    const lines=[];for(const item of normalized.values()){
      const p=(await getProduct(item.id));
      if(!p||!p.active)fail(409,'Uma peça não está mais disponível. Atualize sua sacola.');
      if(item.quantity>20||!Object.hasOwn(p.stock,item.size)||!(p.stock[item.size]>=item.quantity))fail(409,`Estoque insuficiente: ${p.name}, tamanho ${item.size}.`);
      lines.push({...item,name:p.name,color:p.color,unitCents:p.priceCents,lineCents:p.priceCents*item.quantity});
    }
    const subtotalCents=lines.reduce((sum,item)=>sum+item.lineCents,0);
    let discountCents=0,applied=null;
    if(code){if(typeof code!=='string'||!/^[A-Za-z0-9_-]{3,30}$/.test(code))fail(400,'Cupom inválido.');const c=(await getCoupon(code.toUpperCase()));
      if(!c||!c.active||(c.expiresAt&&Date.parse(c.expiresAt)<=now())||c.used>=c.maxUses)fail(409,'Cupom indisponível ou expirado.');
      if(subtotalCents<c.minCents)fail(409,'O valor da sacola não atinge o mínimo deste cupom.');
      if(c.firstPurchase){
        const email=typeof customer?.email==='string'?customer.email.trim().toLowerCase():'';
        if(!email)fail(409,'Este cupom vale para a primeira compra. Informe seu e-mail na primeira etapa.');
        const previous=(await db.prepare('SELECT data FROM orders').all()).map(r=>JSON.parse(r.data)).some(o=>o.customer?.email?.toLowerCase()===email&&!['demo_cancelled','demo_expired'].includes(o.status));
        if(previous)fail(409,'Este cupom vale só para a primeira compra.');
      }discountCents=Math.floor(subtotalCents*c.percent/100);applied={code:c.code,percent:c.percent};
    }
    const store=(await getSettings()),delivery=commerce.shipping(shippingInput,store,subtotalCents-discountCents);
    return {items:lines,subtotalCents,discountCents,coupon:applied,shippingCents:delivery.priceCents,totalCents:subtotalCents-discountCents+delivery.priceCents,shipping:delivery,fulfillment:delivery.method==='pickup'?'demo_pickup':'demo_delivery',mode:'live',settingsVersion:store.version};
  }
  async function body(req){
    if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']||''))fail(415,'Envie JSON UTF-8.');
    if(req.headers['content-encoding']&&req.headers['content-encoding']!=='identity')fail(415,'Conteúdo comprimido não é aceito.');
    if(req.headers['content-length']&&(!/^\d+$/.test(req.headers['content-length'])||Number(req.headers['content-length'])>32768))fail(413,'Conteúdo muito grande.');
    let size=0, chunks=[];
    for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>32768)fail(413,'Conteúdo muito grande.');chunks.push(Buffer.from(chunk));}
    try{const input=JSON.parse(Buffer.concat(chunks).toString());if(!input||Array.isArray(input)||typeof input!=='object')fail(400,'JSON inválido.');return input;}catch{fail(400,'JSON inválido.');}
  }
  const send=(res,status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(data));};
  const sessionToken=req=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('maevi_session='))?.slice(14);
  function authenticated(req){const token=sessionToken(req),key=token?hash(token):'',session=sessions.get(key),time=now();if(!session||session.expires<=time||session.lastSeen+30*60*1000<=time){sessions.delete(key);fail(401,'Entre no painel para continuar.');}session.lastSeen=time;return session;}
  function rate(req,group,max){
    const time=now();for(const [key,entry] of limits)if(entry.until<=time)limits.delete(key);
    const key=`${req.socket?.remoteAddress||'local'}:${group}`,entry=limits.get(key)||{count:0,until:time+60000};entry.count++;limits.set(key,entry);if(entry.count>max)fail(429,'Muitas tentativas. Aguarde um minuto.');
  }
  function validateProduct(input,id,catalog){
    const p={id,name:text(input.name,'Nome',100),category:input.category,color:text(input.color,'Cor',60),hex:input.hex,description:text(input.description,'Descrição',2000),image:text(input.image,'Imagem',500),priceCents:input.priceCents,stock:input.stock,active:input.active};
    if(!catalog.categories.includes(p.category)||typeof p.hex!=='string'||!/^#[0-9a-f]{6}$/i.test(p.hex)||!Number.isInteger(p.priceCents)||p.priceCents<1||p.priceCents>10000000||typeof p.active!=='boolean')fail(400,'Categoria, preço, cor ou disponibilidade inválidos.');
    if(!p.stock||typeof p.stock!=='object'||!catalog.sizes.every(s=>Object.hasOwn(p.stock,s)&&Number.isInteger(p.stock[s])&&p.stock[s]>=0&&p.stock[s]<=10000))fail(400,'Informe o estoque por tamanho.');
    if(!/^https:\/\/images\.unsplash\.com\/[^\s"<>]+$/.test(p.image)&&!/^\/assets\/[a-zA-Z0-9._-]+\.(png|jpg|jpeg|webp)$/.test(p.image))fail(400,'Use uma imagem em /assets/ ou HTTPS do images.unsplash.com.');
    const optionalText=(value,label,max)=>value===undefined||value===''?'':text(value,label,max);
    p.secondaryImage=optionalText(input.secondaryImage,'Segunda imagem',500);p.material=optionalText(input.material,'Composição',600);p.care=optionalText(input.care,'Cuidados',600);p.measurements=optionalText(input.measurements,'Medidas',2000);
    p.featured=input.featured===undefined?false:input.featured;if(typeof p.featured!=='boolean')fail(400,'Destaque inválido.');
    if(p.secondaryImage&&!/^https:\/\/images\.unsplash\.com\/[^\s"<>]+$/.test(p.secondaryImage)&&!/^\/assets\/[a-zA-Z0-9._-]+\.(png|jpg|jpeg|webp)$/.test(p.secondaryImage))fail(400,'Segunda imagem inválida. Use /assets/ ou images.unsplash.com.');
    p.stock=Object.fromEntries(catalog.sizes.map(s=>[s,p.stock[s]]));
    // Compre o look: até 6 peças que combinam.
    const look=input.look===undefined?[]:input.look;
    if(!Array.isArray(look)||look.length>6||!look.every(v=>Number.isSafeInteger(v)&&v>0&&v!==id))fail(400,'Escolha até 6 peças para o look.');
    p.look=[...new Set(look)];
    // Cores da mesma peça: produtos com o mesmo grupo aparecem juntos na ficha.
    p.colorGroup=input.colorGroup===undefined||input.colorGroup===''?'':input.colorGroup;
    if(typeof p.colorGroup!=='string'||(p.colorGroup&&!/^[a-z0-9-]{1,40}$/.test(p.colorGroup)))fail(400,'Grupo de cores inválido.');
    // Tabela de medidas por tamanho.
    p.sizeChart=null;const chart=input.sizeChart;
    if(chart!==undefined&&chart!==null){
      const cell=(v,max)=>typeof v==='string'&&v.length<=max&&!/[<>\x00-\x1f]/.test(v);
      if(typeof chart!=='object'||!Array.isArray(chart.columns)||chart.columns.length<1||chart.columns.length>6||!chart.columns.every(c=>cell(c,20)&&c.trim())||!chart.rows||typeof chart.rows!=='object'||Array.isArray(chart.rows))fail(400,'Tabela de medidas inválida.');
      const rows={};for(const [size,values] of Object.entries(chart.rows)){if(!catalog.sizes.includes(size))continue;if(!Array.isArray(values)||values.length!==chart.columns.length||!values.every(v=>cell(v,12)))fail(400,'Tabela de medidas inválida.');if(values.some(v=>v.trim()))rows[size]=values.map(v=>v.trim());}
      if(Object.keys(rows).length)p.sizeChart={columns:chart.columns.map(c=>c.trim()),rows};
    }
    return p;
  }
  const OPEN_ORDER=['demo_received','demo_payment_pending','demo_payment_review','demo_paid','demo_preparing','demo_ready'];
  async function removeUnusedImages(candidates){
    const used=new Set((await allProducts()).flatMap(p=>[p.image,p.secondaryImage]));
    for(const src of new Set(candidates)){
      const match=/^\/assets\/(upload-[a-f0-9]{24}\.(?:jpg|png|webp))$/.exec(src||'');if(!match||used.has(src))continue;
      if(databaseImages)await db.prepare('DELETE FROM images WHERE name=?').run(match[1]);
      else{try{fs.unlinkSync(path.join(assetDir,match[1]));}catch{}}
    }
  }
  async function publicStore(){
    const store=await getSettings(),{welcomeCoupon,...rest}=store;let welcome=null;
    if(store.welcomeEnabled&&welcomeCoupon){const c=await getCoupon(welcomeCoupon);if(c&&c.active&&!(c.expiresAt&&Date.parse(c.expiresAt)<=now())&&c.used<c.maxUses)welcome={percent:c.percent,minCents:c.minCents};}
    return {...rest,welcome};
  }
  async function handler(req,res){
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Cross-Origin-Resource-Policy','same-origin');res.setHeader('Cross-Origin-Opener-Policy','same-origin');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; script-src-attr 'none'; object-src 'none'; style-src 'self' https://fonts.googleapis.com; style-src-attr 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://images.unsplash.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try{
      await ready;
      await ready;
      const localHosts=[`127.0.0.1:${port}`,`localhost:${port}`];
      const deployedOrigin=publicOrigin||(payments.options().configured?payments.origin:'');
      const publicHost=deployedOrigin?new URL(deployedOrigin).host:'';
      const allowedHosts=[...localHosts,...(publicHost?[publicHost]:[])];
      let requestHost=typeof req.headers.host==='string'?req.headers.host.toLowerCase():'';
      if(publicHost&&requestHost===publicHost+':443')requestHost=publicHost;
      if(!allowedHosts.includes(requestHost)){
        if(rejectedHostLogs<3){rejectedHostLogs++;const safe=value=>typeof value==='string'?value.slice(0,253).replace(/[^a-zA-Z0-9.:[\]-]/g,'_'):'ausente';console.error('MAÉVI [HOST_REJECTED]: recebido='+safe(req.headers.host)+'; permitido='+safe(publicHost||'somente-local')+'; proxy='+safe(req.headers['x-forwarded-host'])+'; origem-conexao='+safe(req.socket?.remoteAddress));}
        fail(403,'Endereço da loja não permitido.');
      }
      const expectedOrigin=requestHost===publicHost?deployedOrigin:'http://'+requestHost;
      if(req.headers.origin&&req.headers.origin!==expectedOrigin)fail(403,'Origem não permitida.');
      if(typeof req.url!=='string'||!req.url.startsWith('/')||req.url.startsWith('//')||req.url.includes('\\')||req.url.length>2048)fail(400,'Endereço inválido.');
      const url=new URL(req.url,'http://'+requestHost), route=url.pathname;
      if(publicOrigin&&requestHost===publicHost){
        res.setHeader('Strict-Transport-Security','max-age=31536000');
        if(req.headers['x-forwarded-proto']==='http'){res.writeHead(308,{Location:publicOrigin+req.url,'Cache-Control':'no-store'});return res.end();}
      }
      const onlineAdmin=publicAdmin&&requestHost===publicHost;
      if((route.startsWith('/admin')||route.startsWith('/api/admin')||['/admin.html','/admin.js','/admin.css','/operations.js'].includes(route))&&!onlineAdmin&&(!localHosts.includes(requestHost)||req.headers['x-forwarded-for']||req.headers['forwarded']||req.headers['x-forwarded-host']))fail(403,'Painel disponível somente no computador da loja.');
      const secureCookie=requestHost===publicHost?'; Secure':'';
      if(route==='/api/payments/mercadopago/webhook'&&req.method==='POST'){
        res.setHeader('Cache-Control','no-store');rate(req,'webhook',120);
        const paymentId=payments.verifyNotification(req.headers,url);const input=await body(req);
        if(input.type!=='payment'||String(input.data?.id)!==paymentId)fail(400,'Notificação de pagamento inconsistente.');
        await applyPayment(await payments.getPayment(paymentId));return send(res,200,{received:true});
      }
      if(route.startsWith('/api/')){
        res.setHeader('Cache-Control','no-store');
        if(req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))fail(403,'Requisição de outra página bloqueada.');
        rate(req,'api',240);
        if(!['GET','POST','PUT','PATCH','DELETE'].includes(req.method))fail(405,'Método não permitido.');
        if(req.method!=='GET'&&req.headers['x-maevi-request']!=='1')fail(403,'Atualize a página da loja antes de continuar.');
        (await runMaintenance());
        if(req.method==='GET'&&route==='/api/health')return send(res,200,{ok:true,mode:'live'});
        if(req.method==='GET'&&route==='/api/products'){const catalog=await getCatalog();return send(res,200,{products:(await allProducts()).filter(p=>p.active),catalog:{categories:catalog.categories,sizes:catalog.sizes},mode:'live'});}
        if(req.method==='GET'&&route==='/api/store')return send(res,200,{store:await publicStore(),mode:'live',payment:payments.options()});
        if(req.method==='GET'&&/^\/api\/postal-code\/\d{8}$/.test(route)){rate(req,'postal',20);return send(res,200,{address:await postalLookup(route.split('/').pop())});}
        if(req.method==='POST'&&route==='/api/alerts'){
          rate(req,'alerts',10);const input=await body(req);
          if(input.consent!==true)fail(400,'Autorize o aviso para continuar.');
          const p=Number.isSafeInteger(input.productId)?await getProduct(input.productId):null;if(!p||!p.active)fail(404,'Peça não encontrada.');
          if(typeof input.size!=='string'||!Object.hasOwn(p.stock,input.size))fail(400,'Escolha o tamanho.');
          const who=commerce.contact(input.contact);
          const result=await transaction(async()=>{
            const existing=(await db.prepare('SELECT data FROM alerts').all()).map(r=>JSON.parse(r.data)).find(a=>a.status==='pending'&&a.productId===p.id&&a.size===input.size&&a.contact===who.value);
            if(existing)return existing;
            const count=Number((await db.prepare('SELECT COUNT(*) AS n FROM alerts').get()).n);if(count>=5000)fail(409,'Não foi possível registrar agora. Fale com a loja pelo WhatsApp.');
            const a={id:'AV-'+crypto.randomBytes(8).toString('hex').toUpperCase(),productId:p.id,productName:p.name,color:p.color,size:input.size,contact:who.value,type:who.type,status:'pending',createdAt:new Date(now()).toISOString()};
            await db.prepare('INSERT INTO alerts(id,data) VALUES(?,?)').run(a.id,JSON.stringify(a));return a;
          });
          return send(res,201,{ok:true,size:result.size});
        }
        if(req.method==='POST'&&route==='/api/subscribers'){
          rate(req,'subscribers',10);const input=await body(req);
          if(input.consent!==true)fail(400,'Autorize o cadastro para receber o cupom.');
          const who=commerce.contact(input.email);if(who.type!=='email')fail(400,'Informe um e-mail válido.');
          await transaction(async()=>{
            const row=await db.prepare('SELECT data FROM subscribers WHERE email=?').get(who.value);if(row)return;
            const count=Number((await db.prepare('SELECT COUNT(*) AS n FROM subscribers').get()).n);if(count>=20000)fail(409,'Não foi possível cadastrar agora.');
            await db.prepare('INSERT INTO subscribers(email,data) VALUES(?,?)').run(who.value,JSON.stringify({email:who.value,createdAt:new Date(now()).toISOString(),source:'welcome'}));
          });
          const store=await getSettings();let coupon=null;
          if(store.welcomeEnabled&&store.welcomeCoupon){const c=await getCoupon(store.welcomeCoupon);if(c&&c.active&&!(c.expiresAt&&Date.parse(c.expiresAt)<=now())&&c.used<c.maxUses)coupon={code:c.code,percent:c.percent,minCents:c.minCents,firstPurchase:c.firstPurchase};}
          return send(res,201,{ok:true,coupon});
        }
        if(req.method==='POST'&&route==='/api/quote'){rate(req,'quote',120);const input=await body(req);return send(res,200,(await quote(input.items,input)));}
        if(req.method==='POST'&&route==='/api/orders'){
          rate(req,'orders',30);const input=await body(req);
          const idem=req.headers['idempotency-key'];if(typeof idem!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(idem))fail(400,'Chave da tentativa inválida.');
          if(!payments.options().configured)fail(503,'Pagamentos indisponíveis no momento. Fale com a loja pelo WhatsApp.');
          if(!['demo_pickup','demo_delivery'].includes(input.fulfillment)||input.demoAccepted!==true)fail(400,'Confirme que leu a política de trocas e devoluções.');
          const customer={name:text(input.customer?.name,'Nome',100),email:text(input.customer?.email,'E-mail',254)};
          if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email))fail(400,'Informe um e-mail válido.');
          const shippingInput=input.shipping||{method:input.fulfillment==='demo_delivery'?'delivery':'pickup'};
          if((input.fulfillment==='demo_delivery')!==(shippingInput.method==='delivery'))fail(400,'Forma de recebimento inconsistente.');
          if(input.checkoutVersion===2||input.customer?.phone)customer.phone=commerce.phone(input.customer?.phone,false);
          const deliveryAddress=shippingInput.method==='delivery'?commerce.address(input.address):null;
          if(deliveryAddress&&deliveryAddress.cep!==commerce.cep(shippingInput.cep))fail(400,'CEP do endereço diferente do CEP cotado.');
          const fingerprint=hash(JSON.stringify({items:input.items,customer,...(input.checkoutVersion===2||input.shipping||input.coupon?{shipping:shippingInput,address:deliveryAddress,coupon:input.coupon||''}:{})}));
          const result=(await transaction(async()=>{
            const existing=(await db.prepare('SELECT * FROM orders WHERE idem=?').get(idem));
            if(existing){if(existing.fingerprint!==fingerprint)fail(409,'Esta tentativa já foi usada para outro pedido.');return {order:JSON.parse(existing.data),token:existing.token,reused:true};}
            const totals=(await quote(input.items,{...input,shipping:shippingInput}));
            if(input.expectedTotalCents!==undefined&&input.expectedTotalCents!==totals.totalCents)fail(409,'O total foi atualizado. Confira novamente os valores antes de confirmar.');
            if(input.expectedSettingsVersion!==undefined&&input.expectedSettingsVersion!==totals.settingsVersion)fail(409,'As condições de entrega mudaram. Volte à etapa de recebimento e confira novamente.');
            if(totals.coupon){const c=(await getCoupon(totals.coupon.code));c.used++;(await saveCoupon(c));}
            for(const item of totals.items){const p=(await getProduct(item.id));p.stock[item.size]-=item.quantity;(await saveProduct(p));}
            const createdAt=new Date(now()).toISOString();
            const order={id:'MV-'+crypto.randomBytes(8).toString('hex').toUpperCase(),createdAt,status:'demo_received',history:[{status:'demo_received',at:createdAt}],customer,...totals,address:deliveryAddress,reservationExpiresAt:new Date(now()+(await getSettings()).reservationMinutes*60000).toISOString(),payment:{status:'not_requested',provider:null}};
            const token=crypto.randomBytes(24).toString('hex');
            (await db.prepare('INSERT INTO orders(id,idem,fingerprint,token,data) VALUES(?,?,?,?,?)').run(order.id,idem,fingerprint,token,JSON.stringify(order)));(await record('created','order',order.id));return {order,token,reused:false};
          }));
          return send(res,result.reused?200:201,result);
        }
        if(req.method==='GET'&&/^\/api\/orders\/MV-[A-F0-9]{16}$/.test(route)){
          rate(req,'lookup',60);const row=(await db.prepare('SELECT * FROM orders WHERE id=?').get(route.split('/').pop()));
          if(!row||typeof req.headers['x-order-token']!=='string'||!same(req.headers['x-order-token'],row.token))fail(404,'Pedido não encontrado.');
          return send(res,200,{order:JSON.parse(row.data)});
        }
        if(req.method==='POST'&&/^\/api\/orders\/MV-[A-F0-9]{16}\/(cancel|payment-session|payment-refresh)$/.test(route)){
          rate(req,'order-action',30);const parts=route.split('/'),row=(await db.prepare('SELECT * FROM orders WHERE id=?').get(parts[3]));
          if(!row||typeof req.headers['x-order-token']!=='string'||!same(req.headers['x-order-token'],row.token))fail(404,'Pedido não encontrado.');
          await body(req);const order=JSON.parse(row.data);
          if(parts[4]==='payment-session')return send(res,200,await startPayment(order.id));
          if(parts[4]==='payment-refresh')return send(res,200,{order:await reconcile(order.id)});
          return send(res,200,{order:(await transaction(async()=>{const current=JSON.parse((await db.prepare('SELECT data FROM orders WHERE id=?').get(order.id)).data);if(current.status!=='demo_received')fail(409,'Este pedido não pode mais ser cancelado por aqui.');return (await changeOrder(current,'demo_cancelled'));}))});
        }
        if(route==='/api/admin/login'&&req.method==='POST'){
          rate(req,'login',10);const input=await body(req);let method;
          if(typeof input.email==='string'||typeof input.password==='string'){
            const owner=await getSetting('owner'),email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
            const valid=owner&&email===owner.email&&(await passwordMatches(input.password,owner));
            if(!owner)await scrypt('timing-placeholder',crypto.randomBytes(16));
            if(!valid)fail(401,'E-mail ou senha incorretos.');method='password';
          }else{if(typeof input.key!=='string'||!same(input.key,adminKey))fail(401,'Chave de acesso inválida.');method='key';}
          for(const [key,session] of sessions)if(session.expires<=now()||session.lastSeen+30*60*1000<=now())sessions.delete(key);
          const previous=sessionToken(req);if(previous)sessions.delete(hash(previous));
          if(sessions.size>=32)sessions.delete(sessions.keys().next().value);
          const token=crypto.randomBytes(32).toString('hex');sessions.set(hash(token),{expires:now()+8*60*60*1000,lastSeen:now(),method});
          return send(res,200,{ok:true,method},{'Set-Cookie':`maevi_session=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=28800${secureCookie}`});
        }
        if(route.startsWith('/api/admin/')){
          const session=authenticated(req),currentToken=hash(sessionToken(req));
          if(route==='/api/admin/images'&&req.method==='POST'){
            rate(req,'upload',10);const type=req.headers['content-type'];if(!['image/jpeg','image/png','image/webp'].includes(type))fail(415,'Envie uma imagem JPG, PNG ou WebP.');
            if(Number(req.headers['content-length']||0)>4194304)fail(413,'A foto deve ter no máximo 4 MB.');
            let size=0,chunks=[];for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>4194304)fail(413,'A foto deve ter no máximo 4 MB.');chunks.push(Buffer.from(chunk));}
            const bytes=Buffer.concat(chunks),info=images.inspect(bytes,type);
            if(databaseImages){
              const name=`upload-${crypto.randomBytes(12).toString('hex')}.${info.extension}`;
              await transaction(async()=>{const usage=await db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(bytes),0) AS total FROM images').get();if(Number(usage.count)>=400||Number(usage.total)+bytes.length>104857600)fail(409,'Limite de fotos atingido (100 MB ou 400 arquivos).');await db.prepare('INSERT INTO images(name,type,bytes,data) VALUES(?,?,?,?)').run(name,type,bytes.length,bytes);await record('uploaded','image',name);});
              return send(res,201,{image:'/assets/'+name,width:info.width,height:info.height});
            }
            const directory=assetDir;const files=fs.readdirSync(directory).filter(name=>/^upload-[a-f0-9]+\.(jpg|png|webp)$/.test(name));
            if(files.length>=400||files.reduce((sum,name)=>sum+fs.statSync(path.join(directory,name)).size,0)+bytes.length>104857600)fail(409,'Limite local de fotos atingido (100 MB ou 400 arquivos).');
            const name=`upload-${crypto.randomBytes(12).toString('hex')}.${info.extension}`;
            fs.writeFileSync(path.join(directory,name),bytes,{flag:'wx'});(await record('uploaded','image',name));return send(res,201,{image:'/assets/'+name,width:info.width,height:info.height});
          }
          if(route==='/api/admin/logout'&&req.method==='POST'){sessions.delete(hash(sessionToken(req)));return send(res,200,{ok:true},{'Set-Cookie':'maevi_session=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0'+secureCookie});}
          if(route==='/api/admin/account'&&req.method==='GET'){const owner=await getSetting('owner');return send(res,200,{account:{email:owner?.email||'',configured:Boolean(owner),updatedAt:owner?.updatedAt||null},session:{method:session.method}});}
          if(route==='/api/admin/account'&&req.method==='PUT'){
            rate(req,'account',10);const input=await body(req),owner=await getSetting('owner');
            if(owner&&session.method!=='key'&&!(await passwordMatches(input.currentPassword,owner)))fail(401,'Senha atual incorreta.');
            const email=commerce.ownerEmail(input.email),password=commerce.ownerPassword(input.password,email);
            const salt=crypto.randomBytes(16);const value={email,salt:salt.toString('hex'),hash:(await scrypt(password,salt)).toString('hex'),updatedAt:new Date(now()).toISOString(),version:(owner?.version||0)+1};
            await transaction(async()=>{await putSetting('owner',value);await record(owner?'updated':'created','account','owner');});
            for(const key of sessions.keys())if(key!==currentToken)sessions.delete(key);
            return send(res,200,{account:{email,configured:true,updatedAt:value.updatedAt}});
          }
          if(route==='/api/admin/catalog'&&req.method==='GET')return send(res,200,{catalog:await getCatalog()});
          if(route==='/api/admin/catalog'&&req.method==='PUT'){
            const input=await body(req);const catalog=await transaction(async()=>{
              const current=await getCatalog();if(input.version!==current.version)fail(409,'Categorias ou tamanhos mudaram. Atualize os dados antes de salvar.');
              const next=commerce.catalog(input,current),list=await allProducts(),changed=new Set();
              for(const p of list){
                const category=next.renames.categories[p.category]??p.category;
                if(category!==p.category){p.category=category;changed.add(p);}
                const stock={};for(const [size,count] of Object.entries(p.stock)){const target=next.renames.sizes[size]??size;stock[target]=(stock[target]||0)+count;}
                if(JSON.stringify(stock)!==JSON.stringify(p.stock)){p.stock=stock;changed.add(p);}
              }
              const missingCategory=list.find(p=>!next.categories.includes(p.category));
              if(missingCategory)fail(409,`A categoria "${missingCategory.category}" ainda tem peças (ex.: ${missingCategory.name}). Mude a categoria dessas peças antes de removê-la.`);
              for(const p of list){
                const removed=Object.keys(p.stock).filter(size=>!next.sizes.includes(size));
                const stocked=removed.find(size=>p.stock[size]>0);if(stocked)fail(409,`O tamanho ${stocked} ainda tem estoque na peça ${p.name}. Zere o estoque antes de removê-lo.`);
                const stock=Object.fromEntries(next.sizes.map(size=>[size,Number.isInteger(p.stock[size])?p.stock[size]:0]));
                if(JSON.stringify(stock)!==JSON.stringify(p.stock)){p.stock=stock;changed.add(p);}
              }
              for(const p of changed)await saveProduct(p);
              const value={categories:next.categories,sizes:next.sizes,version:current.version+1};await putSetting('catalog',value);await record('updated','catalog','catalog');return value;
            });return send(res,200,{catalog});
          }
          if(route==='/api/admin/products'&&req.method==='GET')return send(res,200,{products:(await allProducts())});
          if(route==='/api/admin/products'&&req.method==='POST'){
            const input=await body(req);const p=(await transaction(async()=>{const id=Number((await db.prepare('SELECT COALESCE(MAX(id),0)+1 AS id FROM products').get()).id);const value=validateProduct(input,id,(await getCatalog()));(await saveProduct(value));(await record('created','product',id));return value;}));return send(res,201,{product:p});
          }
          if(/^\/api\/admin\/products\/\d+$/.test(route)&&req.method==='PUT'){
            const id=Number(route.split('/').pop()),input=await body(req);const p=(await transaction(async()=>{const current=(await getProduct(id));if(!current)fail(404,'Peça não encontrada.');if(input.version!==(current.version||0))fail(409,'Esta peça mudou desde a abertura. Feche a edição, atualize os dados e tente novamente.');const value=validateProduct(input,id,(await getCatalog()));value.version=current.version||0;(await saveProduct(value));(await record('updated','product',id));return value;}));return send(res,200,{product:p});
          }
          if(/^\/api\/admin\/products\/\d+$/.test(route)&&req.method==='DELETE'){
            const id=Number(route.split('/').pop()),force=(await body(req)).force===true;
            const removed=await transaction(async()=>{
              const current=await getProduct(id);if(!current)fail(404,'Peça não encontrada.');
              const open=(await db.prepare(`SELECT data FROM orders WHERE json_extract(data,'$.status') IN (${OPEN_ORDER.map(()=>'?').join(',')})`).all(...OPEN_ORDER)).map(r=>JSON.parse(r.data)).find(o=>o.items.some(i=>i.id===id));
              if(open&&!force)fail(409,`A peça ${current.name} está no pedido ${open.id}, ainda em andamento. Confirme para excluir mesmo assim: o pedido continua registrado.`);
              await db.prepare('DELETE FROM products WHERE id=?').run(id);await removeUnusedImages([current.image,current.secondaryImage]);await record('deleted','product',id);return current;
            });return send(res,200,{deleted:{id:removed.id,name:removed.name}});
          }
          if(/^\/api\/admin\/orders\/MV-[A-F0-9]{16}$/.test(route)&&req.method==='DELETE'){
            const id=route.split('/').pop(),force=(await body(req)).force===true;
            await transaction(async()=>{
              const row=await db.prepare('SELECT data FROM orders WHERE id=?').get(id);if(!row)fail(404,'Pedido não encontrado.');const o=JSON.parse(row.data);
              if(o.payment?.provider&&(OPEN_ORDER.includes(o.status)||o.payment.status==='approved'))fail(409,o.payment.status==='approved'?'Pedido pago: ele fica no histórico. Para desfazer a venda, use Cancelar e estornar.':'Este pedido tem pagamento em andamento no Mercado Pago. Aguarde a confirmação ou cancele com estorno antes de excluir.');
              if(OPEN_ORDER.includes(o.status)){if(!force)fail(409,'Este pedido ainda está em andamento. Confirme para cancelar (as peças voltam ao estoque) e excluir.');await changeOrder(o,'demo_cancelled');}
              await db.prepare('DELETE FROM orders WHERE id=?').run(id);await record('deleted','order',id);
            });return send(res,200,{deleted:{id}});
          }
          if(/^\/api\/admin\/coupons\/[A-Z0-9_-]{3,30}$/.test(route)&&req.method==='DELETE'){
            const code=route.split('/').pop();
            await transaction(async()=>{if(!(await getCoupon(code)))fail(404,'Cupom não encontrado.');await db.prepare('DELETE FROM coupons WHERE code=?').run(code);await record('deleted','coupon',code);});
            return send(res,200,{deleted:{code}});
          }
          if(route==='/api/admin/alerts'&&req.method==='GET')return send(res,200,{alerts:(await db.prepare('SELECT data FROM alerts').all()).map(r=>JSON.parse(r.data)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))});
          if(/^\/api\/admin\/alerts\/AV-[A-F0-9]{16}$/.test(route)&&(req.method==='PATCH'||req.method==='DELETE')){
            const id=route.split('/').pop(),input=await body(req);
            await transaction(async()=>{const row=await db.prepare('SELECT data FROM alerts WHERE id=?').get(id);if(!row)fail(404,'Aviso não encontrado.');
              if(req.method==='DELETE'){await db.prepare('DELETE FROM alerts WHERE id=?').run(id);return;}
              if(!['pending','notified'].includes(input.status))fail(400,'Situação inválida.');const a=JSON.parse(row.data);a.status=input.status;a.notifiedAt=input.status==='notified'?new Date(now()).toISOString():null;
              await db.prepare('UPDATE alerts SET data=? WHERE id=?').run(JSON.stringify(a),id);});
            return send(res,200,{ok:true});
          }
          if(route==='/api/admin/subscribers'&&req.method==='GET')return send(res,200,{subscribers:(await db.prepare('SELECT data FROM subscribers').all()).map(r=>JSON.parse(r.data)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))});
          if(route==='/api/admin/subscribers'&&req.method==='DELETE'){
            const input=await body(req);if(typeof input.email!=='string'||input.email.length>254)fail(400,'E-mail inválido.');
            await db.prepare('DELETE FROM subscribers WHERE email=?').run(input.email.trim().toLowerCase());return send(res,200,{ok:true});
          }
          if(route==='/api/admin/orders'&&req.method==='GET')return send(res,200,{orders:(await db.prepare('SELECT data FROM orders ORDER BY rowid DESC LIMIT 200').all()).map(r=>JSON.parse(r.data))});
          if(route==='/api/admin/activity'&&req.method==='GET')return send(res,200,{activity:(await db.prepare('SELECT at,action,entity,entity_id FROM activity ORDER BY id DESC LIMIT 100').all())});
          if(route==='/api/admin/settings'&&req.method==='GET')return send(res,200,{store:(await getSettings()),payment:payments.options()});
          if(route==='/api/admin/settings'&&req.method==='PUT'){
            const input=await body(req);const store=(await transaction(async()=>{const current=(await getSettings());if(input.version!==current.version)fail(409,'As configurações mudaram. Atualize os dados antes de salvar.');const value=commerce.settings(input);if(value.welcomeEnabled&&!(await getCoupon(value.welcomeCoupon)))fail(400,'O cupom do pop-up não existe. Crie o cupom antes em Cupons.');value.version=current.version+1;(await db.prepare('UPDATE settings SET data=? WHERE key=?').run(JSON.stringify(value),'store'));(await record('updated','settings','store'));return value;}));return send(res,200,{store});
          }
          if(route==='/api/admin/coupons'&&req.method==='GET')return send(res,200,{coupons:(await db.prepare('SELECT data FROM coupons ORDER BY code').all()).map(r=>JSON.parse(r.data))});
          if(route==='/api/admin/coupons'&&req.method==='POST'){
            const input=await body(req);const result=(await transaction(async()=>{const c=commerce.coupon(input),current=(await getCoupon(c.code));if(current&&input.version!==current.version)fail(409,'O cupom foi alterado. Atualize antes de salvar.');c.used=current?.used||0;if(c.maxUses<c.used)fail(409,'O limite não pode ser menor que o número de usos.');c.version=(current?.version||0)+1;(await saveCoupon(c));(await record(current?'updated':'created','coupon',c.code));return c;}));return send(res,200,{coupon:result});
          }
          if(/^\/api\/admin\/orders\/MV-[A-F0-9]{16}$/.test(route)&&req.method==='PATCH'){
            const {status}=await body(req),id=route.split('/').pop();
            const allowed=o=>({demo_received:['demo_cancelled'],demo_paid:['demo_preparing','demo_cancelled'],demo_payment_review:['demo_preparing','demo_cancelled'],demo_preparing:['demo_ready','demo_cancelled'],demo_ready:['demo_completed','demo_cancelled'],demo_completed:[],demo_cancelled:[],demo_expired:[]})[o.status]||[];
            const before=await readOrder(id);if(!before)fail(404,'Pedido não encontrado.');
            if(!allowed(before).includes(status))fail(409,'Mudança de situação não permitida.');
            // Pedido pago pelo Mercado Pago: o cancelamento estorna o valor antes de devolver as peças.
            const refundable=o=>status==='demo_cancelled'&&o.payment?.provider&&o.payment.status==='approved'&&o.payment.paymentId&&o.status!=='demo_payment_review';
            let refund=null;if(refundable(before))refund=await payments.refund(before.payment.paymentId,before.id);
            const order=(await transaction(async()=>{
              const o=await readOrder(id);if(!o)fail(404,'Pedido não encontrado.');
              if(!allowed(o).includes(status))fail(409,'Mudança de situação não permitida.');
              if(refundable(o)&&!refund)fail(409,'O pedido mudou. Atualize os dados e tente novamente.');
              if(refund)Object.assign(o.payment,{status:'refunded',refundId:refund.refundId,refundedAt:new Date(now()).toISOString()});
              return (await changeOrder(o,status));
            }));return send(res,200,{order,refunded:Boolean(refund)});
          }
        }
        fail(404,'Rota não encontrada.');
      }
      if(req.method!=='GET'&&req.method!=='HEAD')fail(405,'Método não permitido.');
      if(databaseImages&&/^\/assets\/upload-[a-f0-9]{24}\.(jpg|png|webp)$/.test(route)){
        const image=await db.prepare('SELECT type,bytes,data FROM images WHERE name=?').get(route.slice(8));if(!image)fail(404,'Foto não encontrada.');
        res.writeHead(200,{'Content-Type':image.type,'Content-Length':Number(image.bytes),'Cache-Control':'public, max-age=31536000, immutable'});return res.end(req.method==='HEAD'?'':image.data);
      }
      const names={'/':'index.html','/admin':'admin.html','/admin/':'admin.html'};
      const relative=names[route]||route.slice(1);
      const allowed=['index.html','styles.css','boutique.css','checkout.css','app.js','checkout.js','contacts.js','catalog-core.js','experience.js','immersive.js','immersive.css','admin.html','admin.js','admin.css','operations.js'];
      if(!allowed.includes(relative)&&!/^assets\/[a-zA-Z0-9._-]+\.(png|jpg|jpeg|webp)$/.test(relative))fail(404,'Arquivo não encontrado.');
      const file=relative.startsWith('assets/')?path.join(assetDir,relative.slice(7)):path.join(__dirname,relative);if(!fs.existsSync(file)||!fs.statSync(file).isFile())fail(404,'Arquivo não encontrado.');
      const real=fs.realpathSync(file),expected=path.resolve(file);if(process.platform==='win32'?real.toLowerCase()!==expected.toLowerCase():real!==expected)fail(404,'Arquivo não encontrado.');
      const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
      res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':relative.endsWith('.html')?'no-store':'no-cache'});let content=fs.readFileSync(file);
      // Com o pagamento real ligado, a vitrine pode aparecer nas buscas. O painel continua fora delas.
      if(relative==='index.html'&&payments.options().configured)content=Buffer.from(content.toString('utf8').replace('<meta name="robots" content="noindex,nofollow">','<meta name="robots" content="index,follow">'));
      res.end(req.method==='HEAD'?'':content);
    }catch(error){if(!(error instanceof Problem))console.error('Falha interna na requisição.');if(!res.headersSent){res.setHeader('Cache-Control','no-store');res.setHeader('Connection','close');if(error.status===429)res.setHeader('Retry-After','60');if(error.status===404&&!req.url.startsWith('/api/')&&['GET','HEAD'].includes(req.method)){res.writeHead(404,{'Content-Type':'text/html; charset=utf-8'});res.end(req.method==='HEAD'?'':fs.readFileSync(path.join(__dirname,'404.html')));}else send(res,error.status||500,{error:error instanceof Problem?error.message:'Não foi possível concluir. Tente novamente.'});}else res.end();}
  }
  return {handler,runMaintenance:async()=>{await ready;return runMaintenance();},sweepPayments:async()=>{await ready;return sweepPayments();},ready,close:async()=>{try{await ready;}finally{await db.close();}}};
}
module.exports={createApp};
