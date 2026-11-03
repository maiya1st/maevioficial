const path=require('node:path');
function configuration(env=process.env){
  const mode=env.MAEVI_HOSTING||'local';
  if(!['local','hostinger','setup'].includes(mode))throw Error('MAEVI_HOSTING deve ser local, setup ou hostinger.');
  const port=Number(env.PORT||(mode==='local'?5173:3000));if(!Number.isInteger(port)||port<1024||port>65535)throw Error('PORT inválida.');
  if(mode!=='hostinger')return {mode,port,host:mode==='local'?'127.0.0.1':'0.0.0.0',app:{port,paymentEnv:env}};
  const required=['MAEVI_PUBLIC_URL','MAEVI_ADMIN_KEY','MAEVI_DB_NAME','MAEVI_DB_USER','MAEVI_DB_PASSWORD'];for(const name of required)if(!env[name])throw Error('Configure '+name+' nas variáveis da hospedagem.');
  const url=new URL(env.MAEVI_PUBLIC_URL),origin=url.origin;
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash||!url.hostname.includes('.')||/^(localhost|127\.|\[|\d+\.)/i.test(url.hostname))throw Error('MAEVI_PUBLIC_URL deve ser a origem pública HTTPS.');
  if(!/^[a-f0-9]{48}$/.test(env.MAEVI_ADMIN_KEY))throw Error('MAEVI_ADMIN_KEY deve ter 48 caracteres hexadecimais.');
  if(!/^[\w-]{1,128}$/.test(env.MAEVI_DB_NAME)||!/^[\w-]{1,128}$/.test(env.MAEVI_DB_USER))throw Error('Nome ou usuário do banco inválido.');
  const host=env.MAEVI_DB_HOST||'127.0.0.1',dbPort=Number(env.MAEVI_DB_PORT||3306);
  if(!Number.isInteger(dbPort)||dbPort<1||dbPort>65535)throw Error('Porta do banco inválida.');
  if(!['localhost','127.0.0.1','::1'].includes(host)&&env.MAEVI_DB_TLS!=='true')throw Error('Banco remoto exige MAEVI_DB_TLS=true e certificado válido.');
  return {mode,port,host:'0.0.0.0',app:{port,adminKey:env.MAEVI_ADMIN_KEY,publicOrigin:origin,publicAdmin:true,paymentEnv:{...env,MAEVI_PUBLIC_URL:origin},mysql:{host,port:dbPort,user:env.MAEVI_DB_USER,password:env.MAEVI_DB_PASSWORD,database:env.MAEVI_DB_NAME,...(env.MAEVI_DB_TLS==='true'?{ssl:{rejectUnauthorized:true}}:{})}}};
}
function setupHandler(req,res){
  const readable=['GET','HEAD'].includes(req.method),route=(req.url||'').split('?')[0],healthy=readable&&route==='/api/health',home=readable&&route==='/';
  res.writeHead(healthy||home?200:503,{'Content-Type':healthy?'application/json; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",...(healthy||home?{}:{'Retry-After':'3600'})});
  res.end(req.method==='HEAD'?'':healthy?JSON.stringify({ok:true,mode:'setup'}):'<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MAÉVI · Em preparação</title><main><h1>MAÉVI</h1><p>Estamos preparando cada detalhe para receber você. Volte em breve.</p></main></html>');
}
module.exports={configuration,setupHandler};
