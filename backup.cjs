const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
function backup({dataDir=path.join(__dirname,'data'),assetDir=path.join(__dirname,'assets'),destination=path.join(dataDir,'backups')}={}){
  const source=path.join(dataDir,'maevi.sqlite');if(!fs.existsSync(source))throw Error('Inicie a loja uma vez antes de gerar o backup.');
  fs.mkdirSync(destination,{recursive:true});const folder=fs.mkdtempSync(path.join(destination,'maevi-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'));
  const target=path.join(folder,'maevi.sqlite'),db=new DatabaseSync(source);
  try{db.exec('PRAGMA busy_timeout=5000');db.prepare('VACUUM INTO ?').run(target);}finally{db.close();}
  const snapshot=new DatabaseSync(target,{readOnly:true});try{const result=snapshot.prepare('PRAGMA quick_check').get();if(Object.values(result)[0]!=='ok')throw Error('O banco copiado não passou na verificação de integridade.');}finally{snapshot.close();}
  fs.cpSync(assetDir,path.join(folder,'assets'),{recursive:true,errorOnExist:true,force:false});
  const key=path.join(dataDir,'admin-key.txt');if(fs.existsSync(key))fs.copyFileSync(key,path.join(folder,'admin-key.txt'),fs.constants.COPYFILE_EXCL);
  const manifest={createdAt:new Date().toISOString(),version:require('./package.json').version,databaseSha256:crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'),containsPrivateData:true};
  fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});return folder;
}
if(require.main===module){try{console.log('Backup privado criado em:\n'+backup());console.log('O backup inclui banco, fotos e chave administrativa. Mantenha-o em local privado.');}catch(error){console.error('Backup não concluído: '+error.message);process.exitCode=1;}}
module.exports={backup};
