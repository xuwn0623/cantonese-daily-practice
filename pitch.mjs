// Cumulative mean normalized difference (YIN-style) for isolated voiced sounds.
// Conservative practice aid, not a calibrated Cantonese pronunciation model.
const median=a=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.floor(b.length/2)]:0;};
function estimate(frame,rate){
  const min=Math.ceil(rate/500),max=Math.min(Math.floor(rate/65),Math.floor(frame.length/2)-1);
  let energy=0;for(const v of frame)energy+=v*v;
  if(Math.sqrt(energy/frame.length)<0.008)return null;
  const dif=new Float64Array(max+1),norm=new Float64Array(max+1);let sum=0;
  for(let tau=1;tau<=max;tau++){
    for(let j=0;j<frame.length-max;j++){const d=frame[j]-frame[j+tau];dif[tau]+=d*d;}
    sum+=dif[tau];norm[tau]=sum?dif[tau]*tau/sum:1;
  }
  for(let tau=min;tau<max;tau++){
    if(norm[tau]<0.15){
      while(tau+1<max&&norm[tau+1]<norm[tau])tau++;
      const left=norm[tau-1],mid=norm[tau],right=norm[tau+1];
      const denom=left-2*mid+right;
      const shift=denom?Math.max(-0.5,Math.min(0.5,(left-right)/(2*denom))):0;
      return {hz:rate/(tau+shift),confidence:1-mid};
    }
  }
  return null;
}
function prepare(samples,sampleRate){
  const step=Math.max(1,Math.floor(sampleRate/12000)),rate=sampleRate/step;
  const pcm=new Float32Array(Math.floor(samples.length/step));
  let peak=0,sq=0;
  for(let i=0;i<pcm.length;i++){
    let value=0;
    for(let j=0;j<step;j++){
      const sample=samples[i*step+j];
      value+=sample;peak=Math.max(peak,Math.abs(sample));
    }
    pcm[i]=value/step;sq+=pcm[i]*pcm[i];
  }
  return {pcm,rate,peak,rms:Math.sqrt(sq/pcm.length)};
}
function hasSeparateBursts(pcm,rate){
  // Short envelope windows keep quiet gaps visible even when the pitch frames overlap them.
  const size=Math.round(rate*0.02),levels=[];
  for(let i=0;i+size<=pcm.length;i+=size){
    let power=0;
    for(let j=i;j<i+size;j++)power+=pcm[j]*pcm[j];
    levels.push(Math.sqrt(power/size));
  }
  const threshold=Math.max(0.006,0.12*Math.max(...levels));
  let active=0,quiet=0,heard=false,separated=false;
  for(const level of levels){
    if(level>=threshold){
      quiet=0;active++;
      if(active>=4){
        if(separated)return true;
        heard=true;
      }
    }else{
      if(++quiet>=3){active=0;separated=heard;}
    }
  }
  return false;
}
function usableAudio(samples,sampleRate){
  return samples?.length&&Number.isFinite(sampleRate)&&sampleRate>=8000;
}
export function recordingQuality(samples,sampleRate){
  if(!usableAudio(samples,sampleRate)||samples.length/sampleRate<0.3||samples.length/sampleRate>21){
    return {valid:false,reason:'录音时长不足或超出范围，请重录。'};
  }
  const {pcm,rate,rms,peak}=prepare(samples,sampleRate);
  if(rms<0.006||peak>=0.999){
    return {valid:false,reason:'声音太轻或可能失真，请用自然音量重录。'};
  }
  const size=Math.round(rate*0.064),hop=Math.round(rate*0.024);
  let voiced=0;
  for(let i=0;i+size<=pcm.length;i+=hop){
    voiced=estimate(pcm.subarray(i,i+size),rate)?voiced+1:0;
    if(voiced>=3)return {valid:true};
  }
  return {valid:false,reason:'没有检测到足够的有声片段。请避开背景噪声，清楚说一遍。'};
}
export function analyzePitch(samples,sampleRate){
  const reject=(reason,extra={})=>({valid:false,reason,curve:[],...extra});
  if(!usableAudio(samples,sampleRate))return reject('没有可分析的声音。');
  const duration=samples.length/sampleRate;
  if(duration<0.25)return reject('录音太短，请清楚读出一个字，保持约半秒。',{duration});
  if(duration>12)return reject('录音过长，请在声调练习中一次只读一个字。',{duration});
  const {pcm,rate,rms,peak}=prepare(samples,sampleRate);
  if(rms<0.006)return reject('声音太轻或没有录到声音。请靠近麦克风后重试。',{duration});
  if(peak>=0.999)return reject('声音可能失真，请离麦克风稍远一些后重试。',{duration});
  if(hasSeparateBursts(pcm,rate))return reject('录音里有明显停顿。请一次只读一个字，连贯发声。',{duration});
  const size=1024,hop=256,curve=[];
  for(let offset=0;offset+size<=pcm.length;offset+=hop){
    const p=estimate(pcm.subarray(offset,offset+size),rate);
    if(p)curve.push({time:(offset+size/2)/rate,hz:p.hz});
  }
  if(curve.length<8)return reject('有效有声音高不足。请避开背景说话声，只读一个字。',{duration});
  const span=curve.at(-1).time-curve[0].time;
  const ratio=curve.length/(span*rate/hop+1);
  if(span>2.2)return reject('检测到的有声段较长，声调分析只用于单个音节。',{duration,curve});
  if(ratio<0.7||curve.some((v,i)=>i&&v.time-curve[i-1].time>0.14))return reject('音高断续，可能含多个音节、噪声或气声，暂不判断。',{duration,curve});
  const semis=curve.map(p=>12*Math.log2(p.hz));
  const jumps=semis.slice(1).filter((v,i)=>Math.abs(v-semis[i])>5).length;
  if(jumps/semis.length>0.08)return reject('音高跳变较多，请用自然音量重读。',{duration,curve});
  const width=Math.max(3,Math.floor(semis.length*0.22));
  const delta=median(semis.slice(-width))-median(semis.slice(0,width));
  const sorted=[...semis].sort((a,b)=>a-b),spread=sorted[Math.floor(sorted.length*.9)]-sorted[Math.floor(sorted.length*.1)];
  // Smoothed interior points catch reversals even when the endpoints suggest a clear slope.
  let low=semis[0],high=semis[0],rise=0,fall=0;
  for(let i=1;i<semis.length-1;i++){
    const value=median(semis.slice(i-1,i+2));
    rise=Math.max(rise,value-low);fall=Math.max(fall,high-value);
    low=Math.min(low,value);high=Math.max(high,value);
  }
  if((rise>3&&fall>3)||(Math.abs(delta)<=1.5&&spread>3)){
    return reject('这次音高起伏较多，暂不判断升降。请用自然音量重读一个字。',{duration,curve});
  }
  const trend=delta>1.5?'rising':delta< -1.5?'falling':'level';
  return {valid:true,duration,curve,trend,delta,spread,reason:'仅用于单音节音高走势观察'};
}
export function toneFeedback(a,tone,reference){
  const limitation='未校准的走势观察。无法判定发音是否正确，无法可靠区分 1、3、6 声的高低或 2、5 声的起点。声母、韵母未评估。';
  if(!a.valid)return {message:a.reason,limitation,status:'retry'};
  const observed={rising:'这次音高呈上升走势。',falling:'这次音高呈下降走势。',level:'这次音高比较平稳。'}[a.trend];
  if(!reference?.valid){
    return {message:observed+'暂未取得可比较的本机示范，本次只记录走势。',limitation,status:'observed'};
  }
  const expected=tone===2||tone===5?'rising':tone===4?'falling':'level';
  if(reference.trend!==expected){
    return {message:observed+'本机示范的走势与简化示意不一致，本次只记录走势。请回听比较。',limitation,status:'observed'};
  }
  let instruction;
  if(tone===2||tone===5)instruction=a.trend==='rising'?'上扬已经能看出来。再听示范，比较起点与终点的高低。':'上扬不明显。先慢听示范，再从较低处向上带，避免只把声音读响。';
  else if(tone===4)instruction=a.trend==='falling'?'下降走势已经能看出来。再比较是否落在舒适的低音区。':'试从较低音区轻轻往下落，不要硬压嗓子。自然连读可能较平，本提示只针对孤立字练习。';
  else instruction=a.trend==='level'?'先保持平稳，再听示范比较高、中、低音区。':'先减少明显的上扬或下落，练习在一个舒适高度保持平稳。';
  return {message:observed+instruction,limitation,status:'observed'};
}
