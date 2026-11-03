const {fail}=require('./errors.cjs');
// Inspeção estrutural e limites de dimensões; não executa nem processa imagens no servidor.
function inspect(bytes,type){
  let width=0,height=0,extension='';
  if(type==='image/png'&&bytes.length>=45&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.readUInt32BE(8)===13&&bytes.toString('ascii',12,16)==='IHDR'&&bytes.toString('ascii',bytes.length-8,bytes.length-4)==='IEND'){
    width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);extension='png';
  }else if(type==='image/jpeg'&&bytes.length>=12&&bytes[0]===255&&bytes[1]===216&&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217){
    let offset=2;
    while(offset+3<bytes.length){
      if(bytes[offset++]!==255)break;while(bytes[offset]===255)offset++;
      const marker=bytes[offset++];if(marker===0xda||marker===0xd9)break;
      if(offset+2>bytes.length)break;const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&length>=8){height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);extension='jpg';break;}
      offset+=length;
    }
  }else if(type==='image/webp'&&bytes.length>=30&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.readUInt32LE(4)===bytes.length-8&&bytes.toString('ascii',8,12)==='WEBP'){
    const format=bytes.toString('ascii',12,16);
    if(format==='VP8X'){width=bytes.readUIntLE(24,3)+1;height=bytes.readUIntLE(27,3)+1;extension='webp';}
    else if(format==='VP8L'&&bytes[20]===0x2f){const bits=bytes.readUInt32LE(21);width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1;extension='webp';}
    else if(format==='VP8 '&&bytes.toString('hex',23,26)==='9d012a'){width=bytes.readUInt16LE(26)&0x3fff;height=bytes.readUInt16LE(28)&0x3fff;extension='webp';}
  }
  if(!extension||!width||!height||width>10000||height>10000||width*height>40000000)fail(400,'Foto inválida, incompleta ou maior que 40 megapixels. Use JPG, PNG ou WebP de até 10.000 pixels por lado.');
  return {width,height,extension};
}
module.exports={inspect};
