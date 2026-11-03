const http = require('node:http');
const { createApp } = require('./backend.cjs');
function createLocalServer(handler){
  const server=http.createServer({maxHeaderSize:8192,headersTimeout:10000,requestTimeout:15000,keepAliveTimeout:5000,connectionsCheckingInterval:1000},handler);
  server.maxHeadersCount=50;server.maxRequestsPerSocket=100;server.maxConnections=32;
  server.setTimeout(15000,socket=>socket.destroy());
  return server;
}
if(require.main===module){
  start().catch(()=>{console.error('Não foi possível iniciar a MAÉVI. Confira as variáveis da hospedagem, as permissões e a conexão com o banco. Nenhuma credencial foi exibida.');process.exitCode=1;});
}
async function start(){
  const path=require('node:path'),fs=require('node:fs'),envFile=path.join(__dirname,'.env.local');
  if(fs.existsSync(envFile))process.loadEnvFile(envFile);
  const {configuration,setupHandler}=require('./hosting.cjs');const config=configuration(process.env),{port}=config;
  const app=config.mode==='setup'?{handler:setupHandler,ready:Promise.resolve(),runMaintenance:async()=>0,close:async()=>{}}:createApp(config.app);
  try{await app.ready;}catch(e){await app.close();throw e;}
  const server = createLocalServer(app.handler);
  let maintenanceRunning=false;
  const maintenance=setInterval(async()=>{if(maintenanceRunning)return;maintenanceRunning=true;try{await app.runMaintenance();}catch{console.error('Não foi possível liberar reservas expiradas.');}finally{maintenanceRunning=false;}},60000);maintenance.unref();
  function shutdown(){clearInterval(maintenance);server.closeAllConnections();server.close(()=>{app.close().catch(()=>{process.exitCode=1;});});}
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? 'Porta ocupada. Encerre a versão anterior com Ctrl+C e inicie novamente.' : 'Não foi possível iniciar o servidor local.');
    clearInterval(maintenance);app.close().catch(()=>{}); process.exitCode=1;
  });
  server.listen(port,config.host,()=>console.log(config.mode==='local'?`MAÉVI · http://127.0.0.1:${port}\nPainel · http://127.0.0.1:${port}/admin\nChave do painel: abra data/admin-key.txt no VS Code.\nModo demonstração: pedidos de teste, sem cobrança.`:config.mode==='setup'?'MAÉVI · preparação da hospedagem. Vitrine, painel e pagamentos aguardam configuração.':'MAÉVI · hospedagem com MySQL/MariaDB e fotos persistentes. Pedidos e pagamentos exclusivamente de teste.'));
}
module.exports={createLocalServer,start};
