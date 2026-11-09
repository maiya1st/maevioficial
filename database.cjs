const fs=require('node:fs'),path=require('node:path');
const {AsyncLocalStorage}=require('node:async_hooks');
function mysqlSQL(sql){
  return sql.replace(/ON CONFLICT\((?:id|code)\) DO UPDATE SET data=excluded.data/g,'ON DUPLICATE KEY UPDATE data=VALUES(data)')
    .replace(/WHERE key=\?/g,'WHERE `key`=?')
    .replace(/json_extract\(data,'\$\.status'\)/gi,'order_status')
    .replace(/json_extract\(data,'\$\.reservationExpiresAt'\)/gi,'reservation_until');
}
function createDatabase({dataDir,mysql}={}){
  const context=new AsyncLocalStorage();let native,pool,tail=Promise.resolve(),closed=false;
  if(mysql){pool=require('mysql2/promise').createPool({...mysql,connectionLimit:4,waitForConnections:true,queueLimit:40,connectTimeout:8000,charset:'utf8mb4',multipleStatements:false,supportBigNumbers:true,bigNumberStrings:true,enableKeepAlive:true});}
  else{const {DatabaseSync}=require('node:sqlite');native=new DatabaseSync(path.join(dataDir,'maevi.sqlite'));native.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;');}
  async function exclusive(fn){const previous=tail;let release;tail=new Promise(resolve=>{release=resolve;});await previous;try{return await fn();}finally{release();}}
  async function query(sql,args=[],mode='all'){
    const execute=async()=>{
      if(closed)throw Error('Banco encerrado.');
      if(pool){const connection=context.getStore()||pool;const [rows]=await connection.execute(mysqlSQL(sql),args);return mode==='get'?rows[0]:rows;}
      return native.prepare(sql)[mode](...args);
    };
    return native&&!context.getStore()?exclusive(execute):execute();
  }
  const prepare=sql=>({all:(...args)=>query(sql,args),get:(...args)=>query(sql,args,'get'),run:(...args)=>query(sql,args,'run')});
  async function transaction(fn){
    if(context.getStore())throw Error('Transação aninhada não permitida.');
    if(native)return exclusive(async()=>{native.exec('BEGIN IMMEDIATE');try{const result=await context.run(true,fn);native.exec('COMMIT');return result;}catch(e){native.exec('ROLLBACK');throw e;}});
    const connection=await pool.getConnection();
    try{await connection.beginTransaction();await connection.execute('SELECT id FROM maevi_locks WHERE id=1 FOR UPDATE');const result=await context.run(connection,fn);await connection.commit();return result;}
    catch(e){try{await connection.rollback();}catch{}throw e;}finally{connection.release();}
  }
  async function init(seed,defaults,assetDir){
    if(native)native.exec(`
      CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,idem TEXT UNIQUE NOT NULL,fingerprint TEXT NOT NULL,token TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY,at TEXT NOT NULL,action TEXT NOT NULL,entity TEXT NOT NULL,entity_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS coupons(code TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS images(name TEXT PRIMARY KEY,type TEXT NOT NULL,bytes INTEGER NOT NULL,data BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS alerts(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS subscribers(email TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS orders_expiration ON orders(json_extract(data,'$.status'),json_extract(data,'$.reservationExpiresAt'));`);
    else{
      const ddl=[
        'CREATE TABLE IF NOT EXISTS maevi_locks(id INT PRIMARY KEY) ENGINE=InnoDB',
        'INSERT IGNORE INTO maevi_locks(id) VALUES(1)',
        'CREATE TABLE IF NOT EXISTS products(id INT PRIMARY KEY,data LONGTEXT NOT NULL) ENGINE=InnoDB',
        `CREATE TABLE IF NOT EXISTS orders(rowid BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,idem VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,fingerprint CHAR(64) NOT NULL,token CHAR(48) NOT NULL,data LONGTEXT NOT NULL,order_status VARCHAR(32) AS(JSON_UNQUOTE(JSON_EXTRACT(data,'$.status'))) STORED,reservation_until VARCHAR(32) AS(JSON_UNQUOTE(JSON_EXTRACT(data,'$.reservationExpiresAt'))) STORED,INDEX orders_expiration(order_status,reservation_until)) ENGINE=InnoDB`,
        'CREATE TABLE IF NOT EXISTS activity(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,at CHAR(24) NOT NULL,action VARCHAR(80) NOT NULL,entity VARCHAR(32) NOT NULL,entity_id VARCHAR(100) NOT NULL) ENGINE=InnoDB',
        'CREATE TABLE IF NOT EXISTS settings(`key` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,data LONGTEXT NOT NULL) ENGINE=InnoDB',
        'CREATE TABLE IF NOT EXISTS coupons(code VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,data LONGTEXT NOT NULL) ENGINE=InnoDB',
        'CREATE TABLE IF NOT EXISTS images(name VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,type VARCHAR(32) NOT NULL,bytes INT NOT NULL,data MEDIUMBLOB NOT NULL) ENGINE=InnoDB',
        'CREATE TABLE IF NOT EXISTS alerts(id VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,data LONGTEXT NOT NULL) ENGINE=InnoDB',
        'CREATE TABLE IF NOT EXISTS subscribers(email VARCHAR(254) PRIMARY KEY,data LONGTEXT NOT NULL) ENGINE=InnoDB'
      ];for(const sql of ddl)await pool.execute(sql.startsWith('CREATE TABLE')?sql+' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin':sql);
    }
    await transaction(async()=>{
      if(!await prepare('SELECT data FROM settings WHERE key=?').get('store'))await prepare(pool?'INSERT INTO settings(`key`,data) VALUES(?,?)':'INSERT INTO settings(key,data) VALUES(?,?)').run('store',JSON.stringify(defaults));
      if(!await prepare('SELECT id FROM products LIMIT 1').get())for(const p of seed)await prepare('INSERT INTO products(id,data) VALUES(?,?)').run(p.id,JSON.stringify(p));
      const demoImages=new Map(seed.map(p=>[p.sourceImage,p.image]));
      for(const row of await prepare('SELECT id,data FROM products').all()){
        const p=JSON.parse(row.data);if(demoImages.has(p.image)&&fs.existsSync(path.join(assetDir,path.basename(demoImages.get(p.image))))){p.image=demoImages.get(p.image);p.version=(p.version||0)+1;await prepare('UPDATE products SET data=? WHERE id=?').run(JSON.stringify(p),p.id);}
      }
    });
  }
  async function close(){if(closed)return;if(pool){await pool.end();closed=true;}else await exclusive(()=>{native.close();closed=true;});}
  return {prepare,transaction,init,close,kind:pool?'mysql':'sqlite'};
}
module.exports={createDatabase,mysqlSQL};
