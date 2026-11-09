// Only orthographic variants are collapsed; different words stay different.
const traditional='這個們嗎麼裡來說話認識興請謝見聽會學習點樣幾時開關飯飲買賣錢車號鐘週裏過還書歡讓寫問讀國為氣發覺現實習廣東龍門間應該給從對頭體歲歡長講啲';
const simplified='这个们吗么里来说话认识兴请谢见听会学习点样几时开关饭饮买卖钱车号钟周里过还书欢让写问读国为气发觉现实习广东龙门间应该给从对头体岁欢长讲啲';
const variants=new Map([...traditional].map((c,i)=>[c,[...simplified][i]]));
export function normalizeTranscript(text){return [...String(text).replace(/<\|[^>]*\|>/g,'').toLowerCase()].map(c=>variants.get(c)||c).join('').replace(/[^\p{L}\p{N}]/gu,'');}
export function compareTranscript(target,heard){
  const expected=normalizeTranscript(target),actual=normalizeTranscript(heard);
  const matched=!!actual&&expected===actual;
  return {matched,target,heard:heard||'（未识别出内容）',message:matched?'识别内容与目标一致。':'识别内容与目标不一致，请对照下方文字重读；识别器也可能听错。',limitation:'内容一致只说明识别器听出了这句话；声母、韵母和整句声调仍未获得可靠评分。'};
}
export function resample(samples,from,to=16000){
  if(from===to)return samples.slice();const out=new Float32Array(Math.round(samples.length*to/from));
  for(let i=0;i<out.length;i++){const a=i*from/to,b=Math.min(samples.length,(i+1)*from/to);let total=0,weight=0;for(let j=Math.floor(a);j<Math.ceil(b);j++){const w=Math.max(0,Math.min(b,j+1)-Math.max(a,j));total+=(samples[j]||0)*w;weight+=w;}out[i]=total/(weight||1);}return out;
}
