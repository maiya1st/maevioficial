const {fail,Problem}=require('./errors.cjs');
const states=new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
const defaults=Object.freeze({version:1,name:'MAÉVI',email:'',whatsapp:'41985213878',instagram:'maevioficial',pickupAddress:'',pickupEnabled:true,deliveryEnabled:true,deliveryLabel:'Entrega',deliveryCents:1990,deliveryMinDays:3,deliveryMaxDays:8,freeShippingFromCents:0,reservationMinutes:30});
function text(value,label,max=200,optional=false){
  if(optional&&(value===undefined||value===''))return '';
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))fail(400,`${label} inválido.`);
  return value.trim();
}
function integer(value,label,min,max){if(!Number.isInteger(value)||value<min||value>max)fail(400,`${label} inválido.`);return value;}
function cep(value){if(typeof value!=='string'||!/^\d{5}-?\d{3}$/.test(value))fail(400,'Informe um CEP de oito dígitos.');const code=value.replace('-','');if(/^(\d)\1{7}$/.test(code))fail(400,'CEP inválido.');return code;}
function phone(value,optional=true){if(optional&&(value===undefined||value===''))return '';if(typeof value!=='string'||!/^[+()\d\s-]{10,25}$/.test(value))fail(400,'Telefone inválido.');const digits=value.replace(/\D/g,'').replace(/^55(?=\d{10,11}$)/,'');if(!/^\d{10,11}$/.test(digits)||/^(\d)\1+$/.test(digits))fail(400,'Informe telefone com DDD.');return digits;}
function documentId(value){
  if(value===undefined||value==='')return '';
  if(typeof value!=='string')fail(400,'CPF ou CNPJ inválido.');
  const digits=value.replace(/\D/g,'');
  if(digits.length===11){if(/^(\d)\1{10}$/.test(digits))fail(400,'CPF inválido.');const check=n=>{let sum=0;for(let i=0;i<n;i++)sum+=Number(digits[i])*(n+1-i);const r=(sum*10)%11;return r===10?0:r;};if(check(9)!==Number(digits[9])||check(10)!==Number(digits[10]))fail(400,'CPF inválido. Confira os números.');return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4');}
  if(digits.length===14){if(/^(\d)\1{13}$/.test(digits))fail(400,'CNPJ inválido.');const calc=n=>{const w=n===12?[5,4,3,2,9,8,7,6,5,4,3,2]:[6,5,4,3,2,9,8,7,6,5,4,3,2];const sum=w.reduce((a,x,i)=>a+x*Number(digits[i]),0),r=sum%11;return r<2?0:11-r;};if(calc(12)!==Number(digits[12])||calc(13)!==Number(digits[13]))fail(400,'CNPJ inválido. Confira os números.');return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,'$1.$2.$3/$4-$5');}
  fail(400,'Informe um CPF (11 números) ou CNPJ (14 números).');
}
function settings(input){
  const s={version:input.version,name:text(input.name,'Nome da loja',100),email:text(input.email,'E-mail',254,true),whatsapp:phone(input.whatsapp),instagram:text(input.instagram,'Instagram',40,true),pickupAddress:text(input.pickupAddress,'Endereço de retirada',350,true),pickupEnabled:input.pickupEnabled,deliveryEnabled:input.deliveryEnabled,deliveryLabel:text(input.deliveryLabel,'Nome da entrega',80),deliveryCents:integer(input.deliveryCents,'Valor de entrega',0,100000),deliveryMinDays:integer(input.deliveryMinDays,'Prazo mínimo',1,90),deliveryMaxDays:integer(input.deliveryMaxDays,'Prazo máximo',1,90),freeShippingFromCents:integer(input.freeShippingFromCents,'Valor para frete grátis',0,10000000),reservationMinutes:integer(input.reservationMinutes,'Tempo de reserva',15,1440),legalName:text(input.legalName,'Nome ou razão social',150,true),documentId:documentId(input.documentId),legalAddress:text(input.legalAddress,'Endereço da empresa',300,true),policy:text(input.policy,'Política de trocas',6000,true)};
  if(s.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email))fail(400,'E-mail da loja inválido.');
  if(s.instagram&&!/^[a-zA-Z0-9._]{1,30}$/.test(s.instagram))fail(400,'Use apenas o nome do perfil do Instagram, sem @ ou URL.');
  if(typeof s.pickupEnabled!=='boolean'||typeof s.deliveryEnabled!=='boolean'||(!s.pickupEnabled&&!s.deliveryEnabled)||s.deliveryMinDays>s.deliveryMaxDays)fail(400,'Configure ao menos uma forma de recebimento e prazos válidos.');
  return s;
}
function address(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'Informe o endereço de entrega.');
  const result={cep:cep(input.cep),street:text(input.street,'Rua',150),number:text(input.number,'Número',20),complement:text(input.complement,'Complemento',100,true),district:text(input.district,'Bairro',100),city:text(input.city,'Cidade',100),state:text(input.state,'UF',2).toUpperCase()};
  if(!states.has(result.state))fail(400,'Selecione uma UF válida.');return result;
}
function shipping(input,store,subtotalCents){
  if(input!==undefined&&(!input||typeof input!=='object'||Array.isArray(input)))fail(400,'Forma de recebimento inválida.');
  const method=input?.method||'pickup';
  if(method==='pickup'){if(!store.pickupEnabled)fail(409,'Retirada indisponível no momento.');return {method,label:'Retirada na loja',priceCents:0,addressLabel:store.pickupAddress||'Combine a retirada pelo WhatsApp da loja.'};}
  if(method!=='delivery'||!store.deliveryEnabled)fail(409,'Entrega indisponível no momento.');
  const code=cep(input.cep),free=store.freeShippingFromCents>0&&subtotalCents>=store.freeShippingFromCents;
  return {method,label:store.deliveryLabel,cep:code,priceCents:free?0:store.deliveryCents,minDays:store.deliveryMinDays,maxDays:store.deliveryMaxDays,estimateOnly:true};
}
function coupon(input){
  const code=text(input.code,'Código do cupom',30).toUpperCase();if(!/^[A-Z0-9_-]{3,30}$/.test(code))fail(400,'Código de cupom inválido.');
  const c={code,percent:integer(input.percent,'Desconto percentual',1,80),minCents:integer(input.minCents,'Compra mínima',0,10000000),maxUses:integer(input.maxUses,'Limite de usos',1,100000),active:input.active,expiresAt:input.expiresAt||''};
  if(typeof c.active!=='boolean'||typeof c.expiresAt!=='string'||(c.expiresAt&&(!/^\d{4}-\d{2}-\d{2}T/.test(c.expiresAt)||!Number.isFinite(Date.parse(c.expiresAt)))))fail(400,'Situação ou validade do cupom inválida.');
  return c;
}

const catalogDefaults=Object.freeze({categories:Object.freeze(['Vestidos','Conjuntos','Blusas']),sizes:Object.freeze(['P','M','G','GG'])});
function catalogList(value,label,{max,length,pattern,reserved=[]}){
  if(!Array.isArray(value)||value.length<1||value.length>max)throw new Problem(400,`Cadastre de 1 a ${max} ${label}.`);
  const seen=new Set();
  return value.map(item=>{
    if(typeof item!=='string')throw new Problem(400,`Revise ${label}.`);
    const clean=item.normalize('NFC').trim().replace(/\s+/g,' ');
    if(!clean||clean.length>length||!pattern.test(clean))throw new Problem(400,`"${clean.slice(0,24)||'vazio'}" não é válido em ${label}. Use letras, números, espaço ou hífen (até ${length} caracteres).`);
    const key=clean.toLocaleLowerCase('pt-BR');
    if(reserved.includes(key))throw new Problem(400,`"${clean}" é um nome reservado da loja.`);
    if(seen.has(key))throw new Problem(400,`"${clean}" aparece duas vezes em ${label}.`);
    seen.add(key);return clean;
  });
}
function catalog(input,current){
  const categories=catalogList(input?.categories,'categorias',{max:20,length:40,pattern:/^[\p{L}\p{N}][\p{L}\p{N} &'-]*$/u,reserved:['todas','todas as peças']});
  const sizes=catalogList(input?.sizes,'tamanhos',{max:12,length:10,pattern:/^[\p{L}\p{N}][\p{L}\p{N} /.-]*$/u});
  const renames={categories:{},sizes:{}};
  for(const [kind,list] of [['categories',categories],['sizes',sizes]]){
    const raw=input?.renames?.[kind];if(raw===undefined)continue;
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length>20)throw new Problem(400,'Renomeação inválida.');
    for(const [from,to] of Object.entries(raw)){
      if(!current[kind].includes(from)||typeof to!=='string'||!list.includes(to.normalize('NFC').trim().replace(/\s+/g,' ')))throw new Problem(400,'Renomeação inválida.');
      renames[kind][from]=to.normalize('NFC').trim().replace(/\s+/g,' ');
    }
  }
  return {categories,sizes,renames};
}
function ownerEmail(value){
  if(typeof value!=='string')throw new Problem(400,'Informe um e-mail válido.');
  const email=value.trim().toLowerCase();
  if(email.length>254||!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(email))throw new Problem(400,'Informe um e-mail válido.');
  return email;
}
function ownerPassword(value,email){
  if(typeof value!=='string'||value.length<10)throw new Problem(400,'A senha precisa ter pelo menos 10 caracteres.');
  if(value.length>200)throw new Problem(400,'A senha pode ter no máximo 200 caracteres.');
  if(/^(.)\1+$/.test(value)||value.toLowerCase()===email||/^(0123456789|1234567890|senha12345|maevi12345)/i.test(value))throw new Problem(400,'Escolha uma senha menos previsível.');
  return value;
}
module.exports={catalogDefaults,catalog,ownerEmail,ownerPassword,defaults,text,integer,cep,phone,settings,address,shipping,coupon,states};
