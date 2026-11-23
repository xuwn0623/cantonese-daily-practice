// Course audio is shipped with the app; no operating-system voice or cloud TTS is used.
export function createCourseAudio({baseURL=new URL('./audio/',import.meta.url),fetcher=(...args)=>fetch(...args),
  makeAudio=url=>new Audio(url),createObjectURL=blob=>URL.createObjectURL(blob),revokeObjectURL=url=>URL.revokeObjectURL(url),timeout=15000}={}){
  let manifestPromise,active,expectedClips;
  async function fetchBytes(file,signal,limit){
    const controller=new AbortController();
    const abort=()=>controller.abort(signal.reason);
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>controller.abort(Error('示范音加载超时，请检查网络或重新启动下载版，再点击重试。')),timeout);
    let onabort;
    try{
      const failure=new Promise((_,reject)=>{
        onabort=()=>reject(controller.signal.reason);
        if(controller.signal.aborted)onabort();else controller.signal.addEventListener('abort',onabort,{once:true});
      });
      return await Promise.race([failure,(async()=>{
        const response=await fetcher(new URL(file,baseURL),{signal:controller.signal});
        if(!response.ok)throw Error('示范音资源未能载入（'+response.status+'）。请重试；下载版请完整解压新版安装包。');
        if(Number(response.headers.get('content-length'))>limit)throw Error('示范音资源过大，请重新下载完整安装包。');
        const data=await response.arrayBuffer();
        if(data.byteLength>limit)throw Error('示范音资源过大，请重新下载完整安装包。');
        return data;
      })()]);
    }finally{
      clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',onabort);
    }
  }
  async function prepare(expected){
    if(expected)expectedClips=expected;
    if(!manifestPromise){
      manifestPromise=(async()=>{
        const data=JSON.parse(new TextDecoder().decode(await fetchBytes('manifest.json',null,2_000_000)));
        if(data?.version!==1||!data.clips||typeof data.clips!=='object'||Array.isArray(data.clips))throw Error('课程音频清单无效，请更新完整安装包。');
        for(const clip of Object.values(data.clips)){
          if(!clip||!(/^[a-f0-9]{64}\.wav$/).test(clip.file)||clip.file!==clip.sha256+'.wav'||typeof clip.text!=='string')throw Error('课程音频清单含无效资源，请更新完整安装包。');
        }
        return data;
      })().catch(error=>{manifestPromise=null;throw error;});
    }
    try{
      const data=await manifestPromise;
      if(expectedClips)for(const [id,item] of expectedClips){
        if(!Object.hasOwn(data.clips,id))throw Error('课程音频缺少 '+id+'，请更新完整安装包。');
        if(data.clips[id].text!==item.text)throw Error('课程与音频文字不一致，请更新完整安装包。');
      }
      return data;
    }catch(error){manifestPromise=null;throw error;}
  }
  async function read(id,signal){
    const data=await prepare();
    if(signal?.aborted)throw signal.reason;
    if(!Object.hasOwn(data.clips,id))throw Error('这条课程音频尚未备齐，请更新完整安装包。');
    const clip=data.clips[id],buffer=await fetchBytes(clip.file,signal,8_000_000);
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(n=>n.toString(16).padStart(2,'0')).join('');
    if(digest!==clip.sha256)throw Error('示范音完整性校验失败，请刷新重试或重新下载完整安装包。');
    return buffer;
  }
  function stop(){active?.finish(false);}
  function play(id,{slow=false,onstart=()=>{},onend=()=>{}}={}){
    stop();
    return new Promise((resolve,reject)=>{
      const request={controller:new AbortController(),audio:null,url:null,done:false};
      const finish=(ended,error)=>{
        if(request.done)return;request.done=true;
        clearTimeout(request.timer);request.controller.abort();
        if(request.audio){
          request.audio.removeEventListener('ended',completed);request.audio.removeEventListener('error',failed);
          request.audio.pause();request.audio.removeAttribute('src');request.audio.load();
        }
        if(request.url)revokeObjectURL(request.url);
        if(active===request)active=null;
        if(error)reject(error);else{try{if(ended)onend();resolve(ended);}catch(callbackError){reject(callbackError);}}
      };
      const completed=()=>finish(true);
      const failed=()=>finish(false,Error('示范音播放失败，请重试或使用最新版 Chrome / Edge。'));
      request.finish=finish;active=request;
      request.timer=setTimeout(()=>finish(false,Error('示范音播放超时，请重新点击播放。')),120000);
      (async()=>{
        try{
          const clip=(await prepare()).clips[id];
          const buffer=await read(id,request.controller.signal);
          if(request.done)return;
          request.url=createObjectURL(new Blob([buffer],{type:'audio/wav'}));
          const audio=makeAudio(request.url);request.audio=audio;
          audio.playbackRate=slow?0.75:1;audio.preservesPitch=true;
          audio.addEventListener('ended',completed);audio.addEventListener('error',failed);
          await audio.play();if(!request.done)onstart(clip);
        }catch(error){if(!request.done)finish(false,error.name==='NotAllowedError'?Error('浏览器暂停了声音。请再次点击「听示范」，并允许此页面播放声音。'):error);}
      })();
    });
  }
  return {prepare,read,play,stop};
}
