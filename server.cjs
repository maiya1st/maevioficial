const http = require('node:http');
const { createApp } = require('./backend.cjs');
function createLocalServer(handler){
  const server=http.createServer({maxHeaderSize:8192,headersTimeout:10000,requestTimeout:15000,keepAliveTimeout:5000,connectionsCheckingInterval:1000},handler);
  server.maxHeadersCount=50;server.maxRequestsPerSocket=100;server.maxConnections=32;
  server.setTimeout(15000,socket=>socket.destroy());
  return server;
}
if(require.main===module){
  const path=require('node:path'),fs=require('node:fs'),envFile=path.join(__dirname,'.env.local');
  if(fs.existsSync(envFile))process.loadEnvFile(envFile);
  const port = Number(process.env.PORT || 5173);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('PORT deve ser uma porta entre 1024 e 65535.');
  const app = createApp({port,paymentEnv:process.env});
  const server = createLocalServer(app.handler);
  const maintenance=setInterval(()=>{try{app.runMaintenance();}catch{console.error('Não foi possível liberar reservas expiradas.');}},60000);maintenance.unref();
  function shutdown(){clearInterval(maintenance);server.closeAllConnections();server.close(()=>{app.close();});}
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? 'Porta ocupada. Encerre a versão anterior com Ctrl+C e inicie novamente.' : 'Não foi possível iniciar o servidor local.');
    clearInterval(maintenance);app.close(); process.exitCode=1;
  });
  server.listen(port,'127.0.0.1',()=>console.log(`MAÉVI · http://127.0.0.1:${port}\nPainel · http://127.0.0.1:${port}/admin\nChave do painel: abra data/admin-key.txt no VS Code.\nModo demonstração: pedidos de teste, sem cobrança.`));
}
module.exports={createLocalServer};
