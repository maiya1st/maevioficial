const http=require('node:http');
const {createApp}=require('./backend.cjs');
function createLocalServer(handler){
  const server=http.createServer({maxHeaderSize:8192,headersTimeout:10000,requestTimeout:15000,keepAliveTimeout:5000,connectionsCheckingInterval:1000},handler);
  server.maxHeadersCount=50;server.maxRequestsPerSocket=100;server.maxConnections=32;
  server.setTimeout(15000,socket=>socket.destroy());return server;
}
function startupFailure(error){
  const messages={ER_ACCESS_DENIED_ERROR:'Confira usuário e senha do banco nas variáveis da hospedagem.',ER_DBACCESS_DENIED_ERROR:'Confira as permissões do usuário para o banco.',ER_BAD_DB_ERROR:'Confira o nome completo do banco.',ECONNREFUSED:'A conexão com o banco foi recusada. Confira host e porta.',ETIMEDOUT:'A conexão com o banco excedeu o prazo.',ENOTFOUND:'O host do banco não foi encontrado.',EACCES:'Confira as permissões de arquivos e a porta da aplicação.',EADDRINUSE:'A porta da aplicação está ocupada.',ER_PARSE_ERROR:'O banco recusou uma instrução de inicialização. Confira a versão MySQL/MariaDB.',MODULE_NOT_FOUND:'Uma dependência ou arquivo da aplicação não foi instalado.',ERR_INVALID_URL:'Confira o formato HTTPS de MAEVI_PUBLIC_URL.'};
  if(Object.hasOwn(messages,error?.code))return `MAÉVI [${error.code}]: ${messages[error.code]}`;
  const missing=/^Configure (MAEVI_PUBLIC_URL|MAEVI_ADMIN_KEY|MAEVI_DB_NAME|MAEVI_DB_USER|MAEVI_DB_PASSWORD) nas variáveis da hospedagem\.$/.exec(error?.message||'');
  if(missing)return 'MAÉVI: falta configurar '+missing[1]+'.';
  const safe=new Set(['MAEVI_HOSTING deve ser local, setup ou hostinger.','PORT inválida.','MAEVI_PUBLIC_URL deve ser a origem pública HTTPS.','MAEVI_ADMIN_KEY deve ter 48 caracteres hexadecimais.','Nome ou usuário do banco inválido.','Porta do banco inválida.','Banco remoto exige MAEVI_DB_TLS=true e certificado válido.']);
  if(safe.has(error?.message))return 'MAÉVI: '+error.message;
  return 'MAÉVI: não foi possível iniciar a aplicação. Confira a configuração da hospedagem. Nenhuma credencial foi exibida.';
}
// Hostinger requires listen() during entry loading, before asynchronous database initialization.
function start({env=process.env,loadEnv=true,appFactory=createApp,serverFactory=createLocalServer,logger=console}={}){
  const fs=require('node:fs'),path=require('node:path');
  const envFile=path.join(__dirname,'.env.local');if(loadEnv&&fs.existsSync(envFile))process.loadEnvFile(envFile);
  const {configuration,setupHandler}=require('./hosting.cjs'),config=configuration(env);
  const app=config.mode==='setup'?{handler:setupHandler,ready:Promise.resolve(),runMaintenance:async()=>0,close:async()=>{}}:appFactory(config.app);
  let initialized=false,maintenanceRunning=false,closing;
  const server=serverFactory((req,res)=>{
    if(!initialized){res.writeHead(503,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Retry-After':'2','X-Content-Type-Options':'nosniff'});return res.end(req.method==='HEAD'?'':JSON.stringify({error:'A loja está iniciando. Tente novamente em instantes.'}));}
    return app.handler(req,res);
  });
  const maintenance=setInterval(async()=>{if(!initialized||maintenanceRunning)return;maintenanceRunning=true;try{await app.runMaintenance();}catch{logger.error('Não foi possível liberar reservas expiradas.');}finally{maintenanceRunning=false;}},60000);maintenance.unref();
  function shutdown(){
    if(closing)return closing;clearInterval(maintenance);process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);
    server.closeAllConnections();closing=new Promise(resolve=>server.close(async()=>{try{await app.close();}catch{}resolve();}));return closing;
  }
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
  server.on('error',error=>{logger.error(startupFailure(error));shutdown();process.exitCode=1;});
  server.listen(config.port,config.host,()=>logger.log(config.mode==='local'?`MAÉVI · http://127.0.0.1:${config.port}\nPainel · http://127.0.0.1:${config.port}/admin\nChave do painel: abra data/admin-key.txt no VS Code.\nModo demonstração: pedidos de teste, sem cobrança.`:'MAÉVI · servidor iniciado; preparando a aplicação.'));
  const ready=Promise.resolve(app.ready).then(()=>{initialized=true;if(config.mode!=='local')logger.log(config.mode==='setup'?'MAÉVI · página de preparação disponível.':'MAÉVI · banco conectado. Loja e pagamentos exclusivamente de teste.');return true;},error=>{logger.error(startupFailure(error));app.close().catch(()=>{});return false;});
  return {server,app,ready,close:shutdown};
}
module.exports={createLocalServer,start,startupFailure};
