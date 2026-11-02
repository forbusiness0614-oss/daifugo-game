(()=>{'use strict';
const $=id=>document.getElementById(id), suits=['♠','♥','♦','♣'];
const ruleNames={revolution:'革命（同じ数字4枚で強さ逆転）',shibari:'絵柄縛り',numberLock:'数字縛り',kaidan:'階段',back:'11バック',seven:'7渡し',ten:'10捨て',skip:'5飛ばし',sp3:'スペ3返し',forbid:'禁止上がり',exchange:'順位によるカード交換',nine:'9の2枚切り',queen:'Qボンバー',king:'Kスキップ',rokuro:'ろくろ首（6を2枚で場を流す）'};
let configured=Object.fromEntries(Object.keys(ruleNames).map(k=>[k,true])),rules={...configured};try{const saved=JSON.parse(localStorage.getItem('daifugo_rules_v5')||'{}');for(const k of Object.keys(ruleNames))if(typeof saved[k]==='boolean')configured[k]=saved[k]}catch(e){}
let players=[],current=0,pile=null,last=-1,passes=new Set(),selected=new Set(),revolution=false,back=false,lock=null,numberLock=null,finish=[],game=0,busy=false,logs=[],timer=null,phase=null,skipNext=0,previousRanking=null;
const nval=c=>c.joker?16:c.n;
function strength(n){return (revolution!==back)?18-n:n}
function numberStep(){return revolution!==back?-1:1}
function power(c){return c.joker?99:strength(c.n)}
function sortHand(h){h.sort((a,b)=>nval(a)-nval(b)||suits.indexOf(a.s)-suits.indexOf(b.s))}
function rankName(n){return ({11:'J',12:'Q',13:'K',14:'A',15:'2'}[n]||String(n))}
function name(c){return c.joker?'JOKER':({11:'J',12:'Q',13:'K',14:'A',15:'2'}[c.n]||c.n)+c.s}
function html(c){return '<span class="rank">'+(c.joker?'JK':({11:'J',12:'Q',13:'K',14:'A',15:'2'}[c.n]||c.n))+'</span><span class="suit">'+(c.joker?'★':c.s)+'</span>'}
function analyze(cs){
 if(!cs.length||cs.length>13)return null;
 const ordinary=cs.filter(c=>!c.joker),j=cs.filter(c=>c.joker);
 if(j.length>1)return null;
 if(cs.length===1){let c=cs[0];return {type:'set',len:1,pow:power(c),n:c.joker?16:c.n,suit:c.s||'',suits:c.s||'',joker:!!c.joker}}
 // Joker can substitute for any missing card in a pair, triple or four-of-a-kind.
 if(cs.length<=4&&ordinary.length&&ordinary.every(c=>c.n===ordinary[0].n)){
  const n=ordinary[0].n;
  return {type:'set',len:cs.length,pow:strength(n),n,suit:cs.map(c=>c.s||'*').sort().join(''),suits:cs.map(c=>c.s||'*').sort().join(''),joker:false,wild:!!j.length};
 }
 // Same-suit consecutive run, with Joker filling one gap or endpoint.
 if(rules.kaidan&&cs.length>=3&&ordinary.length&&ordinary.every(c=>c.s===ordinary[0].s)){
  let ns=ordinary.map(c=>c.n).sort((a,b)=>a-b);
  if(new Set(ns).size===ns.length){
   for(let low=3;low<=15-cs.length+1;low++){
    let high=low+cs.length-1;
    if(ns.every(n=>n>=low&&n<=high)){
     return {type:'run',len:cs.length,pow:strength(high),n:high,suit:ordinary[0].s,suits:ordinary[0].s,joker:false,wild:!!j.length,low,high};
    }
   }
  }
 }
 return null;
}
function sp3(cs){return rules.sp3&&cs.length===1&&!cs[0].joker&&cs[0].n===3&&cs[0].s==='♠'&&pile&&pile.a.joker&&pile.a.len===1}
function valid(cs){let a=analyze(cs);if(!a)return false;if(!pile)return true;if(sp3(cs))return true;if(pile.a.joker)return false;if(a.type!==pile.a.type||a.len!==pile.a.len)return false;if(lock&&a.suits!==lock&&!a.wild&&!a.joker)return false;if(numberLock!==null&&!a.joker&&a.n!==numberLock)return false;return a.pow>(pile.a.joker?99:pile.a.type==='run'?strength(pile.a.high):strength(pile.a.n))}
function addLog(s){logs.unshift(s);logs=logs.slice(0,9);$('log').replaceChildren(...logs.map(t=>{let d=document.createElement('div');d.textContent=t;return d}))}
function notice(s){$('status').textContent=s;addLog(s)}
function active(i){return !finish.includes(i)&&players[i].hand.length>0}
function next(from){for(let i=1;i<=4;i++){let x=(from+i)%4;if(active(x))return x}return -1}
function alive(){return players.filter((p,i)=>active(i)).length}
function finishPlayer(i){if(!active(i)&&finish.includes(i))return;finish.push(i);notice(players[i].name+'が'+finish.length+'位であがり！');if(finish.length===3){for(let j=0;j<4;j++)if(!finish.includes(j))finish.push(j);endGame()}}
function render(){if(!players.length)return;
 $('round').textContent='第'+game+'ゲーム';$('opps').innerHTML=[1,2,3].map(i=>{let p=players[i];return '<div class="opponent '+(current===i?'active ':'')+(finish.includes(i)?'out':'')+'"><strong>'+p.name+'</strong><small>'+(finish.includes(i)?'あがり '+(finish.indexOf(i)+1)+'位':p.hand.length+'枚')+'</small><div>'+Array.from({length:Math.min(p.hand.length,6)},()=>'<i class="back"></i>').join('')+'</div></div>'}).join('');
 $('pile').innerHTML=pile?pile.cards.map(c=>'<div class="card '+(['♥','♦'].includes(c.s)?'red':'')+(c.joker?' joker':'')+'">'+html(c)+'</div>').join(''):'';
 $('pileLabel').textContent=pile?players[pile.by].name+'：'+pile.cards.map(name).join(' / '):'場にカードはありません';
 $('turn').textContent=pendingExchange?'カード交換中':finish.length===4?'ゲーム終了':phase&&phase.who===0?'追加アクションを選択中':players[current].name+'の番';
 $('effects').textContent=[revolution?'革命中（3が最強）':'',back?'11バック中':'',lock?'絵柄縛り：'+lock:'',numberLock!==null?'数字縛り：次は'+rankName(numberLock):''].filter(Boolean).join(' ／ ');
 $('count').textContent=players[0].hand.length;$('place').textContent=finish.includes(0)?finish.indexOf(0)+1+'位':'';
 $('hand').innerHTML=players[0].hand.map(c=>'<button class="card '+(['♥','♦'].includes(c.s)?'red ':'')+(c.joker?'joker ':'')+(selected.has(c.id)?'selected':'')+'" data-id="'+c.id+'" aria-label="'+name(c)+'">'+html(c)+'</button>').join('');
 const my=(pendingExchange!==null)||(current===0&&!busy&&!finish.includes(0)&&finish.length<4);
 $('play').textContent=pendingExchange?'選んだ'+pendingExchange.num+'枚を渡す':phase&&phase.who===0?'選んだカードで確定':'選んだカードを出す';
 $('play').disabled=!!(phase&&phase.kind==='queen')||!my||(pendingExchange?selected.size!==pendingExchange.num:phase&&phase.who===0?(selected.size<1||selected.size>phase.max):!valid(players[0].hand.filter(c=>selected.has(c.id))));
 $('pass').textContent=phase&&phase.who===0?'追加をやめる':'パス';$('pass').disabled=!!pendingExchange||!!(phase&&phase.kind==='queen')||!my||(!phase&&!pile);$('clear').disabled=!my||!selected.size;
 $('special').classList.toggle('hidden',!(pendingExchange||(phase&&phase.who===0)));if(pendingExchange)$('special').textContent='カード交換：'+players[pendingExchange.to].name+'に渡すカードを'+pendingExchange.num+'枚選んで「渡す」を押してね。';if(!pendingExchange&&phase&&phase.who===0)$('special').innerHTML=phase.kind==='queen'?'Qボンバー：'+(phase.max-phase.remaining+1)+'/'+phase.max+'回目。あと'+phase.remaining+'回、数字を選べるよ。<div class="rank-picker">'+Array.from({length:13},(_,i)=>i+3).map(n=>'<button type="button" data-rank="'+n+'">'+({11:'J',12:'Q',13:'K',14:'A',15:'2'}[n]||n)+'</button>').join('')+'</div>':phase.kind==='seven'?'7渡し：最大'+phase.max+'枚を選んで「確定」。渡さないなら「追加をやめる」。':'10捨て：捨てるカードを最大'+phase.max+'枚選んで「確定」。捨てないなら「追加をやめる」。';
}
function showRevolution(active){const el=$('revolutionFx');el.textContent=active?'革命！ 強さ逆転！':'革命返し！ 元に戻る！';el.classList.remove('hidden');el.classList.remove('show');void el.offsetWidth;el.classList.add('show');clearTimeout(revolutionFxTimer);revolutionFxTimer=setTimeout(()=>el.classList.add('hidden'),1300)}
let revolutionFxTimer=null,eventFxTimer=null,eventHoldUntil=0;function showEvent(message){const el=$('eventFx');el.textContent=message;eventHoldUntil=Date.now()+1850;el.classList.remove('hidden','event-show');void el.offsetWidth;el.classList.add('event-show');clearTimeout(eventFxTimer);eventFxTimer=setTimeout(()=>el.classList.add('hidden'),1850)}
let bombTimer=null,bombAnimating=false;
function cancelBomb(){clearTimeout(bombTimer);bombTimer=null;bombAnimating=false}
function schedule(){if(bombAnimating)return;clearTimeout(timer);if(pendingExchange)return;if(finish.length===4)return;if(phase){if(phase.who===0){busy=false;render();return}busy=true;render();timer=setTimeout(()=>{busy=false;cpuSpecial()},Math.max(1050,eventHoldUntil-Date.now()+220));return}
 if(current===0){busy=false;render();return}busy=true;render();timer=setTimeout(()=>{busy=false;cpuTurn()},Math.max(1050,eventHoldUntil-Date.now()+220))}
function clearPile(leader,reason='場が流れた！'){pile=null;last=-1;passes.clear();lock=null;numberLock=null;back=false;skipNext=0;current=active(leader)?leader:next(leader);notice(players[leader].name+'：'+reason);showEvent(reason);render();schedule()}
function afterPlay(who,a,wasSp3){if(finish.length===4)return;if(a.n===8||wasSp3||(rules.rokuro&&a.type==='set'&&a.n===6&&a.len===2)||(rules.nine&&a.type==='set'&&a.n===9&&a.len===2)){let reason=wasSp3?'スペ3返し！':a.n===8?'8切り！':a.n===6?'ろくろ首！':a.n===9?'9の2枚切り！':'場が流れた！';clearPile(who,reason);return}
 if(a.n===11&&rules.back){back=!back;notice('11バック！ 強さが一時的に逆転！');showEvent('11バック！')}
 if(numberLock!==null)numberLock=a.n+numberStep();
 if(a.n===5&&rules.skip){skipNext+=a.len;notice('5飛ばし！ '+a.len+'人飛ばす');showEvent('5飛ばし！ '+a.len+'人')}if(a.n===13&&rules.king){skipNext+=a.len;notice('Kスキップ！ '+a.len+'人飛ばす');showEvent('Kスキップ！ '+a.len+'人')}
 let specials=[];if(a.n===12&&rules.queen)specials.push({kind:'queen',max:a.len,remaining:a.len});if(a.n===7&&rules.seven)specials.push({kind:'seven',max:a.len});if(a.n===10&&rules.ten)specials.push({kind:'ten',max:a.len});
 if(specials.length&&players[who].hand.length){showEvent(specials[0].kind==='queen'?'Qボンバー！ ×'+a.len:specials[0].kind==='seven'?'7渡し！ 最大'+a.len+'枚':'10捨て！ 最大'+a.len+'枚');phase={...specials[0],who,rest:specials.slice(1)};selected.clear();current=who;render();schedule();return}
 advance(who)}
// Only players who can still respond to the current pile receive a turn.
function nextResponder(from){
 for(let i=1;i<=4;i++){
  const k=(from+i)%4;
  if(active(k)&&k!==last&&!passes.has(k))return k;
 }
 return -1;
}
function advance(who){
 if(!pile){current=next(who);if(current<0){endGame();return}render();schedule();return}
 let k=nextResponder(who);
 // A skipped response counts as passed, but never consumes the pile leader's turn.
 for(let i=0;i<skipNext&&k>=0;i++){
  passes.add(k);
  k=nextResponder(k);
 }
 skipNext=0;
 if(k<0){clearPile(last);return}
 current=k;render();schedule();
}
function illegalFinish(cs,a,wasSp3){if(!rules.forbid)return false;return cs.some(c=>c.joker||c.n===8||c.n===15||(revolution&&c.n===3))||wasSp3}
function doPlay(who,cs){if(!valid(cs)){if(who===0)notice('その組み合わせは出せないよ');render();return}
 let a=analyze(cs),wasSp3=sp3(cs),old=pile&&pile.a;const ids=new Set(cs.map(c=>c.id));players[who].hand=players[who].hand.filter(c=>!ids.has(c.id));selected.clear();
 let newLock=lock;let newNumberLock=numberLock;if(old&&!a.joker){if(rules.shibari&&!newLock&&old.type===a.type&&old.suits===a.suits&&!a.wild)newLock=a.suits;if(rules.numberLock&&newNumberLock===null&&old.type==='set'&&a.type==='set'&&!old.joker&&a.n===old.n+numberStep())newNumberLock=a.n+numberStep();if(newNumberLock!==null)newNumberLock=a.n+numberStep();}
 pile={cards:[...cs],a,by:who};last=who;passes.clear();lock=newLock;numberLock=newNumberLock;
 notice(players[who].name+'：'+cs.map(name).join('・')+' を出した'+(lock?'（絵柄縛り）':'')+(numberLock!==null?'（数字縛り）':''));
 if((!old||!old.joker)&&((lock&&!old?.suits?.includes('*')&&old?.suits===a.suits)||(numberLock!==null&&old?.n+numberStep()===a.n))){showEvent([lock?'絵柄縛り！':'',numberLock!==null?'数字縛り！':''].filter(Boolean).join(' ＋ '))}
 if(rules.revolution&&a.len>=4&&(a.type==='set'||a.type==='run')){revolution=!revolution;notice(revolution?'革命発動！ 3が最強・2が最弱！':'革命返し！ カードの強さが元に戻った！');showRevolution(revolution)}
 if(players[who].hand.length===0){if(illegalFinish(cs,a,wasSp3)){notice(players[who].name+'は反則上がり！ 最下位確定');players[who].forbidden=true;finish.push(who);players[who].hand=[];if(finish.length===3){for(let j=0;j<4;j++)if(!finish.includes(j))finish.push(j);endGame();return}}
 else{finishPlayer(who);if(finish.length===4)return}}
 render();afterPlay(who,a,wasSp3)}
function doPass(who){
 if(phase&&phase.who===who){completeSpecial([]);return}
 if(!pile)return;
 // The player who last played should never be asked to pass on their own pile.
 if(who===last){clearPile(who);return}
 notice(players[who].name+'がパス');passes.add(who);
 advance(who);
}
function completeSpecial(cs){if(!phase)return;const {who,kind,rest,max}=phase;const hand=players[who].hand;
 if(kind==='queen'&&cs.length===1){/* handled by Q rank picker below */}if(kind==='seven'&&cs.length>0&&cs.length<=max){let to=next(who);if(to!==who&&to>=0){let ids=new Set(cs.map(c=>c.id));players[who].hand=hand.filter(c=>!ids.has(c.id));players[to].hand.push(...cs);sortHand(players[to].hand);notice(players[who].name+'が'+players[to].name+'に'+cs.length+'枚渡した');showEvent('7渡し！ '+cs.length+'枚')}}
 if(kind==='ten'&&cs.length&&cs.length<=max){let ids=new Set(cs.map(c=>c.id));players[who].hand=hand.filter(c=>!ids.has(c.id));notice(players[who].name+'が'+cs.length+'枚追加で捨てた');showEvent('10捨て！ '+cs.length+'枚')}
 phase=null;selected.clear();if(players[who].hand.length===0&&!finish.includes(who)){if(rules.forbid&&kind==='ten'&&cs.some(c=>c.joker||c.n===8||c.n===15||(revolution&&c.n===3))){players[who].forbidden=true;finish.push(who);notice('禁止上がり！ 最下位確定')}else finishPlayer(who);if(finish.length===4)return}
 if(rest.length&&players[who].hand.length){phase={...rest[0],who,rest:rest.slice(1)};render();schedule();return}
 advance(who)}
function chooseCpuRank(){let counts={};for(let p of players)for(let c of p.hand)if(!c.joker)counts[c.n]=(counts[c.n]||0)+1;return Number(Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0]||3)}
function completeQueen(rank){
 if(!phase||phase.kind!=='queen'||busy)return;
 const who=phase.who, rest=phase.rest||[],remaining=phase.remaining||1,max=phase.max;
 const label=({11:'J',12:'Q',13:'K',14:'A',15:'2'}[rank]||rank);
 const counts=players.map(p=>p.hand.filter(c=>!c.joker&&c.n===rank).length);
 const total=counts.reduce((a,b)=>a+b,0);
 busy=true;bombAnimating=true;clearTimeout(timer);selected.clear();
 const fx=$('bombFx');
 $('bombTitle').textContent=players[who].name+'のQボンバー！ '+(phase.max-remaining+1)+'/'+phase.max+'回目';
 $('bombRank').textContent=label;
 $('bombSummary').textContent='全員の「'+label+'」を消去！';
 $('bombCounts').textContent=players.map((p,i)=>p.name+'：'+counts[i]+'枚').join(' ／ ');
 fx.classList.remove('hidden');fx.classList.remove('blast');
 render();
 document.querySelectorAll('#hand .card').forEach(el=>{let c=players[0].hand.find(x=>x.id===el.dataset.id);if(c&&!c.joker&&c.n===rank)el.classList.add('bomb-target')});
 bombTimer=setTimeout(()=>{
  fx.classList.add('blast');
  document.querySelectorAll('#hand .bomb-target').forEach(el=>el.classList.add('bomb-vanish'));
  bombTimer=setTimeout(()=>{
   for(let p of players)p.hand=p.hand.filter(c=>c.joker||c.n!==rank);
   fx.classList.add('hidden');fx.classList.remove('blast');
   phase=null;busy=false;bombAnimating=false;bombTimer=null;
   notice('Qボンバー！ '+label+'を全員の手札から'+total+'枚捨てた');
   for(let i=0;i<4;i++)if(players[i].hand.length===0&&!finish.includes(i))finishPlayer(i);
   if(finish.length>=4){render();return}
   if(remaining>1&&active(who)){phase={kind:'queen',who,rest,max,remaining:remaining-1};notice('Qボンバー：あと'+(remaining-1)+'回、数字を選択！');showEvent('Qボンバー！ 次は'+(max-remaining+2)+'回目');render();schedule();return}
   if(rest.length&&players[who].hand.length){phase={...rest[0],who,rest:rest.slice(1)};render();schedule();return}
   advance(who);
  },750);
 },1050);
}
function cpuSpecial(){if(!phase)return;let h=players[phase.who].hand;if(phase.kind==='queen'){completeQueen(chooseCpuRank());return}if(!h.length){completeSpecial([]);return}if(phase.kind==='seven'){let a=[...h].sort((a,b)=>power(a)-power(b));completeSpecial(a.slice(0,phase.max))}else{let a=[...h].sort((a,b)=>power(a)-power(b));completeSpecial(a.slice(0,phase.max))}}
function cpuOptions(h){let opts=[];for(let c of h)if(valid([c]))opts.push([c]);let groups={};for(let c of h){if(c.joker)continue;(groups[c.n]??=[]).push(c)}for(let g of Object.values(groups))for(let n=2;n<=Math.min(4,g.length);n++)if(valid(g.slice(0,n)))opts.push(g.slice(0,n));
 let joker=h.find(c=>c.joker);if(joker){for(let g of Object.values(groups))for(let n=1;n<=Math.min(3,g.length);n++)if(valid([...g.slice(0,n),joker]))opts.push([...g.slice(0,n),joker]);}if(rules.kaidan){for(let s of suits){let cards=h.filter(c=>c.s===s&&!c.joker).sort((a,b)=>a.n-b.n);for(let i=0;i<cards.length;i++){let seq=[cards[i]];for(let j=i+1;j<cards.length&&cards[j].n===seq[seq.length-1].n+1;j++){seq.push(cards[j]);if(seq.length>=3&&valid(seq))opts.push([...seq]);if(joker&&seq.length>=2&&valid([...seq,joker]))opts.push([...seq,joker])}}}}
 return opts}
function cpuTurn(){if(current===0||finish.length===4)return;let opts=cpuOptions(players[current].hand);if(!opts.length){doPass(current);return}opts.sort((x,y)=>{let a=analyze(x),b=analyze(y);return pile?a.pow-b.pow||y.length-x.length:y.length-x.length||a.pow-b.pow});doPlay(current,opts[0])}
function endGame(){cancelBomb();busy=true;clearTimeout(timer);phase=null;render();const labels=['大富豪','富豪','貧民','大貧民'];let order=[...finish];if(order.length<4){for(let i=0;i<4;i++)if(!order.includes(i))order.push(i)}
 // Forbidden finishes are always relegated to last.
 let forbidden=order.filter(i=>players[i].forbidden);order=order.filter(i=>!players[i].forbidden).concat(forbidden);
 previousRanking=order;$('modalTitle').textContent='ゲーム終了！';$('modalText').innerHTML=order.map((id,i)=>labels[i]+'：'+players[id].name).join('<br>')+'<br><br>次のゲームではカード交換があります。';$('start').textContent='次のゲームへ';$('overlay').classList.remove('hidden')}
function deck(){let d=[];for(let n=3;n<=15;n++)for(let s of suits)d.push({id:n+'-'+s,n,s});d.push({id:'joker',joker:true});for(let i=d.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[d[i],d[j]]=[d[j],d[i]]}return d}
let pendingExchange=null;
function exchange(){
 if(!previousRanking||!rules.exchange)return false;
 // First, the lower-ranked players give their strongest cards.
 let pairs=[[previousRanking[0],previousRanking[3],2],[previousRanking[1],previousRanking[2],1]];
 for(const [rich,poor,num] of pairs){
  const poorHand=players[poor].hand;
  poorHand.sort((a,b)=>power(a)-power(b));
  const given=poorHand.splice(-num,num);
  players[rich].hand.push(...given);
  sortHand(players[rich].hand);sortHand(poorHand);
 }
 // The upper-ranked players then choose which cards to return.
 const myPair=pairs.find(([rich])=>rich===0);
 for(const [rich,poor,num] of pairs){
  if(rich===0)continue;
  const richHand=players[rich].hand;
  richHand.sort((a,b)=>power(a)-power(b));
  const returned=richHand.splice(0,num);
  players[poor].hand.push(...returned);
  sortHand(richHand);sortHand(players[poor].hand);
 }
 if(myPair){
  pendingExchange={to:myPair[1],num:myPair[2]};
  selected.clear();
  notice('カード交換：受け取ったよ。返すカードを'+myPair[2]+'枚選んでね');
  return true;
 }
 notice('順位によるカード交換が完了！');
 return false;
}
function finishExchange(){
 if(!pendingExchange)return;
 const {to,num}=pendingExchange;
 const chosen=players[0].hand.filter(c=>selected.has(c.id));
 if(chosen.length!==num)return;
 const ids=new Set(chosen.map(c=>c.id));
 players[0].hand=players[0].hand.filter(c=>!ids.has(c.id));
 players[to].hand.push(...chosen);
 sortHand(players[0].hand);sortHand(players[to].hand);
 pendingExchange=null;selected.clear();
 notice('カード交換完了！ '+num+'枚を'+players[to].name+'に渡した');
 render();schedule();
}
function newGame(){
 cancelBomb();
 clearTimeout(timer);clearTimeout(revolutionFxTimer);clearTimeout(eventFxTimer);eventHoldUntil=0;$('eventFx').classList.add('hidden');$('revolutionFx').classList.add('hidden');$('bombFx').classList.add('hidden');rules={...configured};game++;
 const d=deck();
 players=[{name:'あなた'},{name:'CPU 1'},{name:'CPU 2'},{name:'CPU 3'}];
 players.forEach((p,i)=>{p.hand=d.filter((_,j)=>j%4===i);p.forbidden=false;sortHand(p.hand)});
 revolution=false;back=false;finish=[];pile=null;last=-1;passes.clear();lock=null;numberLock=null;
 selected.clear();busy=false;phase=null;skipNext=0;pendingExchange=null;
 current=game===1?0:Math.floor(Math.random()*4);logs=[];
 const needsChoice=game>1&&exchange();
 $('overlay').classList.add('hidden');
 if(!needsChoice)notice('第'+game+'ゲーム開始！');
 render();
 if(!needsChoice)schedule();
}
$('toggles').innerHTML=Object.entries(ruleNames).map(([k,v])=>'<label><input type="checkbox" data-rule="'+k+'" '+(configured[k]?'checked':'')+'>'+v+'</label>').join('');$('toggles').addEventListener('change',e=>{if(e.target.dataset.rule)configured[e.target.dataset.rule]=e.target.checked;localStorage.setItem('daifugo_rules_v5',JSON.stringify(configured))});
$('hand').addEventListener('click',e=>{let b=e.target.closest('[data-id]');if(!b||busy||phase&&phase.kind==='queen'||(current!==0&&!pendingExchange))return;let id=b.dataset.id;if(selected.has(id))selected.delete(id);else selected.add(id);render()});
$('play').addEventListener('click',()=>{if(busy||(current!==0&&!pendingExchange))return;if(pendingExchange){finishExchange();return}let cs=players[0].hand.filter(c=>selected.has(c.id));if(phase){if(phase.kind==='queen')return;if(phase.kind==='seven'&&(cs.length<1||cs.length>phase.max))return;if(phase.kind==='ten'&&(cs.length<1||cs.length>phase.max))return;completeSpecial(cs)}else doPlay(0,cs)});
$('pass').addEventListener('click',()=>{if(current!==0||busy||pendingExchange)return;doPass(0)});$('clear').addEventListener('click',()=>{selected.clear();render()});$('start').addEventListener('click',newGame);$('preRules').addEventListener('click',()=>{document.getElementById('settings').open=true;document.getElementById('settings').scrollIntoView({behavior:'smooth'});$('overlay').classList.add('hidden');$('status').textContent='ルールを設定してから、下の「ゲーム開始」を押してね';$('startInline').classList.remove('hidden')});$('startInline').addEventListener('click',()=>{newGame();$('startInline').classList.add('hidden')});$('special').addEventListener('click',e=>{let b=e.target.closest('[data-rank]');if(b&&phase&&phase.kind==='queen'&&phase.who===0)completeQueen(Number(b.dataset.rank))});
})();
