/* Reads validated TGJU live data when configured, otherwise the public snapshot. */
(()=>{'use strict';
const DATA_URL='./data/market-rates.json',STALE_AFTER=15*60*1000;
// Leave empty until worker/market-api.js has actually been deployed.
const LIVE_API_URL='';
const ITEMS=[
 {key:'usd',id:'priceUsd',timeId:'timeUsd',unit:'تومان',irr:true,min:10000,max:100000000},
 {key:'eur',id:'priceEur',timeId:'timeEur',unit:'تومان',irr:true,min:10000,max:100000000},
 {key:'gold',id:'priceGold',timeId:'timeGold',unit:'تومان / گرم',irr:true,min:1000000,max:10000000000},
 {key:'oil',id:'priceOil',timeId:'timeOil',unit:'دلار / بشکه',irr:false,min:10,max:300}
];
const el=id=>document.getElementById(id);
const fmt=n=>new Intl.NumberFormat('fa-IR',{maximumFractionDigits:2}).format(n);
const loadingTimers=new WeakMap();
const lastPrices=new Map();
let activeFetch=null;

function pxStart(card){
 if(!card)return;
 const num=card.querySelector('.px-num');
 if(!num)return;
 clearInterval(loadingTimers.get(card));
 // Keep a known quote visible during background refreshes; animate digits only on first load.
 if(num.dataset.initialized==='true'){card.classList.remove('is-loading');return}
 card.classList.add('is-loading');
 loadingTimers.set(card,setInterval(()=>{
  let s='';
  for(let i=0;i<6;i++){if(i===3)s+='٬';s+='۰۱۲۳۴۵۶۷۸۹'[Math.floor(Math.random()*10)]}
  num.textContent=s;
 },85));
}
function pxFinish(card){
 if(!card)return;
 const num=card.querySelector('.px-num');
 if(num)num.dataset.initialized='true';
 clearInterval(loadingTimers.get(card));
 loadingTimers.delete(card);
 card.classList.remove('is-loading');
 card.classList.add('px-done');
 setTimeout(()=>card.classList.remove('px-done'),500);
}
function startMarketLoading(){for(const item of ITEMS)pxStart(el('px-'+item.key))}
function dateLabel(value){
 if(!value)return '';
 const d=new Date(value);
 if(!Number.isFinite(d.getTime()))return '';
 return new Intl.DateTimeFormat('fa-IR',{timeZone:'Asia/Tehran',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(d);
}
function validRow(item,row){
 if(!row||row.price===null||row.price===undefined||row.price==='')return false;
 const n=Number(row.price);
 return Number.isFinite(n)&&n>=item.min&&n<=item.max;
}
async function requestJson(url){
 const response=await fetch(url,{cache:'no-store',headers:{Accept:'application/json'}});
 if(!response.ok)throw new Error('HTTP '+response.status);
 const data=await response.json();
 if(!data||typeof data!=='object'||!data.items||typeof data.items!=='object')throw new Error('ساختار JSON قیمت‌ها معتبر نیست');
 return data;
}
async function loadData(){
 let liveData=null,snapshotData=null;
 if(LIVE_API_URL){
  try{liveData=await requestJson(LIVE_API_URL)}
  catch(error){console.warn('Live market endpoint failed; trying the published snapshot.',error)}
 }
 const completeLive=liveData&&ITEMS.every(item=>validRow(item,liveData.items[item.key]));
 if(!completeLive){
  try{snapshotData=await requestJson(DATA_URL+'?refresh='+Date.now())}
  catch(error){
   if(liveData&&ITEMS.some(item=>validRow(item,liveData.items[item.key])))return {data:liveData,mode:'live',snapshotError:String(error)};
   throw error;
  }
 }
 if(!liveData)return {data:snapshotData,mode:'snapshot'};
 if(!snapshotData)return {data:liveData,mode:'live'};
 // A partial live response must not blank markets that still have a valid snapshot.
 const mergedItems={...(snapshotData.items||{})};
 for(const item of ITEMS)if(validRow(item,liveData.items[item.key]))mergedItems[item.key]=liveData.items[item.key];
 return {
  data:{...snapshotData,...liveData,items:mergedItems,failedItems:{...(snapshotData.failedItems||{}),...(liveData.failedItems||{})}},
  mode:ITEMS.every(item=>validRow(item,liveData.items[item.key]))?'live':'mixed'
 };
}
function render(item,row){
 const priceEl=el(item.id),timeEl=el(item.timeId),card=el('px-'+item.key);
 if(!priceEl||!timeEl)return false;
 const num=priceEl.querySelector('.px-num')||priceEl;
 if(!validRow(item,row)){
  num.textContent='—';
  lastPrices.delete(item.key);
  if(priceEl.nextElementSibling)priceEl.nextElementSibling.textContent=item.unit;
  timeEl.textContent='قیمت معتبر در دسترس نیست';
  timeEl.dataset.stale='true';
  timeEl.title=(row&&row.lastError)||'داده معتبر از TGJU دریافت نشد';
  pxFinish(card);
  return false;
 }
 const raw=Number(row.price),price=item.irr?raw/10:raw;
 const shown=fmt(price);
 num.textContent=shown;
 lastPrices.set(item.key,shown);
 if(priceEl.nextElementSibling)priceEl.nextElementSibling.textContent=item.unit;
 const fetched=row.fetchedAt?new Date(row.fetchedAt):null;
 const age=fetched&&Number.isFinite(fetched.getTime())?Date.now()-fetched.getTime():Infinity;
 const stale=Boolean(row.stale)||age<0||age>STALE_AFTER;
 const received=dateLabel(row.fetchedAt);
 timeEl.textContent=(received?'دریافت '+received:'زمان دریافت نامشخص')+(stale?' · قدیمی':'');
 timeEl.dataset.stale=String(stale);
 timeEl.title=(row.sourceUrl?'منبع: '+row.sourceUrl:'منبع: TGJU')+
  (received?' · زمان دریافت: '+received:'')+
  (row.sourceDate?' · تاریخ/زمان ثبت‌شده در منبع: '+row.sourceDate:'')+
  (row.lastError?' · خطای آخر: '+row.lastError:'');
 pxFinish(card);
 return true;
}
function setNetworkFailure(error){
 for(const item of ITEMS){
  const priceEl=el(item.id),timeEl=el(item.timeId),num=priceEl&&(priceEl.querySelector('.px-num')||priceEl);
  if(num&&!lastPrices.has(item.key))num.textContent='—';
  else if(num&&lastPrices.has(item.key))num.textContent=lastPrices.get(item.key);
  if(timeEl){timeEl.dataset.stale='true';timeEl.textContent=lastPrices.has(item.key)?'به‌روزرسانی ناموفق · مقدار قبلی':'دریافت ناموفق';timeEl.title=String(error||'خطای شبکه')}
  pxFinish(el('px-'+item.key));
 }
 const status=el('marketStatus');
 if(status)status.textContent='دریافت داده جدید ناموفق بود؛ آخرین قیمت معتبر حفظ شده است. اتصال اینترنت را بررسی کنید.';
}
async function refreshMarketData(){
 startMarketLoading();
 try{
  const result=await loadData(),data=result.data;
  const items=data.items||{};
  let valid=0,stale=0;
  for(const item of ITEMS){
   if(render(item,items[item.key])){
    valid++;
    if(el(item.timeId).dataset.stale==='true')stale++;
   }
  }
  const failedItems=data.failedItems&&typeof data.failedItems==='object'?data.failedItems:{};
  const failedCount=Object.keys(failedItems).length;
  const checked=dateLabel(data.checkedAt),attempt=dateLabel(data.lastAttemptAt);
  const sourceDate=(items.usd&&items.usd.sourceDate)||(items.gold&&items.gold.sourceDate);
  const status=el('marketStatus');
  if(status){
   let label=result.mode==='live'?'دریافت مستقیم از TGJU':result.mode==='mixed'?'دریافت ترکیبی از TGJU و snapshot':'آخرین snapshot منتشرشده از TGJU';
   if(valid===0)label='قیمت معتبر دریافت نشد؛ زمان آخرین دریافت موفق را بررسی کنید.';
   if(checked)label+=' · آخرین دریافت موفق: '+checked;
   if(attempt&&data.lastAttemptAt!==data.checkedAt&&failedCount)label+=' · آخرین تلاش: '+attempt;
   if(sourceDate)label+=' · تاریخ ثبت در منبع: '+sourceDate;
   if(failedCount)label+=' · خطا در '+failedCount+' بازار';
   if(stale)label+=' · '+stale+' قیمت قدیمی';
   if(result.snapshotError)label+=' · snapshot در دسترس نیست';
   status.textContent=label;
  }
  return {valid,stale,errors:failedCount,checkedAt:data.checkedAt,mode:result.mode};
 }catch(error){
  console.error('Market data refresh failed:',error);
  setNetworkFailure(error);
  return {valid:lastPrices.size,stale:lastPrices.size,errors:ITEMS.length,error:String(error)};
 }
}
async function fetchMarketCurrencies(){
 if(activeFetch)return activeFetch;
 activeFetch=refreshMarketData();
 try{return await activeFetch}finally{activeFetch=null}
}
window.fetchMarketCurrencies=fetchMarketCurrencies;
// This reads the latest published JSON; the GitHub Action performs the actual scheduled scraping.
setInterval(()=>{void fetchMarketCurrencies()},30*1000);
})();