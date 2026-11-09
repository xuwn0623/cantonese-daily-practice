let worker,ready=false,initializing=null,counter=0;
const pending=new Map();
export const isRecognizerReady=()=>ready;
function stopWorker(error){
  ready=false;
  worker?.terminate();
  worker=null;
  for(const request of pending.values()){
    clearTimeout(request.timer);
    request.reject(error);
  }
  pending.clear();
}
function startWorker(update){
  const instance=new Worker(new URL('./asr-worker.js',import.meta.url));
  worker=instance;
  instance.onmessage=({data})=>{
    if(worker!==instance)return;
    if(data.type==='progress'){update(data.message);return;}
    const request=pending.get(data.id);
    if(!request)return;
    pending.delete(data.id);
    clearTimeout(request.timer);
    if(data.error)request.reject(Error(data.error));else request.resolve(data.result);
  };
  instance.onerror=()=>{
    if(worker===instance)stopWorker(Error('语音引擎未能运行，可能是浏览器内存不足。请用电脑最新版 Chrome 重试。'));
  };
}
function request(type,payload={},timeout=180000){
  return new Promise((resolve,reject)=>{
    const id=++counter;
    const timer=setTimeout(()=>stopWorker(Error('语音处理超时，请重新启用后重试。')),timeout);
    pending.set(id,{resolve,reject,timer});
    try{worker.postMessage({id,type,...payload});}
    catch(error){stopWorker(error);}
  });
}
export function initializeRecognizer(update=()=>{}){
  if(ready)return Promise.resolve();if(initializing)return initializing;
  initializing=(async()=>{
    if(!window.WebAssembly)throw Error('浏览器不支持 WebAssembly');
    startWorker(update);
    await request('init',{},600000);
    ready=true;
  })().catch(error=>{stopWorker(error);throw error;}).finally(()=>{initializing=null;});
  return initializing;
}
export async function recognize(samples){if(!ready)throw Error('请先启用免费粤语识别');return request('recognize',{samples});}
