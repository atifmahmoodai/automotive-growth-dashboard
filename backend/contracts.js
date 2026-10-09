export const providers=['ghl','tintwiz','qbo','hyros'];
export const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export function text(v,max=150){if(typeof v!=='string'||!v.trim()||v.length>max||/[\x00-\x1f]/.test(v))fail('Invalid text field');return v.trim();}
export function day(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)fail('Use valid YYYY-MM-DD dates');return v;}
export function windowOf(start,end){day(start);day(end);if(end<start||(Date.parse(end)-Date.parse(start))/86400000>92)fail('Choose a reporting window of 1–93 days');return {start,end};}
export function integer(v,min=0,max=1e12){if(!Number.isSafeInteger(v)||v<min||v>max)fail('Invalid integer value');return v;}
export function stamp(v,nullable=false){if(nullable&&v===null)return null;if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)||!Number.isFinite(Date.parse(v)))fail('Use ISO timestamps with an explicit timezone');day(v.slice(0,10));return new Date(v).toISOString();}
export const businessDay=(v,tz)=>new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
export function exact(obj,keys){if(!obj||typeof obj!=='object'||Array.isArray(obj)||Object.keys(obj).sort().join('|')!==[...keys].sort().join('|'))fail('Fields must match the documented contract exactly');}
export function cents(v){const s=String(v);if(!/^-?\d{1,10}(\.\d{1,2})?$/.test(s))fail('Provider amount must be an exact decimal with at most two places');const [a,b='']=s.replace('-','').split('.');return integer((Number(a)*100+Number(b.padEnd(2,'0')))*(s.startsWith('-')?-1:1),-1e12,1e12);}
export function validate(input,{currency='USD',timezone='UTC'}={}){
 exact(input,['provider','start','end','currency','timezone','observedAt','records']);
 const {provider,start,end,records}=input;windowOf(start,end);
 if(!providers.includes(provider)||input.currency!==currency||input.timezone!==timezone)fail('Provider, currency or business timezone does not match this installation');
 const observedAt=stamp(input.observedAt);if(Date.parse(observedAt)>Date.now()+300000||Date.parse(observedAt)<Date.now()-86400000*7)fail('Snapshot observation must be within the past 7 days');
 if(!Array.isArray(records)||records.length>5000)fail('Use at most 5,000 records per snapshot');
 const ids=new Set();const normalized=records.map(r=>{
  if(provider==='ghl'){
   exact(r,['id','staffKey','createdAt','firstContactAt','nextFollowupAt','status','stage']);
   const id=text(r.id),createdAt=stamp(r.createdAt),firstContactAt=stamp(r.firstContactAt,true),nextFollowupAt=stamp(r.nextFollowupAt,true);
   if(!['open','won','lost','abandoned'].includes(r.status))fail('Invalid opportunity status');
   if(firstContactAt&&firstContactAt<createdAt)fail('First contact cannot precede lead creation');
   if(businessDay(createdAt,timezone)<start||businessDay(createdAt,timezone)>end)fail('Lead cohort falls outside the requested window');
   return {id,staffKey:r.staffKey===null?null:text(r.staffKey),createdAt,firstContactAt,nextFollowupAt,status:r.status,stage:text(r.stage)};
  }
  if(provider==='tintwiz'){
   if(r.kind==='capacity'){
    exact(r,['kind','id','day','bay','minutes']);day(r.day);if(r.day<start||r.day>end)fail('Capacity date is outside the window');
    return {kind:r.kind,id:text(r.id),day:r.day,bay:text(r.bay),minutes:integer(r.minutes,0,1440)};
   }
   exact(r,['kind','id','day','staffKey','service','amountCents','refundCents','bay','bayMinutes']);
   if(r.kind!=='job'||!['Tint','Ceramic','PPF','Wrap','Other'].includes(r.service))fail('Invalid completed-job record');day(r.day);if(r.day<start||r.day>end)fail('Completed-job date is outside the window');
   return {kind:'job',id:text(r.id),day:r.day,staffKey:r.staffKey===null?null:text(r.staffKey),service:r.service,amountCents:integer(r.amountCents),refundCents:integer(r.refundCents,0,r.amountCents),bay:r.bay===null?null:text(r.bay),bayMinutes:integer(r.bayMinutes,0,1440)};
  }
  if(provider==='hyros'){
   exact(r,['id','channel','campaign','spendCents','revenueCents','leads','model']);if(r.model!=='last_click')fail('Only the agreed last-click attribution model is supported');
   return {id:text(r.id),channel:text(r.channel),campaign:text(r.campaign),spendCents:integer(r.spendCents),revenueCents:integer(r.revenueCents,-1e12),leads:r.leads===null?null:integer(r.leads,0,1e7),model:r.model};
  }
  exact(r,['id','basis','incomeCents','cogsCents','expensesCents','netCents']);if(r.id!=='profit-and-loss'||!['Cash','Accrual'].includes(r.basis))fail('Invalid P&L summary');
  return {id:r.id,basis:r.basis,incomeCents:integer(r.incomeCents,-1e12),cogsCents:integer(r.cogsCents,-1e12),expensesCents:integer(r.expensesCents,-1e12),netCents:integer(r.netCents,-1e12)};
 });
 for(const r of normalized){if(ids.has(r.id))fail('Duplicate record ID in snapshot');ids.add(r.id);}
 if(provider==='qbo'&&normalized.length!==1)fail('A finance snapshot needs exactly one explicit P&L summary');
 if(provider==='tintwiz'){
  const capacity=new Set();for(const r of normalized.filter(x=>x.kind==='capacity')){const key=r.day+'|'+r.bay;if(capacity.has(key))fail('Duplicate bay/day capacity');capacity.add(key);}
 }
 return {provider,start,end,currency,timezone,observedAt,records:normalized};
}
