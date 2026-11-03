const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{parseEnv}=require('node:util');
function prepare(){
  const file=path.join(__dirname,'.env.hostinger.local');if(fs.existsSync(file))return file;
  const local=path.join(__dirname,'.env.local'),env=fs.existsSync(local)?parseEnv(fs.readFileSync(local,'utf8')):{};
  const fields={MAEVI_HOSTING:'hostinger',MAEVI_PUBLIC_URL:'',MAEVI_ADMIN_KEY:crypto.randomBytes(24).toString('hex'),MAEVI_DB_HOST:'127.0.0.1',MAEVI_DB_PORT:'3306',MAEVI_DB_NAME:'',MAEVI_DB_USER:'',MAEVI_DB_PASSWORD:'',MAEVI_MP_MODE:env.MAEVI_MP_MODE||'disabled',MAEVI_MP_ACCESS_TOKEN:env.MAEVI_MP_ACCESS_TOKEN||'',MAEVI_MP_WEBHOOK_SECRET:env.MAEVI_MP_WEBHOOK_SECRET||''};
  fs.writeFileSync(file,'# PRIVADO. Copie os valores somente para as variáveis da sua hospedagem.\n# Não envie este arquivo ao GitHub, ZIP ou chat.\n'+Object.entries(fields).map(([name,value])=>name+'='+JSON.stringify(value)).join('\n')+'\n',{flag:'wx',mode:0o600});return file;
}
if(require.main===module){try{prepare();console.log('Arquivo privado .env.hostinger.local preparado. Abra-o no VS Code. Nenhuma credencial foi exibida.');}catch{console.error('Não foi possível preparar o arquivo privado.');process.exitCode=1;}}
module.exports={prepare};
