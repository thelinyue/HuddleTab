import {members,today,money,seed,balances,recommendations,equalShares,parseAmount} from './model.js';

const params=new URLSearchParams(location.search),variant=params.get('variant')==='B'?'B':'A';
document.documentElement.classList.toggle('large',params.get('large')==='1');
const app=document.querySelector('#app'),sheet=document.querySelector('#sheet');
let data,me,view,scope,searchOpen,query,dateFilter,balanceOpen,modal,origin,failNext=false,sequence=0;
const positions={feed:0,settlement:0};
const icons={back:'<path d="m14 5-7 7 7 7"/>',chevron:'<path d="m9 5 7 7-7 7"/>',down:'<path d="m5 9 7 7 7-7"/>',plus:'<path d="M12 5v14M5 12h14"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',filter:'<path d="M4 7h16M7 12h10M10 17h4"/>',more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',food:'<path d="M6 3v7m4-7v7M8 3v18M4 3v5q0 4 8 0V3M18 3q-4 5 0 9v9V3"/>',arrow:'<path d="M4 12h16m-5-5 5 5-5 5"/>',transport:'<path d="m5 8 2-4h10l2 4M4 9h16v8H4zM7 17v3m10-3v3M7 12h1m8 0h1"/>'};
const icon=n=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[n]||icons.food}</svg>`;
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(action,label,cls='',content=escape(label),extra='')=>`<button type="button" data-action="${action}" aria-label="${escape(label)}" class="${cls}" ${extra}>${content}</button>`;
const name=id=>members[id].name;
const avatar=id=>`<span class="avatar" aria-hidden="true">${name(id).slice(1)}</span>`;
const netLabel=n=>n<0?'我的应付':n>0?'我的应收':'我的结算';
const netText=n=>n===0?'已结清':money(Math.abs(n));

/** 测量分开记录路径展开所需滚动、界面自动恢复与普通滚动；不把脚本时间当真人耗时。 */
let metrics,scrollKind='user',scrollToken=0,lastY=0,sheetY=0;
function resetMetrics(){metrics={clicks:0,selections:0,viewChanges:0,sheetOpens:0,sheetCloses:0,sheetSteps:0,scroll:{page:{user:0,reveal:0,restore:0},sheet:{user:0,reveal:0,restore:0}},started:performance.now()};lastY=window.scrollY;sheetY=sheet.querySelector('.sheet-body')?.scrollTop||0;}
function markScroll(kind){scrollKind=kind;const token=++scrollToken;requestAnimationFrame(()=>requestAnimationFrame(()=>{if(token===scrollToken)scrollKind='user';}));}
window.addEventListener('scroll',()=>{if(metrics)metrics.scroll.page[scrollKind]+=Math.abs(scrollY-lastY);lastY=scrollY;},{passive:true});
sheet.addEventListener('scroll',event=>{if(event.target.matches('.sheet-body')){const y=event.target.scrollTop;if(metrics)metrics.scroll.sheet[scrollKind]+=Math.abs(y-sheetY);sheetY=y;}},true);
document.addEventListener('click',()=>{if(metrics)metrics.clicks++;},true);
document.addEventListener('change',event=>{if(metrics&&event.target.matches('select'))metrics.selections++;},true);

function reset(scenario=Number(params.get('scenario')||1)){
 if(sheet.open)sheet.close();data=seed();me=scenario===3?1:0;view='feed';scope='mine';searchOpen=false;query='';dateFilter='';balanceOpen=false;modal=null;origin=null;failNext=false;positions.feed=positions.settlement=0;
 if(params.get('amount')==='long'){data.bills[0].amount+=1234567800;data.bills[0].shares=equalShares(data.bills[0].amount);}
 render();window.scrollTo(0,0);resetMetrics();
}
function summary(){const total=data.bills.reduce((n,b)=>n+b.amount,0),net=balances(data)[me];return `<section class="summary" aria-label="活动摘要"><div class="summary-grid"><div><span class="eyebrow">总消费 · CNY</span><strong class="total">${money(total)}</strong></div>${button('personal','查看我的结算','personal',`<span class="eyebrow">${netLabel(net)} ${icon('chevron')}</span><strong data-my-balance>${netText(net)}</strong>`)}</div><div class="summary-foot"><span>${data.bills.length} 笔消费 · 人均 ${money(Math.round(total/6))}</span>${button('explain','消费与余额说明','','金额说明 ⓘ')}</div></section>`;}
function top(){const independent=variant==='B'&&view==='settlement';return `<header class="top">${button(independent?'feed':'info',independent?'返回账单':'活动信息','icon-button',icon('back'))}<h1>${independent?'结算':'云南旅行'}</h1>${params.get('status')==='ended'?'<span class="badge">已结束</span>':''}${!independent?button('members','成员 6人','member-link','成员 6人'):''}${button('info','更多操作','icon-button',icon('more'))}</header>`;}
function render(){app.innerHTML=top()+(!(variant==='B'&&view==='settlement')?summary():'')+(variant==='A'?`<nav class="tabs" aria-label="活动导航">${button('feed','账单',view==='feed'?'active':'','账单',`aria-current="${view==='feed'?'page':'false'}"`)}${button('settlement','结算',view==='settlement'?'active':'','结算',`aria-current="${view==='settlement'?'page':'false'}"`)}</nav>`:'')+(view==='feed'?feed():settlement())+(view==='feed'&&params.get('status')!=='ended'?`<footer class="dock">${button('add','记一笔','primary',icon('plus')+'记一笔')}</footer>`:'');}
function feed(){return `<section class="feed" aria-label="账单列表"><div class="feed-tools"><strong>全部账单</strong>${button('search','搜索','text-action',icon('search')+'搜索')}${button('filter','筛选','text-action',icon('filter')+(dateFilter?'筛选 · 1':'筛选'))}</div>${searchOpen?`<div class="searchbox"><input type="search" id="search" aria-label="搜索账单" placeholder="搜索用途或备注" value="${escape(query)}">${button('cancel-search','取消搜索','text-action','取消')}</div>`:''}<div id="bill-results">${billResults()}</div></section>`;}
function billResults(){
 const bills=data.bills.filter(b=>(!dateFilter||b.date===dateFilter)&&(!query||`${b.title} ${b.note}`.includes(query))).sort((a,b)=>b.date.localeCompare(a.date)||Number(b.id.slice(1))-Number(a.id.slice(1)));
 let html=dateFilter?`<div class="chips">${button('clear-filter','清除日期筛选','','昨天 · 9月23日 ×')}<span>${bills.length} 笔</span></div>`:'';let last='';
 for(const b of bills){if(b.date!==last){last=b.date;const dayTotal=bills.filter(x=>x.date===last).reduce((n,x)=>n+x.amount,0);html+=`<h2 class="day"><span>${last===today?'今天 · 9月24日':last==='2026-09-23'?'昨天 · 9月23日':last.replace('2026-','').replace('-','月')+'日'}</span><span>${money(dayTotal)}</span></h2>`;}html+=button(`detail:${b.id}`,`查看${b.title}`,'bill',`<span class="bill-icon ${b.category==='交通'?'transport':''}">${icon(b.category==='交通'?'transport':'food')}</span><span class="bill-center"><span class="bill-title">${escape(b.title)}</span><small>${name(b.payer)}付款 · ${Object.keys(b.shares).length}人分摊</small></span><span class="bill-amount">${money(b.amount)}</span>`,`data-bill-id="${b.id}"`);}
 return html||'<p class="empty">没有符合条件的账单<br>试试其他搜索词或筛选条件</p>';
}
function balanceList(){const sums=balances(data);return `<div class="balances" aria-label="全员余额">${members.map(m=>`<div class="balance-row" data-member="${m.id}">${avatar(m.id)}<span>${m.name}${m.id===me?'（我）':''}</span><strong>${sums[m.id]>0?'应收 ':sums[m.id]<0?'应付 ':''}${netText(sums[m.id])}</strong></div>`).join('')}</div>`;}
function transfers(mine=false){const rows=recommendations(data).filter(r=>!mine||r.payer===me||r.receiver===me);return rows.length?rows.map(r=>`<div class="transfer"><div><div class="parties">${avatar(r.payer)}${name(r.payer)} ${icon('arrow')} ${name(r.receiver)}</div><strong class="transfer-amount">${money(r.amount)}</strong></div>${button(`pay:${r.payer}:${r.receiver}:${r.amount}`,`记录${name(r.payer)}付给${name(r.receiver)}`,'record','记录')}</div>`).join(''):'<p class="success">当前余额已结清</p>';}
function histories(mine=false){const rows=data.payments.filter(p=>!mine||p.payer===me||p.receiver===me);return `<section aria-label="实际结算记录"><div class="section-head"><h2>实际结算记录</h2></div>${rows.length?rows.slice().reverse().map(p=>`<div class="history-item" data-payment-id="${p.id}"><header><span>${name(p.payer)} → ${name(p.receiver)}</span><strong>${money(p.amount)}</strong></header><small>${p.date.slice(5).replace('-','月')}日 · 活动整体结算</small></div>`).join(''):'<p class="empty">还没有结算记录</p>'}</section>`;}
function settlement(){const b=variant==='B',mine=b&&scope==='mine',sums=balances(data);return `<section class="settlement" aria-label="结算工作区">${b?`<div class="segment" role="group" aria-label="结算范围">${button('scope-mine','与我有关',mine?'active':'')}${button('scope-all','全部成员',!mine?'active':'')}</div>`:''}${mine?`<h2 class="subpage-title"><small>${netLabel(sums[me])}</small>${netText(sums[me])}</h2>`:`${button('balances','成员余额','balance-toggle',`成员余额 <small>${sums.filter(n=>n!==0).length}人未结清 ${balanceOpen?'⌃':'⌄'}</small>`,`aria-expanded="${balanceOpen}"`)}${balanceOpen?balanceList():''}`}<section aria-label="推荐转账"><div class="section-head"><h2>推荐转账</h2>${button('manual','补记结算','','＋ 补记')}</div><p class="section-sub">依据当前余额计算 · 尽量减少转账次数</p>${transfers(mine)}</section>${histories(mine)}</section>`;}
function navigate(next){if(modal)closeModal(false);if(next===view)return;positions[view]=scrollY;view=next;metrics.viewChanges++;markScroll('restore');render();window.scrollTo(0,positions[next]);}
function restoreFocus(){if(origin){const el=app.querySelector(`[data-action="${CSS.escape(origin)}"]`);el?.focus({preventScroll:true});}}
function openModal(next){if(!modal){origin=document.activeElement?.dataset?.action||null;metrics.sheetOpens++;}else metrics.sheetSteps++;modal=next;renderModal();if(!sheet.open)sheet.showModal();syncViewport();}
function closeModal(focus=true){if(!modal)return;metrics.sheetCloses++;modal=null;sheet.close();document.body.style.overflow='';if(focus)restoreFocus();}
function modalHeader(title,back){return `<header class="sheet-header">${back?button('modal-back','返回上一级','icon-button',icon('back')):'<span class="spacer"></span>'}<h2 id="sheet-title">${title}</h2>${button('close','关闭面板','icon-button',icon('close'))}</header>`;}
function personOptions(selected){return members.map(m=>`<option value="${m.id}" ${selected===m.id?'selected':''}>${m.name}${m.id===me?'（我）':''}</option>`).join('');}
function renderModal(){
 let title='',body='',footer='',back=false;
 if(modal.type==='personal'){const n=balances(data)[me];title='我的结算';body=`<h3 class="subpage-title"><small>${netLabel(n)}</small>${netText(n)}</h3>${transfers(true)}${button('full-settlement','查看完整结算','sheet-link','查看完整结算 '+icon('chevron'))}`;}
 if(modal.type==='pay'){
  title='记录结算';back=modal.from==='personal';body=`<form id="payment-form"><div class="two-col"><div><label for="payer">付款人</label><select id="payer" name="payer">${personOptions(modal.payer??me)}</select></div><div><label for="receiver">收款人</label><select id="receiver" name="receiver">${personOptions(modal.receiver??(me===1?0:1))}</select></div></div><label for="amount">金额（CNY）</label><input id="amount" name="amount" class="amount-input" inputmode="decimal" value="${modal.amount?modal.amount/100:''}" required><p class="hint">可按实际付款金额修改，支持部分付款。</p><div class="method-note"><span class="eyebrow">活动整体结算 · 未指定具体账单</span></div><p class="hint">请在实际转账后记录。记录后余额和推荐会同步更新。</p><p class="error" role="alert" id="form-error"></p></form>`;footer='<button class="primary" type="submit" form="payment-form">记录结算</button>';
 }
 if(modal.type==='add'){
  title='记一笔';body=`<form id="expense-form"><label for="expense-title">用途</label><input id="expense-title" name="title" placeholder="例如：晚餐" required maxlength="80"><label for="expense-amount">金额（CNY）</label><input id="expense-amount" name="amount" class="amount-input" inputmode="decimal" placeholder="0.00" required><div class="two-col"><div><label for="expense-payer">付款人</label><select id="expense-payer" name="payer">${personOptions(me)}</select></div><div><label for="expense-date">消费日期</label><input id="expense-date" name="date" type="date" value="${today}" required></div></div><p class="hint">本次为六人均分 · 每人的分摊随金额更新</p><p class="error" role="alert" id="form-error"></p></form>`;footer='<button class="primary" type="submit" form="expense-form">保存账单</button>';
 }
 if(modal.type==='detail'){
  const b=data.bills.find(b=>b.id===modal.id);title='账单详情';body=`<span class="eyebrow">${escape(b.title)}</span><div class="detail-amount">${money(b.amount)}</div><div class="detail-row"><span>付款人</span><strong>${name(b.payer)}</strong></div><div class="detail-row"><span>消费日期</span><strong>${b.date}</strong></div><div class="detail-row"><span>我的分摊</span><strong>${b.shares[me]?money(b.shares[me]):'未参与'}</strong></div><p class="hint">参与人分摊</p>${Object.entries(b.shares).map(([id,n])=>`<div class="detail-row"><span>${name(Number(id))}</span><strong>${money(n)}</strong></div>`).join('')}<p class="hint">备注：${escape(b.note)}</p>`;
 }
 if(modal.type==='filter'){title='筛选账单';body=`<form id="filter-form"><label for="filter-date">消费日期</label><select name="date" id="filter-date"><option value="">全部日期</option><option value="2026-09-23" ${dateFilter==='2026-09-23'?'selected':''}>昨天 · 9月23日</option><option value="2026-09-24" ${dateFilter===today?'selected':''}>今天 · 9月24日</option></select><p class="hint">按消费日期查找，关闭面板不应用草稿。</p></form>`;footer='<button class="primary" type="submit" form="filter-form">应用筛选</button>';}
 if(modal.type==='members'){title='活动成员';body=members.map(m=>`<div class="balance-row">${avatar(m.id)} ${m.name}<span class="eyebrow">${m.id===1?'组织者':''}${m.id===me?' · 我':''}</span></div>`).join('');}
 if(modal.type==='info'){title='活动信息';body='<h3 class="subpage-title">云南旅行</h3><div class="detail-row"><span>活动日期</span><strong>9月20日—24日</strong></div><div class="detail-row"><span>状态</span><strong>进行中</strong></div><div class="detail-row"><span>活动本位币</span><strong>CNY</strong></div><p class="hint">此原型专注记账、查找和结算三条流程，活动管理与分享暂未接入。</p>';}
 if(modal.type==='explain'){title='消费与余额';body=`<div class="detail-row"><span>我的实际消费</span><strong>${money(data.bills.reduce((n,b)=>n+(b.shares[me]||0),0))}</strong></div><p class="hint">我的消费是所有账单中我实际承担的分摊。人均消费是总消费除以六位成员，不代表每个人的实际消费。</p><p class="hint">应收／应付由垫付、分摊与已记录付款共同决定，不等于消费金额。</p>`;}
 sheet.innerHTML=modalHeader(title,back)+`<div class="sheet-body">${body}</div>`+(footer?`<footer class="sheet-footer">${footer}</footer>`:'');sheetY=0;document.body.style.overflow='hidden';
 // 初始聚焦标题关闭按钮，避免打开表单就弹键盘压缩阅读空间；输入仍有可见标签。
 sheet.querySelector('[data-action="close"]').focus({preventScroll:true});
}
function toast(message){const el=document.querySelector('#toast');el.textContent=message;el.classList.add('visible');setTimeout(()=>el.classList.remove('visible'),1800);}
function handle(action){
 if(action==='feed'||action==='settlement'){navigate(action);return;}
 if(action==='personal'){if(variant==='A')openModal({type:'personal'});else{scope='mine';navigate('settlement');}return;}
 if(action==='full-settlement'){closeModal();navigate('settlement');return;}
 if(action==='modal-back'){openModal({type:'personal'});return;}
 if(action==='close'){closeModal();return;}
 if(['info','members','add','filter','explain'].includes(action)){openModal({type:action});return;}
 if(action==='search'){searchOpen=true;render();app.querySelector('#search').focus({preventScroll:true});return;}
 if(action==='cancel-search'){searchOpen=false;query='';render();return;}
 if(action==='clear-filter'){dateFilter='';render();return;}
 if(action==='balances'){balanceOpen=!balanceOpen;render();return;}
 if(action.startsWith('scope-')){scope=action.slice(6);render();return;}
 if(action.startsWith('detail:')){openModal({type:'detail',id:action.slice(7)});return;}
 if(action==='manual'){openModal({type:'pay',from:'settlement'});return;}
 if(action.startsWith('pay:')){const [,p,r,n]=action.split(':');openModal({type:'pay',payer:Number(p),receiver:Number(r),amount:Number(n),from:modal?.type==='personal'?'personal':'settlement'});}
}
document.addEventListener('click',event=>{const target=event.target.closest('[data-action]');if(target)handle(target.dataset.action);});
app.addEventListener('input',event=>{if(event.target.id==='search'){query=event.target.value;document.querySelector('#bill-results').innerHTML=billResults();}});
sheet.addEventListener('cancel',event=>{event.preventDefault();closeModal();});
sheet.addEventListener('click',event=>{if(event.target===sheet){const r=sheet.getBoundingClientRect();if(event.clientY<r.top||event.clientY>r.bottom||event.clientX<r.left||event.clientX>r.right)closeModal();}});
sheet.addEventListener('submit',event=>{
 event.preventDefault();const form=event.target,fields=new FormData(form);
 try{
  if(form.id==='filter-form'){dateFilter=fields.get('date');closeModal();render();return;}
  const amount=parseAmount(fields.get('amount'));
  if(failNext){failNext=false;throw Error('保存失败，请重试。已保留你的输入。');}
  if(form.id==='payment-form'){
   const payer=Number(fields.get('payer')),receiver=Number(fields.get('receiver'));if(payer===receiver)throw Error('付款人与收款人不能相同。');const from=modal.from;
   data.payments.push({id:`s${++sequence+1}`,payer,receiver,amount,date:today});render();if(from==='personal')openModal({type:'personal'});else closeModal();toast('已记录 '+money(amount));
  }else{
   const title=String(fields.get('title')).trim();if(!title)throw Error('请填写用途。');data.bills.push({id:`e${data.bills.length+1}`,title,amount,payer:Number(fields.get('payer')),date:fields.get('date'),shares:equalShares(amount),category:'餐饮',note:''});closeModal();render();toast('账单已保存');
  }
 }catch(error){sheet.querySelector('#form-error').textContent=error.message;}
});
/** 软键盘改变可用高度时只缩小当前面板；底部确认按钮不进入滚动区域。 */
function syncViewport(){if(!sheet.open)return;const v=window.visualViewport,height=v?.height||innerHeight,offset=v?.offsetTop||0;sheet.style.setProperty('--available-height',height+'px');sheet.style.setProperty('--sheet-bottom',Math.max(0,innerHeight-height-offset)+'px');}
window.visualViewport?.addEventListener('resize',syncViewport);window.visualViewport?.addEventListener('scroll',syncViewport);
sheet.addEventListener('focusin',event=>{if(event.target.matches('input,select'))requestAnimationFrame(()=>{const body=sheet.querySelector('.sheet-body'),r=event.target.getBoundingClientRect(),b=body.getBoundingClientRect();if(r.bottom>b.bottom){markScroll('restore');body.scrollTop+=r.bottom-b.bottom+12;}});});
// 仅供独立原型的浏览器验收读取，不属于正式产品的公共接口。
window.review={reset,resetMetrics,markScroll,failNext:()=>{failNext=true;},get state(){return structuredClone({data,me,view,scope,query,dateFilter,balances:balances(data),recommendations:recommendations(data)});},get metrics(){return structuredClone({...metrics,elapsedMs:performance.now()-metrics.started});},settleAll:()=>{for(const r of recommendations(data))data.payments.push({...r,id:`s${++sequence+1}`,date:today});render();}};
reset();
