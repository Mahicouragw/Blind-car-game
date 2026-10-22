import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--enable-unsafe-swiftshader']});
const context=await browser.newContext({...devices['Pixel 7']});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
  window.realGains=[];
  const original=AudioContext.prototype.createGain;
  AudioContext.prototype.createGain=function(...args){const gain=original.apply(this,args);realGains.push(gain);return gain;};
});
await page.goto(process.env.GAME_TEST_URL ?? 'http://127.0.0.1:8080/',{waitUntil:'networkidle'});await page.waitForFunction(()=>!!window.vettaru);
await page.evaluate(()=>{const a=vettaru,s=a.screens.current;s.focusRing.focusAt(s.focusItems.findIndex(b=>b.label==='Easy Racing Ground'),{silent:true});});
const tap=()=>page.touchscreen.tap(160,380);
const twice=async()=>{await tap();await page.waitForTimeout(140);await tap();await page.waitForTimeout(750);};
await twice();assert.equal(await page.evaluate(()=>vettaru.screens.current.id),'ground');
await twice();assert.equal(await page.evaluate(()=>vettaru.screens.current.playing),true);
await page.waitForFunction(()=>vettaru.audio.buffers.has('car-horn'));
const defaults=await page.evaluate(()=>({settings:[vettaru.gameState.settings.sfxVolume,vettaru.gameState.settings.musicVolume],levels:vettaru.audio.levels,duration:vettaru.audio.buffers.get('car-horn').duration}));
assert.deepEqual(defaults.settings,[0.7,0.2]);assert.ok(defaults.duration>3);
// Actual Web Audio group gains, before, during and after game speech.
await page.waitForTimeout(600);
const before=await page.evaluate(()=>realGains.slice(1,5).map(g=>g.gain.value));
await page.evaluate(()=>vettaru.speech.say('Turn right in five hundred metres.',{hardInterrupt:true,replace:true,essential:true}));
await page.waitForTimeout(250);
const during=await page.evaluate(()=>realGains.slice(1,5).map(g=>g.gain.value));
await page.evaluate(()=>vettaru.speech.stop());await page.waitForTimeout(600);
const after=await page.evaluate(()=>realGains.slice(1,5).map(g=>g.gain.value));
for(const values of [during,after])values.forEach((v,i)=>assert.ok(Math.abs(v-before[i])<0.001,`steady group ${i}: ${before[i]} -> ${v}`));
// Actual touch hold via Chromium's mobile input, not hand-emitted gesture events.
const cdp=await context.newCDPSession(page);
await tap();assert.equal(await page.evaluate(()=>vettaru.screens.current.world.state.speed),0,'single tap brakes immediately');
await page.waitForTimeout(140);
await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:160,y:380,id:1}]});
await page.waitForTimeout(800);assert.equal(await page.evaluate(()=>!!vettaru.audio.horn.handle),false,'no horn before 1s');
await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>!!vettaru.audio.horn.handle?.running),true,'real horn after >1s');
assert.equal(await page.evaluate(()=>vettaru.screens.current.world.state.speed),12);
await page.waitForTimeout(2200);assert.equal(await page.evaluate(()=>vettaru.screens.current.world.state.speed),12,'horn not acceleration');
await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>vettaru.audio.horn.handle),null);
assert.equal(await page.evaluate(()=>vettaru.screens.current.world.state.speed),12,'horn release not stop');
await page.waitForTimeout(700);
await tap();assert.equal(await page.evaluate(()=>vettaru.screens.current.world.state.speed),0);
// Model clock is advanced explicitly here; all UI activation is real mobile input.
const navigation=await page.evaluate(()=>{
 const s=vettaru.screens.current,w=s.world;w.state.speed=12;w.state.earlySaid=false;w.state.nowSaid=false;w.state.remaining=500;
 s.tick(0.001);const early=s.element.querySelector('.easy-action').textContent;
 const lines=[];for(const m of [450,300,100,51]){w.state.remaining=m;w.drain();w.update(0.001);lines.push(...w.drain().filter(i=>i.text).map(i=>i.text));}
 w.state.remaining=50;s.tick(0.001);const now=s.element.querySelector('.easy-action').textContent;
 w.state.remaining=1;s.tick(0.1);return {early,lines,now,cursor:s.focusRing.current.label};
});
assert.match(navigation.early,/500 metres/);assert.deepEqual(navigation.lines,[]);assert.match(navigation.now,/Turn right now/);assert.equal(navigation.cursor,'Try again');
await page.waitForTimeout(3500);assert.equal(await page.evaluate(()=>vettaru.screens.current.world.state.out),true);
await tap();await page.waitForTimeout(750);assert.equal(await page.evaluate(()=>vettaru.screens.current.world.state.out),true,'single tap confirms, never retries');
await twice();assert.equal(await page.evaluate(()=>vettaru.screens.current.world.state.out),false,'double tap manually retries');
// Both volume buttons use the cursor rule and persist independently.
await page.evaluate(()=>{const s=vettaru.screens.current;s.openMenu();s.focusRing.focusAt(s.focusItems.findIndex(b=>b.label==='Increase sound effects volume'),{silent:true});});
await twice();assert.equal(await page.evaluate(()=>vettaru.gameState.settings.sfxVolume),0.75);assert.equal(await page.evaluate(()=>vettaru.gameState.settings.musicVolume),0.2);
await page.evaluate(()=>{const s=vettaru.screens.current;s.focusRing.focusAt(s.focusItems.findIndex(b=>b.label==='Decrease music volume'),{silent:true});});
await twice();assert.equal(await page.evaluate(()=>vettaru.gameState.settings.musicVolume),0.15);
await page.evaluate(()=>vettaru.screens.openExit());assert.equal(await page.evaluate(()=>vettaru.audio.music.playing),false);assert.equal(await page.evaluate(()=>vettaru.audio.horn.handle),null);
assert.deepEqual(errors,[]);
console.log(JSON.stringify({result:'PASS: real Chromium Pixel-7 horn, brake, manual retry, 500/50m, independent controls, fixed real group gains and Exit',defaults,gains:{before,during,after},navigation,errors},null,2));
await browser.close();
