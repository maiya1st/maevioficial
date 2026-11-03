// Entry point loaded directly by Node or by Hostinger's module loader.
const {start,startupFailure}=require('./http-server.cjs');
try{start();}catch(error){console.error(startupFailure(error));process.exitCode=1;}
