import {localMode,readState,writeState,cantoneseVoice,speakLocal} from './platform.mjs';
import {workFor,addCount,corePhrases,questions,lessonRequirements,phraseRound,recordPhraseRound,pendingPhraseRounds} from './lesson-engine.mjs';
import {compareTranscript,resample} from './transcript.mjs';
import {initializeRecognizer,recognize,isRecognizerReady} from './asr.mjs';
import {lessonView} from './lesson-view.mjs';
import {normalizeState,completeLesson,reviewPhrase,weekCount,localDate} from './progress.mjs';
import {analyzePitch,recordingQuality,toneFeedback} from './pitch.mjs';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const titles={today:'今日练习',course:'12 周课程',tones:'声调练习',reviews:'到期复习',progress:'学习记录',settings:'使用与备份'};
const stages=['发音基础与复习','理解与示范','听辨与回忆','三轮开口练习','情境迁移','回顾与打卡'];
const minutes=[8,8,8,12,7,2];
let curriculum,state,stateIds,revision=0,view='today',selected,step=0,tone=1,running=false,ready=false,player=null,playToken=0,toastTimer,imported=null,quizMessage='';
const phraseMap=new Map(),audioMap=new Map();
const pendingPrefix='cantonese-local:pending:';
const pendingKey=pendingPrefix+crypto.randomUUID();
let pendingState=null,confirmedState='',saveQueue=null,locallyProtected=false,saveConflict=false;
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,6500);}
function draft(id=selected){
  return state.lessons[id]??=( {seconds:0,steps:[],listened:[],recorded:[],roleplays:[],quizPassed:false});
}
function current(){return curriculum.lessons.find(l=>l.id===selected)||curriculum.lessons[0];}
function nextLesson(){return curriculum.lessons.find(l=>!state.completed[l.id])||curriculum.lessons.at(-1);}
function due(){const today=localDate();return Object.entries(state.reviews).filter(([,r])=>r.due<=today).map(([id])=>phraseMap.get(id)).filter(Boolean);}
function checkpoint(){
  pendingState=JSON.stringify(state);
  try{
    localStorage.setItem(pendingKey,JSON.stringify({savedAt:new Date().toISOString(),state}));
    locallyProtected=true;
  }catch{locallyProtected=false;}
  if(!saveQueue&&!saveConflict)$('#save-status').textContent='有待保存的进度';
}
function removeCheckpoint(key,expected){
  try{if(expected===undefined||localStorage.getItem(key)===expected)localStorage.removeItem(key);}catch{}
}
function readRecoveries(){
  const drafts=[];
  try{
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i);
      if(!key?.startsWith(pendingPrefix)||key===pendingKey)continue;
      const raw=localStorage.getItem(key);
      try{
        const entry=JSON.parse(raw),saved=normalizeState(entry.state,stateIds);
        if(JSON.stringify(saved)!==confirmedState)drafts.push({key,raw,state:saved,savedAt:entry.savedAt});
      }catch{}
    }
  }catch{}
  return drafts.sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt)));
}
function flush(){
  if(!pendingState)return Promise.resolve(true);
  if(saveQueue)return saveQueue;
  if(saveConflict)return Promise.resolve(false);
  $('#save-status').textContent='正在保存…';
  saveQueue=(async()=>{
    while(pendingState){
      const snapshot=pendingState;
      const data=await writeState(JSON.parse(snapshot),revision);
      revision=data.revision;confirmedState=snapshot;
      if(snapshot===pendingState){pendingState=null;removeCheckpoint(pendingKey);}
    }
    $('#save-status').textContent=localMode?'已保存到本机':'已保存到此浏览器';return true;
  })().catch(error=>{
    saveConflict=!!error.conflict;
    const next=locallyProtected?'重新载入后，可在「使用与备份」找回待保存进度。':'请先到「使用与备份」导出学习进度。';
    $('#save-status').textContent=(saveConflict?'检测到其他窗口更新。':'进度尚未写入。')+next;
    toast(error.message+' '+next);return false;
  }).finally(()=>{saveQueue=null;});
  return saveQueue;
}
function save(){checkpoint();return flush();}
function download(data,name){const url=URL.createObjectURL(data),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function downloadProgress(progress,name){
  download(new Blob([JSON.stringify({app:'cantonese-local',exported:new Date().toISOString(),state:progress},null,2)],{type:'application/json'}),name+'_'+localDate()+'.json');
}
function nav(name){
  if(!ready)return;
  stopPlayer();running=false;flush();view=name;quizMessage='';render();$('#main').focus();
}
function statsIntro(title,description){
  const days=weekCount(state,localDate());
  return '<div class="intro"><div><h1>'+esc(title)+'</h1><p>'+esc(description)+'</p></div><div class="weekly"><div><strong>'+days+'</strong> / 4 天</div><small>本周已完成学习</small><div class="weekdots">'+[0,1,2,3].map(n=>'<span class="'+(n<days?'done':'')+'"></span>').join('')+'</div></div></div>';
}
function actions(p,record=false){
  return '<div class="button-row"><button data-action="play" data-id="'+esc(p.id)+'">听示范</button><button data-action="slow" data-id="'+esc(p.id)+'">慢速听</button>'+(record?'<button data-action="record-phrase" data-id="'+esc(p.id)+'">录音跟读</button>':'')+(draft().recorded.includes(p.id)?'<span class="checked">已录音练习</span>':draft().listened.includes(p.id)?'<span class="checked">已听示范</span>':'')+'</div>';
}
function phrase(p,record=false){return '<article class="phrase"><div class="cantonese" lang="yue-HK">'+esc(p.text)+'</div><p class="jyutping">'+esc(p.jyutping)+'</p><p class="meaning">'+esc(p.meaning)+'</p>'+actions(p,record)+(p.note?'<p class="note">'+esc(p.note)+'</p>':'')+'</article>';}
function canFinishStep(){
  const requirements=lessonRequirements(current(),draft());
  return step===5?requirements.slice(0,5).every(Boolean):requirements[step];
}
function todayPage(){return lessonView({l:current(),d:draft(),state,step,running,stages,minutes,quizMessage,asrReady:isRecognizerReady(),statsIntro,phrase,reviewCard,due,formatTime,canFinishStep});}
function coursePage(){
  return statsIntro('给日常交流的 12 周','48 次课程，每周 4 次；第 5 次可到「复习」或「声调练习」巩固。课程可预览，主线从未完成的一课继续。')+Array.from({length:12},(_,i)=>{
    const ls=curriculum.lessons.filter(l=>l.week===i+1),done=ls.filter(l=>state.completed[l.id]).length;
    return '<details class="course-week" '+(current().week===i+1?'open':'')+'><summary>第 '+(i+1)+' 周 <span class="badge">'+done+' / 4 次完成</span></summary><div class="course-list">'+ls.map(l=>'<button data-action="lesson" data-id="'+esc(l.id)+'"><span>'+l.session+'. '+esc(l.title)+'<small>'+esc(l.goal)+'</small></span><span class="badge">'+(state.completed[l.id]?'已完成':l.session===4?'综合复习':'45 分钟')+'</span></button>').join('')+'</div></details>';
  }).join('');
}
function idealChart(n){
  const paths={1:'M40 30 L310 30',2:'M40 92 Q150 85 310 30',3:'M40 80 L310 80',4:'M40 112 Q170 120 310 140',5:'M40 132 Q170 120 310 75',6:'M40 121 L310 121'};
  return '<svg class="tone-ideal" viewBox="0 0 350 160" role="img" aria-label="第'+n+'声的教学示意"><line x1="40" y1="30" x2="310" y2="30"/><line x1="40" y1="80" x2="310" y2="80"/><line x1="40" y1="130" x2="310" y2="130"/><text x="10" y="34">高</text><text x="10" y="84">中</text><text x="10" y="134">低</text><path d="'+paths[n]+'"/></svg>';
}
function tonesPage(){
  const t=curriculum.tones.find(t=>t.number===tone);
  return statsIntro('听出分别，再开口','先练一个字。比较音高的升降走势，每次只改一个问题。')+'<div class="tone-select">'+curriculum.tones.map(t=>'<button data-action="tone" data-tone="'+t.number+'" class="'+(tone===t.number?'active':'')+'"><b>'+esc(t.character)+'</b><span>'+esc(t.jyutping)+'</span></button>').join('')+'</div><section class="tone-work"><div><div class="tone-hero" lang="yue-HK">'+esc(t.character)+'</div><p class="jyutping">'+esc(t.jyutping)+' · 第 '+tone+' 声</p><p>'+esc(t.description)+'</p><p class="tone-description">'+esc(t.tip)+'</p><div class="button-row"><button class="primary" data-action="play" data-id="tone-'+tone+'">听这个字</button><button data-action="record-tone">录音看走势</button></div></div><div>'+idealChart(tone)+'<p class="note">教学示意，非声学标尺。每个人音域不同，曲线相似也不等于读音正确。</p><div class="focus-note">点击录音，只说上面的一个字，然后停止。系统会检查声音质量，并给出上扬、下降或平稳的练习提示。</div></div></section><p class="note">香港粤语存在自然读音变化。这里练的是孤立字的教学读法；1、3、6 声的高低与 2、5 声的起点，仍需听示范并回听比较。</p>';
}
function reviewCard(p){
  return '<article class="review-item"><button data-action="play" data-id="'+esc(p.id)+'">听音回忆</button><details><summary>查看原句与意思</summary><div class="cantonese">'+esc(p.text)+'</div><p class="jyutping">'+esc(p.jyutping)+'</p><p>'+esc(p.meaning)+'</p></details><div class="button-row"><button data-action="review-again" data-id="'+esc(p.id)+'">还不熟</button><button data-action="review-good" data-id="'+esc(p.id)+'">能自己说出来</button></div></article>';
}
function reviewsPage(){const list=due();return statsIntro('把学过的，变成会用的','听音回忆，再自己说一遍。不熟的表达会更早出现。')+(list.length?list.map(reviewCard).join(''):'<div class="empty"><h2>今天没有到期表达</h2><p>完成课程后，表达会进入复习。也可以回到课程重新练习。</p><button data-nav="today" class="primary">继续今日练习</button></div>');}
function progressPage(){
  const entries=Object.entries(state.completed).sort((a,b)=>b[1].date.localeCompare(a[1].date));
  const days=new Set(entries.map(([,x])=>x.date)).size;
  return statsIntro('看见练习留下的变化','记录的是实际练习。熟练程度需要通过新的听力材料和真实交流检查。')+'<div class="stats"><div><strong>'+entries.length+' / 48</strong><span>已完成课程</span></div><div><strong>'+days+'</strong><span>累计学习天数</span></div><div><strong>'+Math.round(Object.values(state.lessons).reduce((sum,d)=>sum+d.seconds,0)/60)+'</strong><span>实际计时分钟</span></div></div><h2>课程记录</h2>'+(entries.length?'<table class="history"><thead><tr><th>日期</th><th>课程</th><th>计时</th><th>待核对</th></tr></thead><tbody>'+entries.map(([id,v])=>'<tr><td>'+esc(v.date)+'</td><td>'+esc(curriculum.lessons.find(l=>l.id===id)?.title)+'</td><td>'+v.minutes+' 分钟</td><td>'+pendingPhraseRounds(curriculum.lessons.find(l=>l.id===id),state.lessons[id])+' 轮</td></tr>').join('')+'</tbody></table>':'<p class="empty">完成第一课后，记录会出现在这里。</p>')+'<h2 class="settings-section">最近的声调练习</h2>'+state.toneHistory.slice(-12).reverse().map(v=>'<p><span class="badge">'+esc(v.date)+' · 第 '+v.tone+' 声</span> '+esc(v.message)+'</p>').join('');
}
function settingsPage(){
  return '<h1>使用与备份</h1><section class="settings-section"><h2>开始练习</h2><p>按六个环节学习，点击开始计时。首次使用「启用免费粤语识别」会准备约 249 MB 资源并缓存。识别在设备浏览器运行，录音不上传；关闭页面后需重新载入引擎。</p><p>建议戴耳机。首次录音允许麦克风；权限关闭时可在地址栏的网站设置中重新允许。</p><p>'+ (localMode?'这是 Mac 本机版。双击启动文件，终端保持开启。':'这是互联网共享版。大家可以同时打开；每个人的进度仅保存在自己的浏览器，没有共享账号或自动跨设备同步。')+'</p></section><section class="settings-section"><h2>反馈怎么看</h2><ul><li>录音质量：静音、噪声或录音太短时，不进入内容通过。</li><li>目标内容：显示实际识别文字；固定句识别未匹配时，可自行标记为待核对，安排复习。识别可能听错，文字相同也不证明声母、韵母、声调准确。</li><li>单字练习：观察音高升降并提示口型；暂无可靠的音素准确度评分。自然变调、连读及个人音域会影响结果。</li><li>情境回答：记录识别文字和练习次数，暂不判断语义是否恰当。</li></ul></section><section class="settings-section"><h2>设备与示范音</h2><p>香港粤语合成音用于入门示范，仍可能有个别字音偏差。共享版使用访问者的粤语音色；如果没有，请在设备语音设置添加中文（香港）或粤语。系统不会用普通话代替。大型识别模型优先在电脑使用，手机是否可运行取决于可用内存。</p></section><section class="settings-section"><h2>学习数据</h2><p>'+ (localMode?'进度保存在本机 data/progress.json，并保留上次写入备份。':'进度保存在此浏览器。清理网站数据、更换设备或无痕窗口可能丢失记录，请定期导出。')+'录音仅在当前录音窗口临时保留，需留存请点击保存录音。</p><button data-action="export" class="primary">导出学习进度</button><label>从备份恢复（先下载当前记录）<input id="import-file" type="file" accept=".json,application/json"></label><div id="import-preview"></div></section><section class="settings-section"><h2>分享与来源</h2><p>127.0.0.1 只供这台电脑使用。互联网版可以把当前网页地址发给朋友；课程共用，练习记录各自保留。分享不包含你的本机录音或学习记录。</p><p>采用香港语言学学会粤拼，香港用法为主，地区变化见备注。粤拼是系统标音方案；没有用普通话谐音代替。</p><a href="https://jyutping.org/jyutping/" target="_blank" rel="noreferrer">粤拼方案</a> · <a href="./THIRD_PARTY.md" target="_blank">语音模型、许可证与能力说明</a></section>';
}
function recoveryPanel(){
  const recoveries=readRecoveries();
  if(!recoveries.length)return '';
  return '<section class="settings-section"><h2>未确认的本地进度</h2><p>浏览器留有尚未确认写入的进度副本。可下载留存，或确认用其中一份替换当前进度。恢复前会下载当前进度。建议先关闭还在编辑的其他学习台窗口。</p>'+recoveries.map(entry=>{
    const time=new Date(entry.savedAt).toLocaleString('zh-CN');
    return '<div class="import-preview"><p>'+esc(time)+' · 已完成 '+Object.keys(entry.state.completed).length+' 课</p><div class="button-row"><button data-action="download-recovery" data-id="'+esc(entry.key)+'">下载这份副本</button><button data-action="restore-recovery" data-id="'+esc(entry.key)+'">确认用这份副本替换进度</button></div></div>';
  }).join('')+'</section>';
}
function render(){
  document.querySelectorAll('.sidebar [data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===view));
  $('#breadcrumb').textContent=titles[view];$('#due-count').textContent=due().length||'';
  $('#main').innerHTML=({today:todayPage,course:coursePage,tones:tonesPage,reviews:reviewsPage,progress:progressPage,settings:settingsPage})[view]()+(view==='settings'?recoveryPanel():'');
}
function formatTime(seconds){return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');}
function stopPlayer(){playToken++;if(player){player.pause();player=null;}window.speechSynthesis?.cancel();}
async function play(id,slow=false){
  stopPlayer();const token=playToken;
  toast('正在准备粤语示范音…');
  try{
    const lessonId=selected;
    const ended=()=>{if(view==='today'&&selected===lessonId){const d=draft(lessonId);if(!d.listened.includes(id))d.listened.push(id);save();render();}};
    if(!localMode){const item=audioMap.get(id);if(!item)throw Error('找不到示范内容');await speakLocal(item.text,slow,()=>{if(token===playToken)ended();});return;}
    const res=await fetch('/api/tts?id='+encodeURIComponent(id)+'&slow='+(slow?'1':'0'));
    if(!res.ok)throw new Error((await res.json()).error);
    const blob=await res.blob();if(token!==playToken)return;
    const url=URL.createObjectURL(blob),a=new Audio(url);player=a;
    a.addEventListener('ended',()=>{
      URL.revokeObjectURL(url);
      if(token===playToken)ended();
    },{once:true});
    a.addEventListener('error',()=>{URL.revokeObjectURL(url);toast('示范音播放失败，请重试。');},{once:true});
    await a.play();toast('正在播放粤语系统示范音');
  }catch(e){toast(e.message||'无法播放示范音');}
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button||!ready||button.disabled)return;
  if(button.dataset.nav){nav(button.dataset.nav);return;}
  const a=button.dataset.action,id=button.dataset.id;
  if(a==='load-asr'){await loadAsrUI();return;}
  if(a==='play'||a==='slow'){await play(id,a==='slow');return;}
  if(a==='lesson'){selected=id;step=0;nav('today');}
  else if(a==='next-lesson'){selected=nextLesson().id;step=0;nav('today');}
  else if(a==='step'){step=Number(button.dataset.step);quizMessage='';render();}
  else if(a==='timer'){running=!running;if(!running)flush();render();}
  else if(a==='tone'){tone=Number(button.dataset.tone);stopPlayer();render();}
  else if(a==='phonetic-answer'){if(Number(button.dataset.answer)===current().phonetics.check.answer){if(!workFor(draft()).answers.includes('phonetic-check'))workFor(draft()).answers.push('phonetic-check');save();quizMessage='';}else quizMessage='再看看音节拆解：声母、韵母和调号分别承担什么作用？';render();}
  else if(a==='quiz-v2'){const q=questions(current()).find(q=>q.id===id);if(!q||(q.kind!=='recall'&&!draft().listened.includes(q.id)))return;if(Number(button.dataset.answer)===q.answer){if(!workFor(draft()).answers.includes(q.id))workFor(draft()).answers.push(q.id);save();quizMessage='上一题：'+q.explanation;}else quizMessage='这次还没选对，再听一次或回忆句式。';render();}
  else if(a==='reset-quiz'){workFor(draft()).answers=workFor(draft()).answers.filter(x=>x==='phonetic-check');step=2;save();render();}
  else if(a==='record-sound'){const i=Number(button.dataset.index),p=current().phonetics.examples[i];openRecorder({kind:'sound',id:'sound-'+i,lessonId:selected,tone:p.tone,target:p.text,expected:p.text,help:p.jyutping+' · '+p.tip});}
  else if(a==='answer'){
    if(Number(button.dataset.answer)===current().listening.answer){draft().quizPassed=true;save();}
    else quizMessage='这次还没选对。再听一次，留意句中的关键词。';
    render();
  }else if(a==='finish-step'){
    if(!canFinishStep())return;
    const d=draft();if(!d.steps.includes(step))d.steps.push(step);
    if(step===5){
      completeLesson(state,selected,localDate(),d.seconds/60);
      for(const p of current().phrases)if(!state.reviews[p.id])reviewPhrase(state,p.id,false,localDate());
      running=false;const ok=await save();toast(ok?'已完成本课，学习记录已保存。':'保存失败，请先导出进度以免丢失。');
    }else{step++;save();}
    render();
  }else if(a==='review-again'||a==='review-good'){
    reviewPhrase(state,id,a==='review-good',localDate());save();render();toast(a==='review-good'?'已安排下一次复习。':'已安排明天再练。');
  }else if(a==='record-tone'){
    const t=curriculum.tones.find(t=>t.number===tone);
    openRecorder({kind:'tone',tone,target:t.character+' · '+t.jyutping,help:'一次只读这个字，约半秒到一秒。录完点击停止。'});
  }else if(a==='record-phrase'){
    const p=phraseMap.get(id),{count,target,help}=phraseRound(draft(),p);
    openRecorder({kind:'phrase',id,lessonId:selected,round:count,target,help,expected:p.text,jyutping:p.jyutping});
  }else if(a==='record-role'){
    const i=Number(button.dataset.index),r=current().roleplay[i];
    openRecorder({kind:'role',id:selected+'-role-'+i,lessonId:selected,target:r.prompt,help:'用粤语回答。录完回听，自己检查有没有完成这个交流任务。'});
  }else if(a==='export'){
    downloadProgress(state,'粤语学习进度');
  }else if(a==='confirm-import'&&imported){
    await restoreProgress(imported);
  }else if(a==='download-recovery'||a==='restore-recovery'){
    const entry=readRecoveries().find(item=>item.key===id);
    if(!entry){render();toast('这份副本已更新，请重新查看。');return;}
    if(a==='download-recovery')downloadProgress(entry.state,'待确认_粤语学习进度');
    else await restoreProgress(entry.state,entry);
  }
});
async function restoreProgress(progress,entry){
  downloadProgress(state,'恢复前_粤语学习进度');
  state=progress;imported=null;selected=nextLesson().id;step=0;
  const ok=await save();
  if(ok&&entry)removeCheckpoint(entry.key,entry.raw);
  render();toast(ok?'备份已恢复；恢复前进度也已下载。':'恢复后尚未保存，请保留备份并重试。');
}
document.addEventListener('change',async e=>{
  if(e.target.id!=='import-file'||!e.target.files[0])return;
  const file=e.target.files[0];imported=null;
  try{
    if(file.size>2_000_000)throw new Error('备份文件过大');
    const data=JSON.parse(await file.text());
    if(data.app!=='cantonese-local')throw new Error('这不是粤语学习台的进度备份');
    imported=normalizeState(data.state,stateIds);
    $('#import-preview').innerHTML='<div class="import-preview">包含 '+Object.keys(imported.completed).length+' 次已完成课程。确认恢复会替换当前进度，并先下载一份恢复前备份。<p><button data-action="confirm-import" class="primary">确认恢复这份备份</button></p></div>';
  }catch(error){$('#import-preview').textContent=error.message;toast('备份未导入，原进度保留。');}
});
setInterval(()=>{
  if(ready&&running&&view==='today'&&!document.hidden){
    const d=draft();d.seconds++;const timer=$('#timer-value');if(timer)timer.textContent=formatTime(d.seconds);
    checkpoint();if(d.seconds%15===0)flush();
  }
},1000);
document.addEventListener('visibilitychange',()=>{if(ready&&document.hidden){running=false;flush();}});
window.addEventListener('beforeunload',event=>{
  if(pendingState&&!locallyProtected){event.preventDefault();event.returnValue=true;}
});

let recordConfig,stream,mediaRecorder,recordTimeout,recordInterval,recordToken=0,lastBlob,lastUrl,recordBusy=false,pendingRecording=null;
const toneReferences=new Map();
async function decodeAudio(buffer){
  const context=new (window.AudioContext||window.webkitAudioContext)();
  try{return await context.decodeAudioData(buffer);}finally{await context.close();}
}
async function loadToneReference(number){
  if(!localMode)return null;
  if(toneReferences.has(number))return toneReferences.get(number);
  try{
    const res=await fetch('/api/tts?id=tone-'+number,{signal:AbortSignal.timeout(5000)});
    if(!res.ok)return null;
    const decoded=await decodeAudio(await res.arrayBuffer());
    const analysis=analyzePitch(decoded.getChannelData(0),decoded.sampleRate);
    toneReferences.set(number,analysis);return analysis;
  }catch{return null;}
}
function clearPendingRecording(){
  pendingRecording=null;
  $('#pending-recording').hidden=true;
}
function openRecorder(config){
  clearPendingRecording();
  stopPlayer();recordConfig=config;$('#recorder-title').textContent=(config.kind==='tone'||config.kind==='sound')?'单字声调练习':'录音与回听';
  $('#recorder-target').textContent=config.target;$('#recorder-help').textContent=config.help;
  $('#record-result').hidden=true;$('#record-start').hidden=false;$('#record-start').disabled=false;$('#record-stop').hidden=true;
  $('#record-status').classList.remove('live');$('#record-status').textContent='准备好了就开始。麦克风只在录音时开启。';
  $('#recorder-dialog').showModal();
}
function releaseStream(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}clearTimeout(recordTimeout);clearInterval(recordInterval);}
function resetPlayback(){
  const audio=$('#record-playback');
  audio.pause();audio.removeAttribute('src');audio.load();
  if(lastUrl)URL.revokeObjectURL(lastUrl);
  lastUrl=null;lastBlob=null;
}
function closeRecorder(){
  recordToken++;if(mediaRecorder?.state==='recording')mediaRecorder.stop();releaseStream();recordBusy=false;
  clearPendingRecording();resetPlayback();$('#recorder-dialog').close();render();
}
$('#close-recorder').onclick=closeRecorder;$('#finish-recording').onclick=closeRecorder;
$('#recorder-dialog').addEventListener('cancel',e=>{e.preventDefault();closeRecorder();});
$('#record-stop').onclick=()=>{if(mediaRecorder?.state==='recording')mediaRecorder.stop();};
$('#download-recording').onclick=()=>{if(lastBlob)download(lastBlob,'粤语录音_'+localDate()+(lastBlob.type.includes('mp4')?'.m4a':'.webm'));};
function finishPhraseRecording(config,result,status){
  clearPendingRecording();
  $('#record-start').hidden=true;
  $('#record-status').textContent=status;
  $('#record-feedback').textContent=result.message+'\n目标：'+result.target+' · '+config.jyutping+'\n识别到：'+result.heard;
  $('#record-limit').textContent=result.limitation+' 请回到课程继续练习。';
}
$('#pending-recording').onclick=()=>{
  if(recordBusy||!pendingRecording)return;
  const {config,result}=pendingRecording;
  if(!recordPhraseRound(draft(config.lessonId),config.id,config.round,false))return;
  reviewPhrase(state,config.id,false,localDate());
  finishPhraseRecording(config,result,'本轮已留作待核对 · 已安排复习');
  save();
};
$('#record-start').onclick=async()=>{
  if(recordBusy||$('#record-start').hidden)return;recordBusy=true;const token=++recordToken,config=recordConfig;
  clearPendingRecording();resetPlayback();
  $('#record-start').disabled=true;$('#record-status').textContent='等待麦克风权限…';$('#record-result').hidden=true;
  try{
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw new Error('当前浏览器不支持录音，请用 Chrome 打开本机地址。');
    const incoming=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:false,autoGainControl:false},video:false});
    if(token!==recordToken){incoming.getTracks().forEach(t=>t.stop());return;}
    stream=incoming;
    const type=['audio/webm;codecs=opus','audio/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
    mediaRecorder=new MediaRecorder(stream,type?{mimeType:type}:{});const chunks=[];
    mediaRecorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    mediaRecorder.onerror=()=>{if(token!==recordToken)return;releaseStream();recordBusy=false;$('#record-start').disabled=false;$('#record-status').textContent='录音中断，请检查麦克风后重试。';$('#record-start').hidden=false;$('#record-stop').hidden=true;};
    mediaRecorder.onstop=async()=>{
      if(token!==recordToken)return;
      releaseStream();
      $('#record-status').classList.remove('live');$('#record-status').textContent='正在本机分析…';
      $('#record-start').hidden=false;$('#record-stop').hidden=true;
      try{
        lastBlob=new Blob(chunks,{type:mediaRecorder.mimeType});
        lastUrl=URL.createObjectURL(lastBlob);
        $('#record-playback').src=lastUrl;
        const decoded=await decodeAudio(await lastBlob.arrayBuffer());
        if(token!==recordToken)return;
        const samples=decoded.getChannelData(0);
        if(config.kind==='tone'||config.kind==='sound'){
          const a=analyzePitch(samples,decoded.sampleRate);
          const reference=a.valid?await loadToneReference(config.tone):null;
          if(token!==recordToken)return;
          const f=toneFeedback(a,config.tone,reference);
          $('#record-feedback').textContent=f.message;$('#record-limit').textContent=f.limitation;
          drawCurve(a.curve);$('#record-status').textContent=a.valid?'已完成一次音高走势观察':'这次录音不足以判断，请重试';
          if(a.valid&&config.kind==='sound'){$('#record-limit').textContent+=' 此音节练习只记观察次数，未验证音节内容正确。';addCount(draft(config.lessonId),config.id,2);save();}
          if(a.valid){state.toneHistory.push({date:localDate(),tone:config.tone,message:f.message});state.toneHistory=state.toneHistory.slice(-400);save();}
        }else{
          const {valid,reason}=recordingQuality(samples,decoded.sampleRate);
          $('#pitch-chart').innerHTML='';
          $('#record-feedback').textContent=valid?'正在识别这次录音…':reason;
          $('#record-limit').textContent='内容识别与发音准确度分开记录。';
          $('#record-result').hidden=false;
          if(!valid){$('#record-status').textContent='录音质量不足，未计入练习';}
          else if(!isRecognizerReady()){
            $('#record-status').textContent='尚未启用内容识别 · 未计入通过';
            $('#record-feedback').textContent='已有录音，可以回听。关闭后点击「启用免费粤语识别」，再进行内容检查。';
            $('#record-limit').textContent='没有识别证据，不判断读对。';
          }else{
            const heard=await recognize(resample(samples,decoded.sampleRate));
            if(token!==recordToken)return;
            const d=draft(config.lessonId);
            if(config.kind==='role'){
              $('#record-status').textContent=heard?'已记录一次情境练习':'未识别出内容，未计数';
              $('#record-feedback').textContent='识别到：'+(heard||'（没有结果）');
              $('#record-limit').textContent='自由回答未作语义与发音评分。请回听并对照交流目标。';
              if(heard){addCount(d,config.id.replace(config.lessonId+'-',''),2);if(!d.roleplays.includes(config.id))d.roleplays.push(config.id);save();}
            }else{
              const result=compareTranscript(config.expected,heard);
              if(result.matched){
                const counted=recordPhraseRound(d,config.id,config.round,true);
                finishPhraseRecording(config,result,counted?'目标内容一致 · 本轮已计入':'目标内容一致 · 额外练习');
                if(counted){if(!d.recorded.includes(config.id))d.recorded.push(config.id);save();}
              }else if(!heard.trim()){
                $('#record-status').textContent='未识别出内容 · 本轮未计入';
                $('#record-feedback').textContent='请回听这次录音，再重新录制。';
                $('#record-limit').textContent='这次没有识别文字可供对照。';
              }else{
                $('#record-status').textContent='目标内容未匹配 · 本轮未计入';
                $('#record-feedback').textContent='识别器也可能听错。可以先回听，再重录或留作待核对。\n识别到：'+result.heard;
                $('#record-limit').textContent=result.limitation;
                if(config.round<3){
                  pendingRecording={config,result};
                  $('#pending-recording').hidden=false;
                }else{
                  finishPhraseRecording(config,result,'目标内容未匹配 · 额外练习');
                }
              }
            }
          }
        }
        $('#record-result').hidden=false;
      }catch{if(token===recordToken)$('#record-status').textContent='无法分析这次录音，请重试或改用 Chrome。';}
      finally{if(token===recordToken){recordBusy=false;$('#record-start').disabled=false;}}
    };
    mediaRecorder.start();$('#record-start').hidden=true;$('#record-stop').hidden=false;
    $('#record-status').classList.add('live');
    const began=Date.now(),limit=(config.kind==='tone'||config.kind==='sound')?6:20;
    const tick=()=>$('#record-status').textContent='正在录音 '+Math.floor((Date.now()-began)/1000)+' 秒 · 最长 '+limit+' 秒';
    tick();recordInterval=setInterval(tick,250);recordTimeout=setTimeout(()=>{if(mediaRecorder?.state==='recording')mediaRecorder.stop();},limit*1000);
  }catch(e){
    if(token!==recordToken)return;
    releaseStream();recordBusy=false;
    $('#record-start').disabled=false;
    $('#record-status').textContent=e.name==='NotAllowedError'?'麦克风权限未开启。请在地址栏的网站设置和 macOS 隐私设置中允许麦克风，再点击重试。':e.name==='NotFoundError'?'没有找到麦克风，请连接设备后重试。':e.message;
  }
};
function drawCurve(curve){
  if(!curve?.length){$('#pitch-chart').innerHTML='';return;}
  const low=Math.min(...curve.map(p=>p.hz)),high=Math.max(...curve.map(p=>p.hz)),range=Math.max(40,high-low);
  const span=curve.at(-1).time-curve[0].time||1;
  const path=curve.map((p,i)=>(i?'L':'M')+(45+(p.time-curve[0].time)/span*480).toFixed(1)+' '+(132-(p.hz-low)/range*100).toFixed(1)).join(' ');
  $('#pitch-chart').innerHTML='<svg viewBox="0 0 560 160" role="img" aria-label="本人录音的音高走势"><text x="8" y="25">'+Math.round(low+range)+' Hz</text><text x="8" y="142">'+Math.round(low)+' Hz</text><path d="'+path+'"/><text x="410" y="155">录音时间方向</text></svg>';
}
async function init(){
  try{
    const results=await Promise.all([fetch(new URL('./curriculum.json',import.meta.url)),readState()]);
    if(!results[0].ok)throw new Error('课程文件未能载入，请重新启动。');
    curriculum=await results[0].json();
    for(const l of curriculum.lessons)for(const p of l.phrases)phraseMap.set(p.id,p);
    for(const l of curriculum.lessons){for(const p of l.phrases)audioMap.set(p.id,p);for(const q of questions(l))audioMap.set(q.id,q);(l.phonetics?.examples||[]).forEach((p,i)=>audioMap.set(l.id+'-sound-'+i,p));l.roleplay.forEach((p,i)=>audioMap.set(l.id+'-role-'+i,{text:p.cue}));audioMap.set(l.id+'-quiz',{text:l.listening.prompt});}curriculum.tones.forEach(t=>audioMap.set('tone-'+t.number,{text:t.character}));
    const saved=results[1];
    stateIds={lessons:curriculum.lessons.map(l=>l.id),phrases:[...phraseMap.keys()]};
    state=normalizeState(saved.state,stateIds);revision=saved.revision;confirmedState=JSON.stringify(state);
    selected=nextLesson().id;ready=true;
    $('#asr-setup').onclick=loadAsrUI;
    const voice=localMode?true:await cantoneseVoice();$('#device-status').textContent=localMode?'Mac 本机示范音就绪':voice?'粤语示范音就绪 · 进度仅存此浏览器':'需要添加中文（香港）粤语音色，才能完成听音任务';
    $('#save-status').textContent=readRecoveries().length?'发现未确认的本地进度，见「使用与备份」。':'本机进度已载入';render();
  }catch(e){$('#main').innerHTML='<h1>暂时无法打开学习台</h1><p class="alert">'+esc(e.message)+'</p><p>原始数据不会被重置。请保留应用文件夹，联系助手处理。</p>';$('#save-status').textContent='未载入';}
}
async function loadAsrUI(){
  const button=$('#asr-setup');button.disabled=true;
  const update=message=>{$('#asr-global-status').textContent=message;const el=$('#asr-status');if(el)el.textContent=message;};
  try{await initializeRecognizer(update);update('粤语识别就绪 · 录音留在设备');button.textContent='识别已就绪';}
  catch(e){update('未能启用：'+e.message);button.disabled=false;}
}
init();
