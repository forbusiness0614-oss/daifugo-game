const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../game.js'),'utf8');
function game(){
 const elements=new Map(), timers=[],pending=new Map();let now=0;
 const element=()=>({classList:{add(){},remove(){},toggle(){}},addEventListener(){},replaceChildren(){},dataset:{}});
 const context=vm.createContext({document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)},createElement:element,querySelectorAll(){return []}},localStorage:{getItem(){return null}},Date:{now:()=>now},setTimeout(fn,delay=0){timers.push(fn);pending.set(timers.length,{fn,at:now+delay});return timers.length},clearTimeout(id){pending.delete(id)},console});
 // Expose internal actions only in this test VM; production stays encapsulated.
 vm.runInContext(source.replace(/\}\)\(\);\s*$/,`globalThis.api={run(code){return eval(code)}};})();`),context);
 const run=code=>context.api.run(code);
 run(`players=Array.from({length:4},(_,i)=>({name:'P'+i,hand:[{id:'h'+i,n:14,s:'♣'}]})); rules.forbid=false;`);
 function until(condition,limit=100){
  for(let i=0;i<limit;i++){
   if(condition())return;
   const entry=[...pending].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
   assert.ok(entry,'expected a scheduled callback');
   const [id,task]=entry;pending.delete(id);now=task.at;task.fn();
  }
  assert.fail('scheduler did not reach expected state');
 }
 return {run,timers,until,pending};
}
function setup(g,last=0){g.run(`pile={cards:[{n:4,s:'♠'}],a:analyze([{n:4,s:'♠'}]),by:${last}};last=${last};current=1;`)}
function cleared(g,leader){assert.equal(g.run('pile'),null);assert.equal(g.run('current'),leader);assert.equal(g.run('passes.size'),0)}
test('all opponents pass, then leader can start with a weaker card',()=>{
 const g=game();setup(g);g.run('doPass(1);doPass(2)');assert.notEqual(g.run('pile'),null);g.run('doPass(3)');cleared(g,0);assert.equal(g.run("valid([{n:3,s:'♥'}])"),true);
});
test('finished last player is excluded and next active player leads',()=>{
 const g=game();setup(g);g.run('players[0].hand=[];finish=[0];doPass(1);doPass(2);doPass(3)');cleared(g,1);
});
test('already passed players are never offered another response',()=>{
 const g=game();setup(g,2);g.run('players[2].hand=[];finish=[2];passes.add(3);doPass(1)');assert.equal(g.run('current'),0);g.run('doPass(0)');cleared(g,3);
});
for(const [rank,rule] of [[13,'king'],[5,'skip']]){
 test(`${rule}: skip then remaining opponents pass`,()=>{
  const g=game();g.run(`players[0].hand.unshift({id:'play',n:${rank},s:'♠'});doPlay(0,[players[0].hand[0]])`);
  assert.equal(g.run('current'),2);assert.equal(g.run('passes.has(1)'),true);g.run('doPass(2);doPass(3)');cleared(g,0);
 });
 test(`${rule}: skipping all opponents clears immediately`,()=>{
  const g=game();g.run(`const cs=['♠','♥','♦'].map((s,i)=>({id:'p'+i,n:${rank},s}));players[0].hand.unshift(...cs);doPlay(0,cs)`);cleared(g,0);
 });
}
test('K skip on finishing play clears after surviving opponents pass',()=>{
 const g=game();g.run("players[0].hand=[{id:'k',n:13,s:'♠'}];doPlay(0,[players[0].hand[0]]);doPass(2);doPass(3)");cleared(g,1);
});
test('new play resets previous passes',()=>{
 const g=game();setup(g);g.run("passes.add(1);players[2].hand.unshift({id:'six',n:6,s:'♥'});doPlay(2,[players[2].hand[0]])");assert.equal(g.run('passes.size'),0);assert.equal(g.run('last'),2);
});
for(const [label,cards] of [['revolution',"['♠','♥','♦','♣'].map((s,i)=>({id:'r'+i,n:4,s}))"],['run revolution',"[3,4,5,6].map(n=>({id:'r'+n,n,s:'♠'}))"]]){
 test(`${label} persists after pile clears`,()=>{
  const g=game();g.run(`const cs=${cards};players[0].hand.unshift(...cs);doPlay(0,cs)`);assert.equal(g.run('revolution'),true);g.run('doPass(1);doPass(2);doPass(3)');cleared(g,0);assert.equal(g.run('revolution'),true);assert.equal(g.run('strength(3)>strength(15)'),true);
 });
}
test('suit/number locks enforce responses and reset with 11 back on clear',()=>{
 const g=game();setup(g);g.run("players[1].hand.unshift({id:'five',n:5,s:'♠'});rules.skip=false;doPlay(1,[players[1].hand[0]])");assert.equal(g.run('lock'),'♠');assert.equal(g.run('numberLock'),6);assert.equal(g.run("valid([{n:6,s:'♥'}])"),false);assert.equal(g.run("valid([{n:7,s:'♠'}])"),false);assert.equal(g.run("valid([{n:6,s:'♠'}])"),true);g.run('back=true;doPass(2);doPass(3);doPass(0)');cleared(g,1);assert.equal(g.run('lock'),null);assert.equal(g.run('numberLock'),null);assert.equal(g.run('back'),false);
});
test('Q bomber removes cards, finishes an opponent, then resumes pass handling',()=>{
 const g=game();g.run("players[0].hand.unshift({id:'q',n:12,s:'♠'});players[1].hand=[{id:'three',n:3,s:'♥'}];doPlay(0,[players[0].hand[0]]);completeQueen(3)");
 // Run the two actual animation callbacks, leaving scheduled CPU timers untouched.
 g.timers.at(-1)();g.timers.at(-1)();assert.equal(g.run('players[1].hand.length'),0);assert.equal(g.run('finish.includes(1)'),true);assert.equal(g.run('current'),2);g.run('doPass(2);doPass(3)');cleared(g,0);
});
function queenPair(g){
 g.run(`revolution=true;players.forEach((p,i)=>p.hand=[{id:'seven'+i,n:7,s:suits[i]},{id:'keep'+i,n:[14,15,3,13][i],s:suits[i]}]);
 const qs=['♥','♣'].map(s=>({id:'q'+s,n:12,s}));players[2].hand.unshift(...qs);doPlay(2,qs);`);
}
test('CPU2 Q pair in revolution completes both bombs and next CPU passes',()=>{
 const g=game();queenPair(g);
 g.until(()=>g.run('phase?.remaining===1&&!bombAnimating'));
 assert.equal(g.run('players.reduce((n,p)=>n+p.hand.filter(c=>c.n===7).length,0)'),0);
 assert.equal(g.run('pile.cards.length'),2);assert.equal(g.run('revolution'),true);
 g.until(()=>g.run('!phase&&current===3'));assert.equal(g.run('passes.size'),0);
 g.until(()=>g.run('current===0'));assert.equal(g.run('passes.has(3)'),true);
 assert.equal(g.run('bombAnimating'),false);assert.equal(g.run('busy'),false);
});
test('CPU responds with a legal lower pair in revolution after Q bomb',()=>{
 const g=game();queenPair(g);g.until(()=>g.run('!phase&&current===3'));g.run("players[3].hand.push({id:'6s',n:6,s:'♠'},{id:'6h',n:6,s:'♥'});rules.rokuro=false");
 g.until(()=>g.run('!phase&&current===3'));g.until(()=>g.run('last===3'));
 assert.equal(g.run('pile.a.n'),6);assert.equal(g.run('players[3].hand.some(c=>c.n===6)'),false);
});
test('bomb finisher is recorded immediately and does not get another selection',()=>{
 const g=game();queenPair(g);g.run("players[2].hand=[{id:'last7',n:7,s:'♠'}]");
 g.until(()=>g.run('!phase&&!bombAnimating'));assert.equal(g.run('finish.includes(2)'),true);assert.equal(g.run('current'),3);
});
test('bomb can finish multiple players and end without duplicate rankings',()=>{
 const g=game();queenPair(g);g.run("players[0].hand=[{n:7,s:'♠'}];players[1].hand=[{n:7,s:'♥'}];players[3].hand=[{n:7,s:'♦'}]");
 g.until(()=>g.run('finish.length===4'));assert.equal(g.run('new Set(finish).size'),4);assert.equal(g.run('phase'),null);assert.equal(g.run('bombAnimating'),false);
});
test('scheduling during bomb animation cannot cancel completion or duplicate bomb',()=>{
 const g=game();queenPair(g);g.until(()=>g.run('bombAnimating'));g.run('schedule();schedule();completeQueen(7)');
 g.until(()=>g.run('phase?.remaining===1&&!bombAnimating'));assert.equal(g.run('phase.max'),2);
 g.until(()=>g.run('!phase&&current===3'));
});
test('starting a new game cancels old bomb animation and its hand deletion',()=>{
 const g=game();queenPair(g);g.until(()=>g.run('bombAnimating'));g.run('newGame()');
 assert.equal(g.run('bombAnimating'),false);assert.equal(g.run('phase'),null);
 assert.equal(g.run('players.reduce((n,p)=>n+p.hand.length,0)'),53);
 // Human starts the first game: only harmless visual timers may remain.
 for(const task of [...g.pending.values()])task.fn();
 assert.equal(g.run('players.reduce((n,p)=>n+p.hand.length,0)'),53);
});
for(const [rev,back,step] of [[false,false,1],[false,true,-1],[true,false,-1],[true,true,1]]){
 test(`number lock advances with revolution=${rev}, back=${back} and suit lock`,()=>{
  const g=game();g.run(`revolution=${rev};back=${back};rules.ten=false;rules.skip=false;
   const n=${step===1?3:10};pile={cards:[{n,s:'♠'}],a:analyze([{n,s:'♠'}]),by:0};last=0;
   players[1].hand.unshift({id:'next',n:n+${step},s:'♠'});doPlay(1,[players[1].hand[0]]);`);
  const target=step===1?5:8;assert.equal(g.run('numberLock'),target);assert.equal(g.run('lock'),'♠');
  assert.equal(g.run(`valid([{n:${target},s:'♥'}])`),false);assert.equal(g.run(`valid([{n:${target},s:'♠'}])`),true);
  if(target!==8){g.run(`players[2].hand.unshift({id:'third',n:${target},s:'♠'});doPlay(2,[players[2].hand[0]])`);assert.equal(g.run('numberLock'),target+step)}
  else {g.run("players[2].hand.unshift({id:'eight',n:8,s:'♠'});doPlay(2,[players[2].hand[0]])");cleared(g,2)}
 });
}
test('J activates back and reverses the next number lock target',()=>{
 const g=game();g.run("pile={cards:[{n:10,s:'♠'}],a:analyze([{n:10,s:'♠'}]),by:0};last=0;players[1].hand.unshift({id:'j',n:11,s:'♠'});doPlay(1,[players[1].hand[0]])");
 assert.equal(g.run('back'),true);assert.equal(g.run('numberLock'),10);assert.equal(g.run("valid([{n:10,s:'♠'}])"),true);
});
test('CPU observes descending number and suit locks or passes when no match',()=>{
 const g=game();g.run("back=true;rules.ten=false;pile={cards:[{n:10,s:'♠'}],a:analyze([{n:10,s:'♠'}]),by:0};last=0;lock='♠';numberLock=9;current=2;players[2].hand=[{id:'wrong',n:9,s:'♥'}];schedule()");
 g.until(()=>g.run('passes.has(2)'));assert.equal(g.run('current'),3);
 const h=game();h.run("back=true;rules.ten=false;pile={cards:[{n:10,s:'♠'}],a:analyze([{n:10,s:'♠'}]),by:0};last=0;lock='♠';numberLock=9;current=2;players[2].hand.unshift({id:'right',n:9,s:'♠'});schedule()");
 h.until(()=>h.run('last===2'));assert.equal(h.run('numberLock'),8);
});
