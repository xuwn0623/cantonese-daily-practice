/* sherpa-onnx 1.12.23 / WSYue SenseVoice 2025-09-09. All inference stays in this worker. */
let recognizer;
const report=message=>postMessage({type:'progress',message});
async function download(path,label){
  let cache;try{cache=await caches.open('cantonese-asr-2025-09-09-v1');const stored=await cache.match(path);if(stored){report('读取已缓存的'+label);return new Uint8Array(await stored.arrayBuffer());}}catch{}
  const response=await fetch(path);if(!response.ok)throw Error(label+'下载失败（'+response.status+'）');
  const bytes=new Uint8Array(await response.arrayBuffer());
  try{await cache?.put(path,new Response(bytes));}catch{}
  return bytes;
}
async function initialize(){
  const configResponse=await fetch('./asr-config.json');if(!configResponse.ok)throw Error('未找到免费模型配置');
  const config=await configResponse.json();
  report('首次准备约 249 MB 识别资源；录音不会上传。');
  const parts=[];let size=0;
  for(let i=0;i<config.parts.length;i++){report('准备粤语模型 '+(i+1)+' / '+config.parts.length);const part=await download(config.parts[i],'模型片段');parts.push(part);size+=part.length;}
  if(size!==config.bytes)throw Error('模型大小校验失败，请清除模型缓存后重试。');
  const model=new Uint8Array(size);let offset=0;for(let i=0;i<parts.length;i++){model.set(parts[i],offset);offset+=parts[i].length;parts[i]=null;}
  if(config.sha256){const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',model))].map(x=>x.toString(16).padStart(2,'0')).join('');if(digest!==config.sha256)throw Error('模型完整性校验未通过');}
  const tokens=await download(config.tokens,'字表');
  report('模型已备好，正在本机启动…');
  await new Promise((resolve,reject)=>{
    self.Module={locateFile:file=>new URL('./vendor/'+file,self.location.href).href,onRuntimeInitialized:resolve,onAbort:reason=>reject(Error('语音引擎启动失败：'+String(reason).slice(0,100))),print:()=>{},printErr:()=>{}};
    importScripts('./vendor/sherpa-onnx-runtime-no-data.js');
  });
  Module.FS_createDataFile('/','sense-voice.onnx',model,true,false,true);
  Module.FS_createDataFile('/','tokens.txt',tokens,true,false,true);
  importScripts('./vendor/sherpa-onnx-asr.js');
  recognizer=new OfflineRecognizer({modelConfig:{tokens:'./tokens.txt',numThreads:1,provider:'cpu',debug:0,senseVoice:{model:'./sense-voice.onnx',language:'yue',useInverseTextNormalization:0}}},Module);
  if(!recognizer.handle)throw Error('模型加载失败');
}
self.onmessage=async({data})=>{
  try{
    if(data.type==='init'){if(!recognizer)await initialize();postMessage({id:data.id,result:true});}
    else if(data.type==='recognize'){
      if(!recognizer)throw Error('语音识别未启用');
      const stream=recognizer.createStream();
      try{stream.acceptWaveform(16000,new Float32Array(data.samples));recognizer.decode(stream);const result=recognizer.getResult(stream);postMessage({id:data.id,result:(result.text||'').replace(/<\|[^>]*\|>/g,'').trim()});}finally{stream.free();}
    }
  }catch(error){postMessage({id:data.id,error:error.message||String(error)});}
};
