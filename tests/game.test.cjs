const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../game.js'),'utf8');
function game(){
 const elements=new Map(), timers=[];
 const element=()=>({classList:{add(){},remove(){},toggle(){}},addEventListener(){},replaceChildren(){},dataset:{}});
 const context=vm.createContext({document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)},createElement:element,querySelectorAll(){return []}},localStorage:{getItem(){return null}},setTimeout(fn){timers.push(fn);return timers.length},clearTimeout(){},console});
 // Expose internal actions only in this test VM; production stays encapsulated.
 vm.runInContext(source.replace(/\}\)\(\);\s*$/,`globalThis.api={run(code){return eval(code)}};})();`),context);
 const run=code=>context.api.run(code);
 run(`players=Array.from({length:4},(_,i)=>({name:'P'+i,hand:[{id:'h'+i,n:14,s:'♣'}]})); rules.forbid=false;`);
 return {run,timers};
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
