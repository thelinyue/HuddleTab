/** 原型账目模型只服务本地演示：金额以分保存，从消费分摊与实际付款推导余额。
 * 不导出到正式产品；正式推荐仍应由 Rust 服务计算。这里的简化算法用于使交互反馈自洽。
 */
export const members = ['小林','小王','小李','小陈','小赵','小刘'].map((name,id)=>({id,name}));
export const today='2026-09-24';
export const money=n=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY',maximumFractionDigits:n%100?2:0}).format(n/100);
export function seed(){
 const titles=['早餐','打车','门票','午餐','下午茶','晚餐'];
 const bills=Array.from({length:24},(_,i)=>({id:`e${i+1}`,title:i===23?'古城晚餐':titles[i%6],amount:12000,payer:i%6,date:`2026-09-${20+Math.floor(i/6)}`,category:i%6===1?'交通':'餐饮',shares:Object.fromEntries([6000,3000,1500,1500].map((n,j)=>[(i+j)%6,n])),note:i===23?'靠窗的六人桌，含饮料':'旅行共同支出'}));
 // 前24笔循环分摊，六人净额恰好为零；下列真实消费与既有付款构成各成员待结余额。
 bills.push(...[
  ['客房升级',70000,1,0],['体验课程',18000,2,0],['接送机',32000,1,3],['温泉套票',45000,5,4],['个人纪念品',6000,0,0],['个人门票',8000,2,2],
 ].map(([title,amount,payer,participant],i)=>({id:`e${25+i}`,title,amount,payer,date:today,category:'其他',shares:{[participant]:amount},note:'按实际参与人分摊'})));
 return {bills,payments:[{id:'s1',payer:0,receiver:1,amount:20000,date:'2026-09-23'}]};
}
export function balances(data){const sums=members.map(()=>0);for(const b of data.bills){sums[b.payer]+=b.amount;for(const [id,n] of Object.entries(b.shares))sums[Number(id)]-=n;}for(const p of data.payments){sums[p.payer]+=p.amount;sums[p.receiver]-=p.amount;}return sums;}
export function recommendations(data){
 const sums=balances(data),debtors=sums.map((n,id)=>({id,n:-n})).filter(x=>x.n>0),creditors=sums.map((n,id)=>({id,n})).filter(x=>x.n>0),rows=[];
 debtors.sort((a,b)=>b.n-a.n||a.id-b.id);creditors.sort((a,b)=>b.n-a.n||a.id-b.id);
 for(const d of debtors)for(const c of creditors){const n=Math.min(d.n,c.n);if(n>0){rows.push({payer:d.id,receiver:c.id,amount:n});d.n-=n;c.n-=n;}}
 return rows;
}
export function equalShares(amount){const q=Math.floor(amount/6),r=amount%6;return Object.fromEntries(members.map(m=>[m.id,q+(m.id<r?1:0)]));}
export function parseAmount(raw){if(!/^\d+(\.\d{1,2})?$/.test(raw))throw Error('请输入最多两位小数的金额。');const [a,b='']=raw.split('.');const n=Number(a)*100+Number(b.padEnd(2,'0'));if(!Number.isSafeInteger(n)||n<=0)throw Error('金额必须大于零且在有效范围内。');return n;}
