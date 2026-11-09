export function freshState(){return {version:1,completed:{},lessons:{},reviews:{},toneHistory:[]};}
export function localDate(d=new Date()){return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
function isDate(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;}
const dict=x=>x&&typeof x==='object'&&!Array.isArray(x);
const finite=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
export function normalizeState(value,ids){
  const fail=()=>{throw new Error('备份格式不兼容或含无效记录，原进度未改变。');};
  if(!dict(value)||value.version!==1||!dict(value.completed)||!dict(value.lessons)||!dict(value.reviews)||!Array.isArray(value.toneHistory))fail();
  const s=freshState(), lessonIds=new Set(ids.lessons),phraseIds=new Set(ids.phrases);
  for(const [id,v] of Object.entries(value.completed)){
    if(!lessonIds.has(id)||!dict(v)||!isDate(v.date)||!finite(v.minutes,0,10000))fail();
    s.completed[id]={date:v.date,minutes:v.minutes};
  }
  for(const [id,v] of Object.entries(value.lessons)){
    if(!lessonIds.has(id)||!dict(v)||!finite(v.seconds,0,360000)||!Array.isArray(v.steps)||v.steps.some(n=>!Number.isInteger(n)||n<0||n>5))fail();
    const arrays=['listened','recorded','roleplays'];
    for(const key of arrays)if(!Array.isArray(v[key])||v[key].length>100||v[key].some(x=>typeof x!=='string'||x.length>120))fail();
    if(typeof v.quizPassed!=='boolean')fail();
    s.lessons[id]={seconds:v.seconds,steps:[...new Set(v.steps)],listened:[...new Set(v.listened)],recorded:[...new Set(v.recorded)],roleplays:[...new Set(v.roleplays)],quizPassed:v.quizPassed};
  }
  for(const [id,v] of Object.entries(value.lessons)){
    if(v.work!==undefined){
      const w=v.work;
      if(!dict(w)||w.version!==2||!Array.isArray(w.answers)||w.answers.length>100||w.answers.some(x=>typeof x!=='string'||x.length>120)||!dict(w.counts)||Object.keys(w.counts).length>100)fail();
      for(const [k,n] of Object.entries(w.counts))if(k.length>120||['__proto__','constructor','prototype'].includes(k)||!Number.isInteger(n)||n<0||n>3)fail();
      s.lessons[id].work={version:2,answers:[...new Set(w.answers)],counts:{...w.counts},attempts:{}};
    }
  }
  for(const [id,v] of Object.entries(value.reviews)){
    if(!phraseIds.has(id)||!dict(v)||!isDate(v.due)||!isDate(v.last)||!Number.isInteger(v.level)||v.level<0||v.level>5)fail();
    s.reviews[id]={due:v.due,last:v.last,level:v.level};
  }
  if(value.toneHistory.length>400)fail();
  for(const v of value.toneHistory){
    if(!dict(v)||!isDate(v.date)||!Number.isInteger(v.tone)||v.tone<1||v.tone>6||typeof v.message!=='string'||v.message.length>500)fail();
    s.toneHistory.push({date:v.date,tone:v.tone,message:v.message});
  }
  return s;
}
export function completeLesson(state,id,date,minutes=0){
  if(!state.completed[id])state.completed[id]={date,minutes:Math.max(0,Math.round(minutes))};
  return state;
}
export function reviewPhrase(state,id,remembered,date){
  const level=remembered?Math.min(5,(state.reviews[id]?.level||0)+1):0;
  const day=new Date(date+'T12:00:00');day.setDate(day.getDate()+[1,2,4,7,14,30][level]);
  state.reviews[id]={level,last:date,due:localDate(day)};return state.reviews[id];
}
export function weekCount(state,date){
  const day=new Date(date+'T12:00:00'),offset=(day.getDay()+6)%7;
  day.setDate(day.getDate()-offset);const start=localDate(day);
  day.setDate(day.getDate()+6);const end=localDate(day);
  return new Set(Object.values(state.completed).filter(v=>v.date>=start&&v.date<=end).map(v=>v.date)).size;
}
