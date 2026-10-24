import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';

function validate(value) {
  if(!value||typeof value.token!=='string'||!value.token.trim()||value.token.length>2048||typeof value.guildId!=='string'||!/^\d{16,22}$/.test(value.guildId))throw new Error('بيانات الاتصال المحفوظة غير صالحة.');
  return {token:value.token.trim(),guildId:value.guildId};
}
function windowsProtection(root,action,input) {
  if(process.platform!=='win32')return Promise.reject(new Error('حفظ التوكن المشفّر متاح على ويندوز فقط.'));
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'desktop','CredentialVault.ps1'),'-Action',action],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='',failed=false;
    const fail=()=>{if(!failed){failed=true;reject(new Error('تعذّر حفظ أو قراءة البيانات بتشفير حساب ويندوز الحالي.'));}};
    const timer=setTimeout(()=>{child.kill();fail();},15000);timer.unref();
    child.stdout.on('data',data=>{output+=data.toString('ascii');if(output.length>65536){child.kill();fail();}});
    child.stderr.resume();child.stdin.on('error',fail);child.once('error',fail);
    child.once('close',code=>{clearTimeout(timer);if(code!==0||!output||!/^[A-Za-z0-9+/=]+$/.test(output))return fail();if(!failed)resolve(Buffer.from(output,'base64'));});
    child.stdin.end(Buffer.from(input).toString('base64'));
  });
}

export function createCredentialStore({root,protect=data=>windowsProtection(root,'protect',data),unprotect=data=>windowsProtection(root,'unprotect',data)}={}) {
  const file=path.join(root,'out','desktop-modern','credentials.json');
  return {
    async load(){
      if(!fs.existsSync(file))return null;
      if(fs.statSync(file).size>65536)throw new Error('ملف بيانات الاتصال غير صالح.');
      const stored=JSON.parse(fs.readFileSync(file,'utf8'));
      if(stored.version!==1||typeof stored.protectedData!=='string'||!stored.protectedData||!/^[A-Za-z0-9+/=]+$/.test(stored.protectedData))throw new Error('ملف بيانات الاتصال غير صالح.');
      return validate(JSON.parse((await unprotect(Buffer.from(stored.protectedData,'base64'))).toString('utf8')));
    },
    async save(value){
      const credentials=validate(value),encrypted=await protect(Buffer.from(JSON.stringify(credentials),'utf8'));
      if(!Buffer.isBuffer(encrypted)||!encrypted.length)throw new Error('تعذّر تشفير بيانات الاتصال.');
      fs.mkdirSync(path.dirname(file),{recursive:true});const temporary=file+'.'+randomBytes(8).toString('hex')+'.tmp';
      try{fs.writeFileSync(temporary,JSON.stringify({version:1,protectedData:encrypted.toString('base64')}),{mode:0o600,flag:'wx'});fs.renameSync(temporary,file);}
      finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
    },
    async forget(){fs.rmSync(file,{force:true});},
  };
}
