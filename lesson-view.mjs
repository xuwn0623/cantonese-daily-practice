import {workFor,corePhrases,questions,lessonRequirements,phraseRound,pendingPhraseRounds} from './lesson-engine.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function lessonView({l,d,state,step,running,stages,minutes,quizMessage,asrReady,statsIntro,phrase,reviewCard,due,formatTime,canFinishStep}){
  const w=workFor(d),complete=state.completed[l.id],core=corePhrases(l),qs=questions(l),req=lessonRequirements(l,d);
  const count=(key,max=3)=>Math.min(max,w.counts[key]||0)+' / '+max;
  let content='';
  if(step===0){
    const f=l.phonetics;
    content='<div class="focus-note"><strong>'+esc(f?.title||l.focus)+'</strong><p>'+esc(f?.explanation||l.tip)+'</p><p>'+esc(f?.articulation||'')+'</p></div>';
    if(due().length)content+='<details><summary>先复习到期表达（'+due().length+'）</summary>'+due().slice(0,4).map(reviewCard).join('')+'</details>';
    content+='<p>每个音节先听，再录两次。这里观察音高走势；练习次数不代表发音合格。</p>'+(f?.examples||[]).map((p,i)=>'<article class="phrase"><div class="cantonese">'+esc(p.text)+'</div><p class="jyutping">'+esc(p.jyutping)+'</p><div class="sound-parts"><span>声母 <b>'+esc(p.onset||'零声母')+'</b></span><span>韵母 <b>'+esc(p.rime)+'</b></span><span>声调 <b>'+esc(p.tone)+'</b></span></div><p>'+esc(p.tip)+'</p><div class="button-row"><button data-action="play" data-id="'+l.id+'-sound-'+i+'">听音节</button><button data-action="record-sound" data-index="'+i+'">录音观察 · '+count('sound-'+i,2)+'</button></div></article>').join('');
    if(f?.check)content+='<article class="quiz-card"><h3>'+esc(f.check.question)+'</h3><div class="quiz-options">'+f.check.options.map((o,i)=>'<button data-action="phonetic-answer" data-answer="'+i+'">'+esc(o)+'</button>').join('')+'</div><p>'+esc(w.answers.includes('phonetic-check')?f.check.explanation:quizMessage)+'</p></article>';
  }else if(step===1){
    content='<p>本课 '+core.length+' 条主练表达。先听懂、再拆读。标有拓展的表达可选学。</p>'+l.phrases.map(p=>(p.extension?'<span class="badge">可选拓展</span>':'')+phrase(p)).join('');
  }else if(step===2){
    const q=qs.find(q=>!w.answers.includes(q.id));
    content='<p>已完成 '+qs.filter(q=>w.answers.includes(q.id)).length+' / '+qs.length+' 题。先听音辨认，再由意思回忆粤语。</p>';
    if(q){const heard=d.listened.includes(q.id);content+='<article class="quiz-card"><h3>'+(q.kind==='recall'?'回忆表达：'+esc(q.prompt):q.kind==='sound'?'听声音，辨认音节':'听粤语，选出意思')+'</h3>'+(q.kind==='recall'?'':'<button data-action="play" data-id="'+q.id+'" class="primary">播放题目</button>')+'<div class="quiz-options">'+q.options.map((o,i)=>'<button data-action="quiz-v2" data-id="'+q.id+'" data-answer="'+i+'" '+(q.kind!=='recall'&&!heard?'disabled':'')+'>'+esc(o)+'</button>').join('')+'</div><p>'+esc(quizMessage)+'</p></article>';}else content+='<div class="focus-note">听辨与回忆已完成。下面进入三轮开口。</div>';
  }else if(step===3){
    content='<div class="focus-note">每句三轮：① 看粤拼跟读 ② 只看汉字重读 ③ 只看意思脱稿说。识别文字与目标一致时记为内容一致。识别未匹配时，可回听重录或标记为待核对。</div><p><button data-action="load-asr" class="primary">'+(asrReady?'粤语识别已就绪':'启用免费粤语识别')+'</button> <span id="asr-status"></span></p>'+core.map(p=>{
      const {count,verified,pending,target}=phraseRound(d,p);
      return '<article class="phrase"><p class="badge">'+(count<3?'第 '+(count+1)+' 轮 · ':'')+'已练 '+count+' / 3</p><p>内容一致 '+verified+' · 待核对 '+pending+'</p><div class="cantonese">'+esc(target)+'</div>'+
        (count===0?'<p class="jyutping">'+esc(p.jyutping)+'</p>':'')+
        '<div class="button-row">'+(count!==2?'<button data-action="play" data-id="'+p.id+'">再听示范</button>':'')+
        '<button data-action="record-phrase" data-id="'+p.id+'">'+(count===3?'再练一次':'录音检查内容')+'</button></div>'+
        (count<2?'<p class="note">'+esc(p.note)+'</p>':'')+'</article>';
    }).join('');
  }else if(step===4){
    content='<p>每个场景做两轮：听对方 → 脱稿回答 → 回听 → 换一种说法再答。自由回答显示识别文字，暂不判断回答是否合适。</p><button data-action="load-asr">'+(asrReady?'识别已就绪':'启用免费粤语识别')+'</button>'+l.roleplay.map((r,i)=>'<article class="role"><h3>'+esc(r.prompt)+'</h3><div class="button-row"><button data-action="play" data-id="'+l.id+'-role-'+i+'">听对方开场</button><button data-action="record-role" data-index="'+i+'">录下我的回答 · '+count('role-'+i,2)+'</button></div><details><summary>回答后再看示例</summary><p>'+esc(r.example)+'</p></details></article>').join('');
  }else{
    content='<p>本课目标：'+esc(l.goal)+'</p><p>固定句练习待核对 '+pendingPhraseRounds(l,d)+' 轮。</p><p>实际计时 <strong>'+Math.floor(d.seconds/60)+' 分钟</strong>。45 分钟为目标；个人用时会有差异。完成任务不等于掌握发音。</p>'+(d.seconds<2400?'<div class="focus-note">如果完成得较快：遮住文本再说一轮；把姓名、时间、地点换成自己的信息；复做错题。不需要为了打卡空等。</div>':'')+'<button data-action="reset-quiz">再做一轮听辨与回忆</button>'+core.map(p=>'<article class="phrase"><span>'+esc(p.text)+'</span><div class="button-row"><button data-action="review-again" data-id="'+p.id+'">还不熟</button><button data-action="review-good" data-id="'+p.id+'">能脱稿说</button></div></article>').join('');
  }
  return statsIntro('第 '+l.week+' 周 · '+l.title,l.goal)+(complete?'<div class="finish-banner">已有学习记录 · '+esc(complete.date)+'。新增任务另计，原记录保留。 <button data-action="next-lesson">进入下一课</button></div>':'')+'<div class="lesson-layout"><aside><div class="lesson-steps">'+stages.map((label,i)=>'<button data-action="step" data-step="'+i+'" class="'+(step===i?'active':'')+'"><span class="step-num '+(req[i]?'done':'')+'">'+(req[i]?'✓':i+1)+'</span><span><span class="step-name">'+label+'</span><span class="step-min">约 '+minutes[i]+' 分钟</span></span></button>').join('')+'</div><div class="timer"><div id="timer-value">'+formatTime(d.seconds)+'</div><button data-action="timer">'+(running?'暂停计时':'开始学习计时')+'</button><p class="note">按实际学习时间记录；切换页面会暂停。</p></div></aside><section class="study-panel"><h2>'+stages[step]+'</h2>'+content+'<div class="step-footer"><small>按任务完成度继续，计时不代替练习。</small><button data-action="finish-step" class="primary" '+(!canFinishStep()?'disabled':'')+'>'+(step===5?'完成本课并打卡':'完成此环节')+'</button></div></section></div>';
}
