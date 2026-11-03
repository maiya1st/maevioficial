const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const seed = require('./seed.cjs');
const {Problem,fail}=require('./errors.cjs');
const commerce=require('./commerce.cjs');
const {createGateway}=require('./payments.cjs');
const images=require('./images.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const same = (a,b) => crypto.timingSafeEqual(Buffer.from(hash(a)),Buffer.from(hash(b)));
function createApp({ dataDir = path.join(__dirname,'data'), assetDir=path.join(__dirname,'assets'), adminKey, port=5173, now=Date.now, network=fetch, paymentEnv={}, paymentNetwork=network }={}) {
  const payments=createGateway({env:paymentEnv,network:paymentNetwork,now});
  fs.mkdirSync(dataDir,{recursive:true});
  fs.mkdirSync(assetDir,{recursive:true});
  const keyFile = path.join(dataDir,'admin-key.txt');
  if (!adminKey) {
    if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile,crypto.randomBytes(24).toString('hex'),{mode:0o600,flag:'wx'});
    adminKey=fs.readFileSync(keyFile,'utf8').trim();
    if(!/^[a-f0-9]{48}$/.test(adminKey))throw new Error('Chave local inválida. Restaure data/admin-key.txt a partir do seu backup privado.');
  }
  const db = new DatabaseSync(path.join(dataDir,'maevi.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, idem TEXT UNIQUE NOT NULL, fingerprint TEXT NOT NULL, token TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY, at TEXT NOT NULL, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS coupons(code TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS orders_expiration ON orders(json_extract(data,'$.status'),json_extract(data,'$.reservationExpiresAt'));`);
  db.prepare('INSERT OR IGNORE INTO settings(key,data) VALUES(?,?)').run('store',JSON.stringify(commerce.defaults));
  if (!db.prepare('SELECT id FROM products LIMIT 1').get()) {
    const insert=db.prepare('INSERT INTO products(id,data) VALUES(?,?)');
    db.exec('BEGIN');try{for(const p of seed)insert.run(p.id,JSON.stringify(p));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  }
  const sessions=new Map(), limits=new Map();
  const allProducts=()=>db.prepare('SELECT data FROM products ORDER BY id').all().map(r=>JSON.parse(r.data));
  const getProduct=id=>{const row=db.prepare('SELECT data FROM products WHERE id=?').get(id);return row ? JSON.parse(row.data):null;};
  const saveProduct=p=>{p.version=(p.version||0)+1;return db.prepare('INSERT INTO products(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(p.id,JSON.stringify(p));};
  // Migra somente as URLs exatas das fotos demonstrativas; fotos cadastradas pela loja são preservadas.
  const demoImages=new Map(seed.map(p=>[p.sourceImage,p.image]));
  for(const p of allProducts())if(demoImages.has(p.image)&&fs.existsSync(path.join(__dirname,demoImages.get(p.image)))){p.image=demoImages.get(p.image);saveProduct(p);}
  const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
  const record=(action,entity,id)=>db.prepare('INSERT INTO activity(at,action,entity,entity_id) VALUES(?,?,?,?)').run(new Date(now()).toISOString(),action,entity,String(id));
  const getSettings=()=>JSON.parse(db.prepare('SELECT data FROM settings WHERE key=?').get('store').data);
  const getCoupon=code=>{const row=db.prepare('SELECT data FROM coupons WHERE code=?').get(code);return row?JSON.parse(row.data):null;};
  const saveCoupon=c=>db.prepare('INSERT INTO coupons(code,data) VALUES(?,?) ON CONFLICT(code) DO UPDATE SET data=excluded.data').run(c.code,JSON.stringify(c));
  function restore(order){
    for(const item of order.items){const p=getProduct(item.id);if(p){p.stock[item.size]+=item.quantity;saveProduct(p);}}
    if(order.coupon?.code){const c=getCoupon(order.coupon.code);if(c&&c.used>0){c.used--;saveCoupon(c);}}
  }
  function changeOrder(order,status){
    if(['demo_cancelled','demo_expired'].includes(status))restore(order);
    order.history=order.history||[{status:order.status,at:order.createdAt}];order.status=status;order.updatedAt=new Date(now()).toISOString();order.history.push({status,at:order.updatedAt});
    db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify(order),order.id);record(status,'order',order.id);return order;
  }
  function runMaintenance(){
    return transaction(()=>{const rows=db.prepare("SELECT data FROM orders WHERE json_extract(data,'$.status')='demo_received' AND json_extract(data,'$.reservationExpiresAt')<=? LIMIT 200").all(new Date(now()).toISOString());for(const row of rows)changeOrder(JSON.parse(row.data),'demo_expired');return rows.length;});
  }
  const readOrder=id=>{if(typeof id!=='string'||!/^MV-[A-F0-9]{16}$/.test(id))return null;const row=db.prepare('SELECT data FROM orders WHERE id=?').get(id);return row?JSON.parse(row.data):null;};
  const saveOrder=o=>db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify(o),o.id);
  async function startPayment(id){
    if(!payments.options().configured)fail(503,'Mercado Pago ainda não configurado para testes. Nenhuma cobrança foi criada.');
    const order=transaction(()=>{
      const o=readOrder(id);
      if(o.payment?.checkoutUrl&&o.status==='demo_payment_pending'&&Date.parse(o.payment.expiresAt)>now())return o;
      if(o.status!=='demo_received'||Date.parse(o.reservationExpiresAt)<=now())fail(409,'Este pedido não permite iniciar outro checkout. Atualize a situação.');
      o.payment={provider:'mercado_pago',mode:'test',status:'creating'};changeOrder(o,'demo_payment_pending');return o;
    });
    if(order.payment.checkoutUrl)return {order,session:{url:order.payment.checkoutUrl}};
    try{
      const session=await payments.createSession(order);
      return transaction(()=>{const current=readOrder(id);current.payment=session;saveOrder(current);record('payment_session','order',id);return {order:current,session:{url:session.checkoutUrl}};});
    }catch(e){transaction(()=>{const current=readOrder(id);current.payment.status='review';changeOrder(current,'demo_payment_review');});throw e;}
  }
  async function applyPayment(payment){
    const snapshot=readOrder(payment.external_reference);
    if(!snapshot)return false;
    if(!snapshot.payment?.preferenceId)fail(503,'Sessão ainda sendo registrada. Reenvie a notificação.');
    await payments.checkPayment(payment,snapshot);
    transaction(()=>{
      const order=readOrder(snapshot.id),p=order.payment;
      const updated=Date.parse(payment.date_last_updated||payment.date_created);
      if(!Number.isFinite(updated))fail(409,'Pagamento sem data válida.');
      if(p.paymentId&&p.paymentId!==String(payment.id)&&p.status==='approved'){
        if(payment.status==='approved')changeOrder(order,'demo_payment_review');return;
      }
      if(p.paymentId===String(payment.id)&&p.providerUpdatedAt&&updated<Date.parse(p.providerUpdatedAt))return;
      const status=payment.status;
      if(!['approved','pending','in_process','authorized','rejected','cancelled','refunded','charged_back','in_mediation'].includes(status))fail(409,'Situação de pagamento desconhecida.');
      // Uma recusa em outra tentativa não apaga a aprovação já confirmada.
      if(p.status==='approved'&&['pending','in_process','authorized','rejected','cancelled'].includes(status))return;
      const previous=p.status;
      Object.assign(p,{status,paymentId:String(payment.id),providerUpdatedAt:new Date(updated).toISOString(),checkedAt:new Date(now()).toISOString()});
      if(['refunded','charged_back','in_mediation'].includes(status)||Number(payment.transaction_amount_refunded||0)>0){if(order.status!=='demo_payment_review')changeOrder(order,'demo_payment_review');else saveOrder(order);}
      else if(status==='approved'&&previous!=='approved'){
        if(order.status!=='demo_payment_pending'||Date.parse(p.expiresAt)<Date.parse(payment.date_approved||payment.date_created))changeOrder(order,'demo_payment_review');else changeOrder(order,'demo_paid');
      }else saveOrder(order);
    });
    return true;
  }
  async function reconcile(id){
    const order=readOrder(id);
    if(order.payment?.preferenceId){
      for(const candidate of await payments.findPayments(order))await applyPayment(await payments.getPayment(candidate.id));
      transaction(()=>{const current=readOrder(id);if(current.status==='demo_payment_pending'&&Date.parse(current.payment.expiresAt)<=now())changeOrder(current,'demo_payment_review');});
    }
    return readOrder(id);
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
  function quote(items,{coupon:code='',shipping:shippingInput}={}) {
    if(!Array.isArray(items)||!items.length||items.length>50)fail(400,'Sua sacola precisa ter de 1 a 50 itens.');
    const normalized=new Map();
    for(const item of items){
      if(!item||!Number.isSafeInteger(item.id)||item.id<1||!['P','M','G','GG'].includes(item.size)||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>20)fail(400,'Item ou quantidade inválida.');
      const key=`${item.id}:${item.size}`, previous=normalized.get(key);
      normalized.set(key,{id:item.id,size:item.size,quantity:item.quantity+(previous?.quantity||0)});
    }
    const lines=[...normalized.values()].map(item=>{
      const p=getProduct(item.id);
      if(!p||!p.active)fail(409,'Uma peça não está mais disponível. Atualize sua sacola.');
      if(item.quantity>20||p.stock[item.size]<item.quantity)fail(409,`Estoque insuficiente: ${p.name}, tamanho ${item.size}.`);
      return {...item,name:p.name,color:p.color,unitCents:p.priceCents,lineCents:p.priceCents*item.quantity};
    });
    const subtotalCents=lines.reduce((sum,item)=>sum+item.lineCents,0);
    let discountCents=0,applied=null;
    if(code){if(typeof code!=='string'||!/^[A-Za-z0-9_-]{3,30}$/.test(code))fail(400,'Cupom inválido.');const c=getCoupon(code.toUpperCase());
      if(!c||!c.active||(c.expiresAt&&Date.parse(c.expiresAt)<=now())||c.used>=c.maxUses)fail(409,'Cupom indisponível ou expirado.');
      if(subtotalCents<c.minCents)fail(409,'O valor da sacola não atinge o mínimo deste cupom.');discountCents=Math.floor(subtotalCents*c.percent/100);applied={code:c.code,percent:c.percent};
    }
    const store=getSettings(),delivery=commerce.shipping(shippingInput,store,subtotalCents-discountCents);
    return {items:lines,subtotalCents,discountCents,coupon:applied,shippingCents:delivery.priceCents,totalCents:subtotalCents-discountCents+delivery.priceCents,shipping:delivery,fulfillment:delivery.method==='pickup'?'demo_pickup':'demo_delivery',mode:'demo',settingsVersion:store.version};
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
  function authenticated(req){const token=sessionToken(req),key=token?hash(token):'',session=sessions.get(key),time=now();if(!session||session.expires<=time||session.lastSeen+30*60*1000<=time){sessions.delete(key);fail(401,'Entre no painel para continuar.');}session.lastSeen=time;}
  function rate(req,group,max){
    const time=now();for(const [key,entry] of limits)if(entry.until<=time)limits.delete(key);
    const key=`${req.socket?.remoteAddress||'local'}:${group}`,entry=limits.get(key)||{count:0,until:time+60000};entry.count++;limits.set(key,entry);if(entry.count>max)fail(429,'Muitas tentativas. Aguarde um minuto.');
  }
  function validateProduct(input,id){
    const p={id,name:text(input.name,'Nome',100),category:input.category,color:text(input.color,'Cor',60),hex:input.hex,description:text(input.description,'Descrição',2000),image:text(input.image,'Imagem',500),priceCents:input.priceCents,stock:input.stock,active:input.active};
    if(!['Vestidos','Conjuntos','Blusas'].includes(p.category)||typeof p.hex!=='string'||!/^#[0-9a-f]{6}$/i.test(p.hex)||!Number.isInteger(p.priceCents)||p.priceCents<1||p.priceCents>10000000||typeof p.active!=='boolean')fail(400,'Categoria, preço, cor ou disponibilidade inválidos.');
    if(!p.stock||!['P','M','G','GG'].every(s=>Number.isInteger(p.stock[s])&&p.stock[s]>=0&&p.stock[s]<=10000))fail(400,'Informe o estoque por tamanho.');
    if(!/^https:\/\/images\.unsplash\.com\/[^\s"<>]+$/.test(p.image)&&!/^\/assets\/[a-zA-Z0-9._-]+\.(png|jpg|jpeg|webp)$/.test(p.image))fail(400,'Use uma imagem em /assets/ ou HTTPS do images.unsplash.com.');
    const optionalText=(value,label,max)=>value===undefined||value===''?'':text(value,label,max);
    p.secondaryImage=optionalText(input.secondaryImage,'Segunda imagem',500);p.material=optionalText(input.material,'Composição',600);p.care=optionalText(input.care,'Cuidados',600);p.measurements=optionalText(input.measurements,'Medidas',2000);
    p.featured=input.featured===undefined?false:input.featured;if(typeof p.featured!=='boolean')fail(400,'Destaque inválido.');
    if(p.secondaryImage&&!/^https:\/\/images\.unsplash\.com\/[^\s"<>]+$/.test(p.secondaryImage)&&!/^\/assets\/[a-zA-Z0-9._-]+\.(png|jpg|jpeg|webp)$/.test(p.secondaryImage))fail(400,'Segunda imagem inválida. Use /assets/ ou images.unsplash.com.');
    p.stock=Object.fromEntries(['P','M','G','GG'].map(s=>[s,p.stock[s]]));return p;
  }
  async function handler(req,res){
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Cross-Origin-Resource-Policy','same-origin');res.setHeader('Cross-Origin-Opener-Policy','same-origin');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; script-src-attr 'none'; object-src 'none'; style-src 'self' https://fonts.googleapis.com; style-src-attr 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://images.unsplash.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try{
      const localHosts=[`127.0.0.1:${port}`,`localhost:${port}`];
      const publicHost=payments.options().configured?new URL(payments.origin).host:'';
      const allowedHosts=[...localHosts,...(publicHost?[publicHost]:[])];
      if(!allowedHosts.includes(req.headers.host))fail(403,'Acesso permitido apenas pelo endereço local da loja.');
      const expectedOrigin=req.headers.host===publicHost?payments.origin:'http://'+req.headers.host;
      if(req.headers.origin&&req.headers.origin!==expectedOrigin)fail(403,'Origem não permitida.');
      if(typeof req.url!=='string'||!req.url.startsWith('/')||req.url.startsWith('//')||req.url.includes('\\')||req.url.length>2048)fail(400,'Endereço inválido.');
      const url=new URL(req.url,'http://'+req.headers.host), route=url.pathname;
      if((route.startsWith('/admin')||route.startsWith('/api/admin')||['/admin.html','/admin.js','/admin.css','/operations.js'].includes(route))&&(!localHosts.includes(req.headers.host)||req.headers['x-forwarded-for']||req.headers['forwarded']||req.headers['x-forwarded-host']))fail(403,'Painel disponível somente no computador da loja.');
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
        if(!['GET','POST','PUT','PATCH'].includes(req.method))fail(405,'Método não permitido.');
        if(req.method!=='GET'&&req.headers['x-maevi-request']!=='1')fail(403,'Atualize a página da loja antes de continuar.');
        runMaintenance();
        if(req.method==='GET'&&route==='/api/products')return send(res,200,{products:allProducts().filter(p=>p.active),mode:'demo'});
        if(req.method==='GET'&&route==='/api/store')return send(res,200,{store:getSettings(),mode:'demo',payment:payments.options()});
        if(req.method==='GET'&&/^\/api\/postal-code\/\d{8}$/.test(route)){rate(req,'postal',20);return send(res,200,{address:await postalLookup(route.split('/').pop())});}
        if(req.method==='POST'&&route==='/api/quote'){rate(req,'quote',120);const input=await body(req);return send(res,200,quote(input.items,input));}
        if(req.method==='POST'&&route==='/api/orders'){
          rate(req,'orders',30);const input=await body(req);
          const idem=req.headers['idempotency-key'];if(typeof idem!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(idem))fail(400,'Chave da tentativa inválida.');
          if(!['demo_pickup','demo_delivery'].includes(input.fulfillment)||input.demoAccepted!==true)fail(400,'Confirme que este é um pedido de teste.');
          const customer={name:text(input.customer?.name,'Nome',100),email:text(input.customer?.email,'E-mail',254)};
          if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email))fail(400,'Informe um e-mail válido.');
          const shippingInput=input.shipping||{method:input.fulfillment==='demo_delivery'?'delivery':'pickup'};
          if((input.fulfillment==='demo_delivery')!==(shippingInput.method==='delivery'))fail(400,'Forma de recebimento inconsistente.');
          if(input.checkoutVersion===2||input.customer?.phone)customer.phone=commerce.phone(input.customer?.phone,false);
          const deliveryAddress=shippingInput.method==='delivery'?commerce.address(input.address):null;
          if(deliveryAddress&&deliveryAddress.cep!==commerce.cep(shippingInput.cep))fail(400,'CEP do endereço diferente do CEP cotado.');
          const fingerprint=hash(JSON.stringify({items:input.items,customer,...(input.checkoutVersion===2||input.shipping||input.coupon?{shipping:shippingInput,address:deliveryAddress,coupon:input.coupon||''}:{})}));
          const result=transaction(()=>{
            const existing=db.prepare('SELECT * FROM orders WHERE idem=?').get(idem);
            if(existing){if(existing.fingerprint!==fingerprint)fail(409,'Esta tentativa já foi usada para outro pedido.');return {order:JSON.parse(existing.data),token:existing.token,reused:true};}
            const totals=quote(input.items,{...input,shipping:shippingInput});
            if(input.expectedTotalCents!==undefined&&input.expectedTotalCents!==totals.totalCents)fail(409,'O total foi atualizado. Confira novamente os valores antes de confirmar.');
            if(input.expectedSettingsVersion!==undefined&&input.expectedSettingsVersion!==totals.settingsVersion)fail(409,'As condições de entrega mudaram. Volte à etapa de recebimento e confira novamente.');
            if(totals.coupon){const c=getCoupon(totals.coupon.code);c.used++;saveCoupon(c);}
            for(const item of totals.items){const p=getProduct(item.id);p.stock[item.size]-=item.quantity;saveProduct(p);}
            const createdAt=new Date(now()).toISOString();
            const order={id:'MV-'+crypto.randomBytes(8).toString('hex').toUpperCase(),createdAt,status:'demo_received',history:[{status:'demo_received',at:createdAt}],customer,...totals,address:deliveryAddress,reservationExpiresAt:new Date(now()+getSettings().reservationMinutes*60000).toISOString(),payment:{status:'not_requested',provider:null}};
            const token=crypto.randomBytes(24).toString('hex');
            db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(order.id,idem,fingerprint,token,JSON.stringify(order));record('created','order',order.id);return {order,token,reused:false};
          });
          return send(res,result.reused?200:201,result);
        }
        if(req.method==='GET'&&/^\/api\/orders\/MV-[A-F0-9]{16}$/.test(route)){
          rate(req,'lookup',60);const row=db.prepare('SELECT * FROM orders WHERE id=?').get(route.split('/').pop());
          if(!row||typeof req.headers['x-order-token']!=='string'||!same(req.headers['x-order-token'],row.token))fail(404,'Pedido não encontrado.');
          return send(res,200,{order:JSON.parse(row.data)});
        }
        if(req.method==='POST'&&/^\/api\/orders\/MV-[A-F0-9]{16}\/(cancel|payment-session|payment-refresh)$/.test(route)){
          rate(req,'order-action',30);const parts=route.split('/'),row=db.prepare('SELECT * FROM orders WHERE id=?').get(parts[3]);
          if(!row||typeof req.headers['x-order-token']!=='string'||!same(req.headers['x-order-token'],row.token))fail(404,'Pedido não encontrado.');
          await body(req);const order=JSON.parse(row.data);
          if(parts[4]==='payment-session')return send(res,200,await startPayment(order.id));
          if(parts[4]==='payment-refresh')return send(res,200,{order:await reconcile(order.id)});
          return send(res,200,{order:transaction(()=>{const current=JSON.parse(db.prepare('SELECT data FROM orders WHERE id=?').get(order.id).data);if(current.status!=='demo_received')fail(409,'Este pedido não pode mais ser cancelado por aqui.');return changeOrder(current,'demo_cancelled');})});
        }
        if(route==='/api/admin/login'&&req.method==='POST'){
          rate(req,'login',10);const input=await body(req);
          if(typeof input.key!=='string'||!same(input.key,adminKey))fail(401,'Chave de acesso inválida.');
          for(const [key,session] of sessions)if(session.expires<=now()||session.lastSeen+30*60*1000<=now())sessions.delete(key);
          const previous=sessionToken(req);if(previous)sessions.delete(hash(previous));
          if(sessions.size>=32)sessions.delete(sessions.keys().next().value);
          const token=crypto.randomBytes(32).toString('hex');sessions.set(hash(token),{expires:now()+8*60*60*1000,lastSeen:now()});
          return send(res,200,{ok:true},{'Set-Cookie':`maevi_session=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=28800`});
        }
        if(route.startsWith('/api/admin/')){
          authenticated(req);
          if(route==='/api/admin/images'&&req.method==='POST'){
            rate(req,'upload',10);const type=req.headers['content-type'];if(!['image/jpeg','image/png','image/webp'].includes(type))fail(415,'Envie uma imagem JPG, PNG ou WebP.');
            if(Number(req.headers['content-length']||0)>4194304)fail(413,'A foto deve ter no máximo 4 MB.');
            let size=0,chunks=[];for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>4194304)fail(413,'A foto deve ter no máximo 4 MB.');chunks.push(Buffer.from(chunk));}
            const bytes=Buffer.concat(chunks),info=images.inspect(bytes,type);
            const directory=assetDir;const files=fs.readdirSync(directory).filter(name=>/^upload-[a-f0-9]+\.(jpg|png|webp)$/.test(name));
            if(files.length>=400||files.reduce((sum,name)=>sum+fs.statSync(path.join(directory,name)).size,0)+bytes.length>104857600)fail(409,'Limite local de fotos atingido (100 MB ou 400 arquivos).');
            const name=`upload-${crypto.randomBytes(12).toString('hex')}.${info.extension}`;
            fs.writeFileSync(path.join(directory,name),bytes,{flag:'wx'});record('uploaded','image',name);return send(res,201,{image:'/assets/'+name,width:info.width,height:info.height});
          }
          if(route==='/api/admin/logout'&&req.method==='POST'){sessions.delete(hash(sessionToken(req)));return send(res,200,{ok:true},{'Set-Cookie':'maevi_session=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0'});}
          if(route==='/api/admin/products'&&req.method==='GET')return send(res,200,{products:allProducts()});
          if(route==='/api/admin/products'&&req.method==='POST'){
            const input=await body(req);const p=transaction(()=>{const id=Number(db.prepare('SELECT COALESCE(MAX(id),0)+1 AS id FROM products').get().id);const value=validateProduct(input,id);saveProduct(value);record('created','product',id);return value;});return send(res,201,{product:p});
          }
          if(/^\/api\/admin\/products\/\d+$/.test(route)&&req.method==='PUT'){
            const id=Number(route.split('/').pop()),input=await body(req);const p=transaction(()=>{const current=getProduct(id);if(!current)fail(404,'Peça não encontrada.');if(input.version!==(current.version||0))fail(409,'Esta peça mudou desde a abertura. Feche a edição, atualize os dados e tente novamente.');const value=validateProduct(input,id);value.version=current.version||0;saveProduct(value);record('updated','product',id);return value;});return send(res,200,{product:p});
          }
          if(route==='/api/admin/orders'&&req.method==='GET')return send(res,200,{orders:db.prepare('SELECT data FROM orders ORDER BY rowid DESC LIMIT 200').all().map(r=>JSON.parse(r.data))});
          if(route==='/api/admin/activity'&&req.method==='GET')return send(res,200,{activity:db.prepare('SELECT at,action,entity,entity_id FROM activity ORDER BY id DESC LIMIT 100').all()});
          if(route==='/api/admin/settings'&&req.method==='GET')return send(res,200,{store:getSettings(),payment:payments.options()});
          if(route==='/api/admin/settings'&&req.method==='PUT'){
            const input=await body(req);const store=transaction(()=>{const current=getSettings();if(input.version!==current.version)fail(409,'As configurações mudaram. Atualize os dados antes de salvar.');const value=commerce.settings(input);value.version=current.version+1;db.prepare('UPDATE settings SET data=? WHERE key=?').run(JSON.stringify(value),'store');record('updated','settings','store');return value;});return send(res,200,{store});
          }
          if(route==='/api/admin/coupons'&&req.method==='GET')return send(res,200,{coupons:db.prepare('SELECT data FROM coupons ORDER BY code').all().map(r=>JSON.parse(r.data))});
          if(route==='/api/admin/coupons'&&req.method==='POST'){
            const input=await body(req);const result=transaction(()=>{const c=commerce.coupon(input),current=getCoupon(c.code);if(current&&input.version!==current.version)fail(409,'O cupom foi alterado. Atualize antes de salvar.');c.used=current?.used||0;if(c.maxUses<c.used)fail(409,'O limite não pode ser menor que o número de usos.');c.version=(current?.version||0)+1;saveCoupon(c);record(current?'updated':'created','coupon',c.code);return c;});return send(res,200,{coupon:result});
          }
          if(/^\/api\/admin\/orders\/MV-[A-F0-9]{16}$/.test(route)&&req.method==='PATCH'){
            const {status}=await body(req),id=route.split('/').pop();
            const order=transaction(()=>{
              const row=db.prepare('SELECT data FROM orders WHERE id=?').get(id);if(!row)fail(404,'Pedido não encontrado.');const o=JSON.parse(row.data);
              const next={demo_received:['demo_preparing','demo_cancelled'],demo_paid:['demo_preparing'],demo_preparing:['demo_ready',...(o.payment?.provider?[]:['demo_cancelled'])],demo_ready:['demo_completed',...(o.payment?.provider?[]:['demo_cancelled'])],demo_completed:[],demo_cancelled:[],demo_expired:[]};
              if(!next[o.status]?.includes(status))fail(409,'Mudança de situação não permitida.');
              return changeOrder(o,status);
            });return send(res,200,{order});
          }
        }
        fail(404,'Rota não encontrada.');
      }
      if(req.method!=='GET'&&req.method!=='HEAD')fail(405,'Método não permitido.');
      const names={'/':'index.html','/admin':'admin.html','/admin/':'admin.html'};
      const relative=names[route]||route.slice(1);
      const allowed=['index.html','styles.css','boutique.css','checkout.css','app.js','checkout.js','contacts.js','catalog-core.js','experience.js','admin.html','admin.js','admin.css','operations.js'];
      if(!allowed.includes(relative)&&!/^assets\/[a-zA-Z0-9._-]+\.(png|jpg|jpeg|webp)$/.test(relative))fail(404,'Arquivo não encontrado.');
      const file=relative.startsWith('assets/')?path.join(assetDir,relative.slice(7)):path.join(__dirname,relative);if(!fs.existsSync(file)||!fs.statSync(file).isFile())fail(404,'Arquivo não encontrado.');
      const real=fs.realpathSync(file),expected=path.resolve(file);if(process.platform==='win32'?real.toLowerCase()!==expected.toLowerCase():real!==expected)fail(404,'Arquivo não encontrado.');
      const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
      res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':relative.endsWith('.html')?'no-store':'no-cache'});res.end(req.method==='HEAD'?'':fs.readFileSync(file));
    }catch(error){if(!(error instanceof Problem))console.error('Falha interna na requisição.');if(!res.headersSent){res.setHeader('Cache-Control','no-store');res.setHeader('Connection','close');if(error.status===429)res.setHeader('Retry-After','60');if(error.status===404&&!req.url.startsWith('/api/')&&['GET','HEAD'].includes(req.method)){res.writeHead(404,{'Content-Type':'text/html; charset=utf-8'});res.end(req.method==='HEAD'?'':fs.readFileSync(path.join(__dirname,'404.html')));}else send(res,error.status||500,{error:error instanceof Problem?error.message:'Não foi possível concluir. Tente novamente.'});}else res.end();}
  }
  return {handler,runMaintenance,close:()=>db.close()};
}
module.exports={createApp};
