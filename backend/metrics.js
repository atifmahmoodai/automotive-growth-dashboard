const sum=(xs,fn)=>xs.reduce((n,x)=>n+fn(x),0);
const ratio=(a,b)=>b?Math.round(a/b*10000)/10000:null;
const median=values=>{if(!values.length)return null;values.sort((a,b)=>a-b);const n=values.length;return n%2?values[(n-1)/2]:(values[n/2-1]+values[n/2])/2;};
export function dashboard({snapshots,users,target,user,now=new Date()}){
 const team=user.role==='team',known=Object.fromEntries(snapshots.map(s=>[s.provider,s]));
 const records=p=>known[p]?.payload.records??null;
 const allLeads=records('ghl'),allJobs=records('tintwiz');
 const leads=allLeads?.filter(x=>!team||(user.ghl_key&&x.staffKey===user.ghl_key));
 const jobs=allJobs?.filter(x=>x.kind==='job'&&(!team||(user.tw_key&&x.staffKey===user.tw_key)));
 const calculate=(ls,js)=>{
  const responses=(ls??[]).filter(x=>x.firstContactAt).map(x=>(Date.parse(x.firstContactAt)-Date.parse(x.createdAt))/60000);
  const won=ls?.filter(x=>x.status==='won').length??null,lost=ls?.filter(x=>x.status==='lost').length??null;
  return {leads:ls?.length??null,won,lost,closeRate:ls?ratio(won,won+lost):null,responseMinutes:median(responses),responseCoverage:ls?ratio(responses.length,ls.length):null,
   overdue:ls?.filter(x=>x.status==='open'&&x.nextFollowupAt&&Date.parse(x.nextFollowupAt)<+now).length??null,
   followupCoverage:ls?ratio(ls.filter(x=>x.status==='open'&&x.nextFollowupAt!==null).length,ls.filter(x=>x.status==='open').length):null,
   jobs:js?.length??null,revenueCents:js?sum(js,x=>x.amountCents-x.refundCents):null};
 };
 const ops=calculate(leads,jobs);
 if(leads)ops.followupCoverage=ratio(leads.filter(x=>x.status==='open'&&x.nextFollowupAt!==null).length,leads.filter(x=>x.status==='open').length);
 const services=jobs?['Tint','Ceramic','PPF','Wrap','Other'].map(name=>({name,jobs:jobs.filter(x=>x.service===name).length,revenueCents:sum(jobs.filter(x=>x.service===name),x=>x.amountCents-x.refundCents)})):null;
 const trend=jobs?[...new Set(jobs.map(x=>x.day))].sort().map(day=>({day,revenueCents:sum(jobs.filter(x=>x.day===day),x=>x.amountCents-x.refundCents)})):null;
 const alerts=[];
 if(!team){
  for(const p of ['ghl','tintwiz','hyros',...(user.role==='owner'?['qbo']:[])]){if(!known[p])alerts.push({id:'missing-'+p,tone:'warning',text:p.toUpperCase()+': no accepted snapshot for this exact date window.'});else if(+now-Date.parse(known[p].payload.observedAt)>86400000)alerts.push({id:'stale-'+p,tone:'warning',text:p.toUpperCase()+': data is older than 24 hours.'});}
  if(target){if(ops.revenueCents!==null&&ops.revenueCents<Number(target.revenue_cents))alerts.push({id:'revenue',tone:'warning',text:'Operational revenue is below the selected period target.'});if(ops.responseMinutes!==null&&ops.responseMinutes>target.response_minutes)alerts.push({id:'response',tone:'danger',text:'Median speed-to-lead exceeds the response target.'});if(ops.closeRate!==null&&ops.closeRate*100<target.close_percent)alerts.push({id:'close',tone:'warning',text:'Decided-lead close rate is below target.'});}
 }
 if(ops.overdue>0)alerts.push({id:'followup',tone:'danger',text:`${ops.overdue} open leads have overdue follow-ups in this cohort.`});
 const result={ops,services,trend,alerts,scope:team?'Your assigned work':'Business overview',followups:leads?.filter(x=>x.status==='open').map(x=>({id:x.id,stage:x.stage,nextFollowupAt:x.nextFollowupAt,firstContactAt:x.firstContactAt})).slice(0,100)??[],sources:team?[]:Object.values(known).filter(x=>user.role==='owner'||x.provider!=='qbo').map(x=>({provider:x.provider,observedAt:x.payload.observedAt,acceptedAt:x.updated_at,records:x.payload.records.length}))};
 result.pipeline=leads?[...new Set(leads.map(x=>x.stage))].map(stage=>({stage,total:leads.filter(x=>x.stage===stage).length,open:leads.filter(x=>x.stage===stage&&x.status==='open').length,won:leads.filter(x=>x.stage===stage&&x.status==='won').length,lost:leads.filter(x=>x.stage===stage&&x.status==='lost').length,abandoned:leads.filter(x=>x.stage===stage&&x.status==='abandoned').length})):null;
 if(team){delete result.ops.revenueCents;result.services=result.services?.map(({name,jobs})=>({name,jobs}));result.trend=null;return result;}
 result.target=target??null;result.progress=target&&ops.revenueCents!==null?ratio(ops.revenueCents,Number(target.revenue_cents)):null;
 result.team=users.filter(u=>u.active).map(u=>({id:u.id,name:u.name,...calculate(allLeads?.filter(x=>u.ghl_key&&x.staffKey===u.ghl_key),allJobs?.filter(x=>x.kind==='job'&&u.tw_key&&x.staffKey===u.tw_key))}));
 result.unassigned={leads:allLeads?.filter(x=>!users.some(u=>u.ghl_key&&u.ghl_key===x.staffKey)).length??null,jobs:allJobs?.filter(x=>x.kind==='job'&&!users.some(u=>u.tw_key&&u.tw_key===x.staffKey)).length??null};
 const capacities=allJobs?.filter(x=>x.kind==='capacity')??[],used=allJobs?.filter(x=>x.kind==='job'&&x.bay!==null)??[];
 const uncovered=used.some(j=>!capacities.some(c=>c.day===j.day&&c.bay===j.bay))||(allJobs??[]).some(j=>j.kind==='job'&&j.bay===null&&j.bayMinutes>0);
 result.bays=capacities.length&&!uncovered?{bookedMinutes:sum(used,x=>x.bayMinutes),availableMinutes:sum(capacities,x=>x.minutes),utilization:ratio(sum(used,x=>x.bayMinutes),sum(capacities,x=>x.minutes))}:null;
 if(result.bays?.utilization>1)alerts.push({id:'bay',tone:'danger',text:'Scheduled bay minutes exceed supplied availability. Check overlapping bookings.'});
 const ads=records('hyros');result.ads=ads?{spendCents:sum(ads,x=>x.spendCents),revenueCents:sum(ads,x=>x.revenueCents),leads:ads.some(x=>x.leads===null)?null:sum(ads,x=>x.leads),campaigns:ads}:null;
 if(result.ads){result.ads.roas=ratio(result.ads.revenueCents,result.ads.spendCents);result.ads.cplCents=ratio(result.ads.spendCents,result.ads.leads);if(target&&result.ads.roas!==null&&result.ads.roas<Number(target.minimum_roas))alerts.push({id:'roas',tone:'warning',text:'Attributed return on ad spend is below target.'});}
 if(user.role==='owner'){const f=records('qbo')?.[0];result.finance=f?{...f,netMargin:ratio(f.netCents,f.incomeCents)}:null;}
 return result;
}
