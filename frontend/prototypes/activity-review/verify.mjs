import {chromium,webkit,devices,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {seed,balances,recommendations,equalShares,parseAmount} from './model.js';

const root=dirname(fileURLToPath(import.meta.url)),out=resolve(root,'../../../artifacts/activity-review');
await mkdir(out,{recursive:true});
const url='http://127.0.0.1:'+Number(process.env.ACTIVITY_REVIEW_PORT||4288);
const identity=await fetch(url);assert.equal(identity.headers.get('x-activity-review'),'prototype');
const original=seed();assert.equal(original.bills.length,30);assert.deepEqual(balances(original),[-68000,82000,18000,-32000,-45000,45000]);
assert.equal(balances(original).reduce((a,b)=>a+b,0),0);assert.equal(Object.values(equalShares(101)).reduce((a,b)=>a+b,0),101);assert.throws(()=>parseAmount('0'));assert.throws(()=>parseAmount('1.001'));
const partial=seed();partial.payments.push({payer:0,receiver:1,amount:20000});assert.equal(balances(partial)[0],-48000);for(const r of recommendations(partial))partial.payments.push(r);assert.ok(balances(partial).every(n=>n===0));

const report={generatedAt:new Date().toISOString(),method:'Local functional prototype; scripted paths, one warm-up and three measured repetitions. No human timings or physical-device evidence.',modelChecks:'passed',results:[],extraChecks:[]};
const frame=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));

/** 显式定位才能区分路径需要的滚动与界面自己的恢复；还检查固定页头、底栏后的可点击区域。 */
async function reveal(page,loc){
 await expect(loc).toBeVisible();
 await loc.evaluate(el=>{
  const isSheet=Boolean(el.closest('dialog')),container=isSheet?el.closest('.sheet-body'):null;
  const rect=el.getBoundingClientRect();let top=0,bottom=innerHeight;
  if(container){const b=container.getBoundingClientRect();top=b.top+4;bottom=b.bottom-4;}
  else if(isSheet){return;}
  else{top=Math.max(...[...document.querySelectorAll('.top,.tabs')].map(e=>e.getBoundingClientRect().bottom),0)+4;bottom=document.querySelector('.dock')?.getBoundingClientRect().top??innerHeight;}
  // 固定导航及底栏本身不需要避让自身。
  if(el.closest('.top,.tabs,.dock'))return;
  let delta=rect.bottom>bottom?rect.bottom-bottom+8:rect.top<top?rect.top-top-8:0;
  if(delta){window.review.markScroll('reveal');if(container)container.scrollTop+=delta;else window.scrollBy(0,delta);}
 });await frame(page);
}
async function click(page,loc){await reveal(page,loc);await loc.click();await frame(page);}
const act=(page,name)=>page.locator(`[data-action="${name}"]`);
async function fill(page,loc,value){await click(page,loc);await loc.fill(value);}
async function select(page,loc,value){await reveal(page,loc);await loc.selectOption(String(value));await frame(page);}
async function personal(page){await click(page,act(page,'personal'));}
async function openPayment(page,payer=0,receiver=1){await click(page,page.getByRole('button',{name:`记录${['小林','小王','小李','小陈','小赵','小刘'][payer]}付给${['小林','小王','小李','小陈','小赵','小刘'][receiver]}`,exact:true}));}
async function savePayment(page,amount){await fill(page,page.getByLabel('金额（CNY）',{exact:true}),amount);await click(page,page.getByRole('button',{name:'记录结算',exact:true}));}
async function goto(page,variant,scenario,query=''){await page.goto(`${url}/app.html?variant=${variant}&scenario=${scenario}${query}`);await expect(page.getByRole('heading',{name:'云南旅行',exact:true})).toBeVisible();await frame(page);}
async function geometry(page){return page.evaluate(()=>{
 const first=document.querySelector('.bill'),dock=document.querySelector('.dock')?.getBoundingClientRect().top??innerHeight,top=document.querySelector('.top').getBoundingClientRect().bottom;
 return {firstBillTop:Math.round(first.getBoundingClientRect().top),fullyReadableBills:[...document.querySelectorAll('.bill')].filter(el=>{const r=el.getBoundingClientRect();return r.top>=top&&r.bottom<=dock;}).length,horizontalOverflow:document.documentElement.scrollWidth>innerWidth,viewport:{width:innerWidth,height:innerHeight},contentBottom:dock};
 });}
async function task(page,variant,n){
 let returnShiftPx=0;
 if(n===1){
  for(const [title,amount] of [['早餐','180'],['打车','60'],['水果','36']]){
   await click(page,act(page,'add'));await fill(page,page.getByLabel('用途',{exact:true}),title);await fill(page,page.getByLabel('金额（CNY）',{exact:true}),amount);await click(page,page.getByRole('button',{name:'保存账单',exact:true}));
  }
  assert.equal((await page.evaluate(()=>review.state.data.bills.length)),33);
  await click(page,act(page,'search'));await fill(page,page.getByRole('searchbox',{name:'搜索账单'}),'晚餐');await click(page,act(page,'filter'));await select(page,page.getByLabel('消费日期',{exact:true}),'2026-09-23');await click(page,page.getByRole('button',{name:'应用筛选'}));
  const row=act(page,'detail:e24');await reveal(page,row);const before=await row.boundingBox();await click(page,row);await expect(page.getByRole('heading',{name:'账单详情'})).toBeVisible();await click(page,act(page,'close'));returnShiftPx=Math.abs((await row.boundingBox()).y-before.y);
  assert.equal((await page.evaluate(()=>review.state.query)),'晚餐');assert.equal((await page.evaluate(()=>review.state.dateFilter)),'2026-09-23');
 }else if(n===2){
  await personal(page);await openPayment(page);await savePayment(page,'200');assert.equal((await page.evaluate(()=>review.state.balances[0])),-48000);assert.equal((await page.evaluate(()=>review.state.data.payments.length)),2);
  if(variant==='A'){await expect(page.getByRole('dialog')).toContainText('480');await click(page,act(page,'close'));}else await click(page,act(page,'feed'));
 }else{
  if(variant==='A')await click(page,act(page,'settlement'));else{await personal(page);await click(page,act(page,'scope-all'));}
  await click(page,act(page,'balances'));await expect(page.locator('[aria-label="全员余额"] .balance-row')).toHaveCount(6);
  for(const row of await page.locator('[aria-label="全员余额"] .balance-row').all())await reveal(page,row);
  for(const [payer,receiver,amount] of [[0,1,'200'],[3,1,'320'],[4,5,'450']]){
   await click(page,act(page,'manual'));await select(page,page.getByLabel('付款人',{exact:true}),payer);await select(page,page.getByLabel('收款人',{exact:true}),receiver);await savePayment(page,amount);assert.equal(await page.evaluate(()=>review.state.view),'settlement');
  }
  assert.deepEqual(await page.evaluate(()=>review.state.balances),[-48000,30000,18000,0,0,0]);
  // 完成核对意味着实际滚动到每条新付款与余额，而非仅断言它们存在于 DOM 中。
  await expect(page.locator('.history-item')).toHaveCount(4);
  for(const row of (await page.locator('.history-item').all()).slice(0,3))await reveal(page,row);
  for(const row of await page.locator('[aria-label="全员余额"] .balance-row').all())await reveal(page,row);
  await expect(page.locator('[aria-label="全员余额"]')).toContainText('已结清');await click(page,act(page,'feed'));
 }
 assert.ok(returnShiftPx<=1,'Closing detail should preserve the source bill position');
 return {...await page.evaluate(()=>review.metrics),returnShiftPx};
}

const configs=[{name:'chromium-mobile',engine:chromium,device:devices['Pixel 5'],viewport:{width:390,height:844}},{name:'chromium-compact',engine:chromium,device:devices['Pixel 5'],viewport:{width:320,height:568}},{name:'webkit-iphone',engine:webkit,device:devices['iPhone 13'],viewport:{width:390,height:664}}];
for(const config of configs){
 const browser=await config.engine.launch();const context=await browser.newContext({...config.device,viewport:config.viewport,locale:'zh-CN',timezoneId:'Asia/Shanghai',serviceWorkers:'block'});const page=await context.newPage();page.setDefaultTimeout(6000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
 for(const variant of ['A','B']){
  await goto(page,variant,1);const screen=await geometry(page);assert.equal(screen.horizontalOverflow,false);await page.screenshot({path:resolve(out,`${config.name}-${variant}-home.png`)});
  await click(page,act(page,'detail:e30'));await page.screenshot({path:resolve(out,`${config.name}-${variant}-detail.png`)});await click(page,act(page,'close'));
  await personal(page);await page.screenshot({path:resolve(out,`${config.name}-${variant}-personal.png`)});await openPayment(page);await page.screenshot({path:resolve(out,`${config.name}-${variant}-payment.png`)});
  await goto(page,variant,3);if(variant==='A')await click(page,act(page,'settlement'));else{await personal(page);await click(page,act(page,'scope-all'));}await click(page,act(page,'balances'));await page.screenshot({path:resolve(out,`${config.name}-${variant}-all.png`)});
  const item={device:config.name,variant,geometry:screen,tasks:[]};
  for(let n=1;n<=3;n++){
   const samples=[];for(let run=0;run<4;run++){await goto(page,variant,n);await page.evaluate(()=>review.resetMetrics());const result=await task(page,variant,n);if(run)samples.push(result);}
   const med=key=>{const vals=samples.map(key).sort((a,b)=>a-b);return Math.round(vals[1]*10)/10;};
   item.tasks.push({task:n,elapsedMs:med(r=>r.elapsedMs),clicks:med(r=>r.clicks),selections:med(r=>r.selections),viewChanges:med(r=>r.viewChanges),sheetOpens:med(r=>r.sheetOpens),sheetCloses:med(r=>r.sheetCloses),sheetSteps:med(r=>r.sheetSteps),pageScrollPx:med(r=>Object.values(r.scroll.page).reduce((a,b)=>a+b,0)),sheetScrollPx:med(r=>Object.values(r.scroll.sheet).reduce((a,b)=>a+b,0)),revealScrollPx:med(r=>r.scroll.page.reveal+r.scroll.sheet.reveal),restoreScrollPx:med(r=>r.scroll.page.restore+r.scroll.sheet.restore),returnShiftPx:med(r=>r.returnShiftPx),samples});
  }
  report.results.push(item);console.log(JSON.stringify({...item,tasks:item.tasks.map(({samples,...rest})=>rest)}));await writeFile(resolve(out,'measurements.json'),JSON.stringify(report,null,2));
  // 错误输入、重复付款、全额结清、列表锚点、大字体、长金额和软键盘占位。
  await goto(page,variant,2);await personal(page);await openPayment(page);await page.evaluate(()=>review.failNext());await savePayment(page,'200');await expect(page.getByRole('alert')).toContainText('保存失败');await expect(page.getByLabel('金额（CNY）',{exact:true})).toHaveValue('200');assert.equal(await page.evaluate(()=>review.state.data.payments.length),1);await click(page,page.getByRole('button',{name:'记录结算',exact:true}));assert.equal(await page.evaluate(()=>review.state.data.payments.length),2);
  await goto(page,variant,1);const target=act(page,'detail:e10');await reveal(page,target);const before=(await target.boundingBox()).y;await click(page,target);await click(page,act(page,'close'));assert.ok(Math.abs((await target.boundingBox()).y-before)<=1);
  // 离开一段很长的账单列表，再从结算返回，观察同一账单的位置。
  const anchorY=(await target.boundingBox()).y;if(variant==='A')await click(page,act(page,'settlement'));else{await click(page,act(page,'personal'));}await click(page,act(page,'feed'));const returnDelta=Math.abs((await target.boundingBox()).y-anchorY);
  await goto(page,variant,2);await page.evaluate(()=>review.settleAll());await personal(page);await expect(page.getByRole('dialog').or(page.locator('.settlement'))).toContainText('已结清');
  await goto(page,variant,1,'&large=1&amount=long');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:resolve(out,`${config.name}-${variant}-large.png`)});
  await click(page,act(page,'add'));await page.evaluate(()=>{Object.defineProperty(window.visualViewport,'height',{configurable:true,value:360});visualViewport.dispatchEvent(new Event('resize'));});await fill(page,page.getByLabel('用途',{exact:true}),'长金额检验');const save=page.getByRole('button',{name:'保存账单',exact:true});const box=await save.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=361,JSON.stringify(box));await page.screenshot({path:resolve(out,`${config.name}-${variant}-keyboard.png`)});
  await page.evaluate(()=>{Reflect.deleteProperty(window.visualViewport,'height');visualViewport.dispatchEvent(new Event('resize'));});
  report.extraChecks.push({device:config.name,variant,inputFailurePreserved:true,retryOnlyOnePayment:true,detailAnchorPreserved:true,settlementReturnShiftPx:Math.round(returnDelta),zeroBalance:true,largeTextAndAmount:true,simulatedKeyboard:true,pageErrors:[...errors]});assert.equal(errors.length,0);await writeFile(resolve(out,'measurements.json'),JSON.stringify(report,null,2));
 }
 }catch(error){await page.screenshot({path:resolve(out,`${config.name}-failure.png`)});await writeFile(resolve(out,'failure.txt'),error.stack);throw error;}finally{await browser.close();}
}
console.log('Completed. Evidence: '+out);
