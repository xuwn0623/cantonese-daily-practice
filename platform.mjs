export const localMode=['localhost','127.0.0.1','::1'].includes(location.hostname)&&globalThis.document?.documentElement?.dataset.storage!=='browser';
const stateKey='cantonese:shared:progress:v1';
export async function readState(){
  if(localMode){const r=await fetch('/api/state');const value=await r.json();if(!r.ok)throw Error(value.error);return value;}
  const raw=localStorage.getItem(stateKey);
  if(!raw)return {revision:0,state:{version:1,completed:{},lessons:{},reviews:{},toneHistory:[]}};
  const saved=JSON.parse(raw);if(!Number.isInteger(saved.revision)||!saved.state)throw Error('浏览器记录无法读取，请先保留备份。');return saved;
}
export async function writeState(state,expectedRevision){
  if(localMode){const r=await fetch('/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state,expectedRevision})});const result=await r.json();if(!r.ok){const e=Error(result.error||'保存失败');e.conflict=r.status===409;throw e;}return result;}
  const write=async()=>{const before=await readState();if(before.revision!==expectedRevision){const e=Error('另一窗口已更新进度，请重新载入。');e.conflict=true;throw e;}const value={revision:expectedRevision+1,state};localStorage.setItem(stateKey,JSON.stringify(value));return value;};
  if(!navigator.locks)throw Error('当前浏览器缺少安全保存支持，请更新浏览器；可先导出进度。');
  return navigator.locks.request('cantonese-progress',write);
}
export async function voicesReady(){
  if(!window.speechSynthesis)return [];
  let voices=speechSynthesis.getVoices();if(voices.length)return voices;
  await new Promise(resolve=>{speechSynthesis.addEventListener('voiceschanged',resolve,{once:true});setTimeout(resolve,1200);});
  return speechSynthesis.getVoices();
}
export async function cantoneseVoice(){return (await voicesReady()).find(v=>/^(yue|zh[-_]HK)/i.test(v.lang));}
export async function speakLocal(text,slow,onend){
  const voice=await cantoneseVoice();if(!voice)throw Error('此设备没有粤语朗读音色。请在系统语音设置添加「中文（香港）／粤语」后重开网页；不会改用普通话。');
  return new Promise((resolve,reject)=>{const utterance=new SpeechSynthesisUtterance(text);utterance.voice=voice;utterance.lang=voice.lang;utterance.rate=slow?0.72:0.92;utterance.onend=()=>{onend();resolve();};utterance.onerror=e=>reject(Error(e.error==='interrupted'?'播放已停止':'粤语音色播放失败'));speechSynthesis.speak(utterance);});
}
