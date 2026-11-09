export function workFor(d){return d.work??={version:2,answers:[],counts:{},attempts:{}};}
export function addCount(d,key,limit=3){const w=workFor(d);w.counts[key]=Math.min(limit,(w.counts[key]||0)+1);}
function roundCounts(d,id){
  const counts=d?.work?.counts||{};
  const verified=counts[id]||0,pending=Math.min(3-verified,counts[id+'-pending']||0);
  return {verified,pending,count:verified+pending};
}
export function phraseRound(d,p){
  const rounds=roundCounts(d,p.id),{count}=rounds;
  return {...rounds,target:count>=2?p.meaning:p.text,
    help:count===0?p.jyutping+'。请读出整句。':count===1?'看汉字读出整句。':'根据意思脱稿说。录完可回听并对照。'};
}
export function recordPhraseRound(d,id,round,matched){
  const {count}=roundCounts(d,id);
  if(count!==round||count>=3)return false;
  addCount(d,matched?id:id+'-pending');
  return true;
}
export function pendingPhraseRounds(l,d){
  return corePhrases(l).reduce((total,p)=>total+roundCounts(d,p.id).pending,0);
}
export function corePhrases(l){return l.phrases.filter(p=>!p.extension);}
export function questions(l){
  const phrases=corePhrases(l);
  const choices=(p,key)=>{const others=phrases.filter(x=>x.id!==p.id).slice(0,2);const values=[p[key],...others.map(x=>x[key])];const shift=phrases.indexOf(p)%values.length;return {options:values.slice(shift).concat(values.slice(0,shift)),answer:(values.length-shift)%values.length};};
  return [...(l.drills||[]).map(p=>({...p,kind:'sound'})),...phrases.map(p=>({id:p.id+'-meaning',text:p.text,jyutping:p.jyutping,kind:'listen',...choices(p,'meaning'),explanation:p.text+' · '+p.meaning})),...phrases.map(p=>({id:p.id+'-recall',text:p.text,jyutping:p.jyutping,kind:'recall',prompt:p.meaning,...choices(p,'text'),explanation:p.text+' · '+p.jyutping}))];
}
export function lessonRequirements(l,d){
  const w=workFor(d),core=corePhrases(l),qs=questions(l),sounds=l.phonetics?.examples||[];
  return [!!w.answers.includes('phonetic-check')&&sounds.every((_,i)=>(w.counts['sound-'+i]||0)>=2),core.every(p=>d.listened.includes(p.id)),qs.every(q=>w.answers.includes(q.id)),core.every(p=>roundCounts(d,p.id).count>=3),l.roleplay.every((_,i)=>(w.counts['role-'+i]||0)>=2),false];
}
