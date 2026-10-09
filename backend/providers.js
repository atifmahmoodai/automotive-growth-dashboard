import {cents,integer,text,fail,businessDay,stamp,validate} from './contracts.js';
export async function requestJSON(url,options={},fetcher=fetch){
 let r;try{r=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});}catch{fail('Provider connection failed. Retry the read or reconnect QuickBooks if refreshing.',502);}
 if(!r.ok)fail(`Provider returned HTTP ${r.status}. Check credentials, permissions and rate limits.`,502);
 const reader=r.body?.getReader();let raw='';
 if(reader){let bytes=0;const chunks=[];for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>4*1024*1024){await reader.cancel();fail('Provider report is too large',502);}chunks.push(Buffer.from(value));}raw=Buffer.concat(chunks).toString('utf8');}else raw=await r.text();
 try{return JSON.parse(raw);}catch{fail('Provider returned invalid JSON',502);}
}
export function qboReport(report,{start,end,currency,basis}){
 const h=report.Header;
 if(h?.ReportName!=='ProfitAndLoss'||h.StartPeriod!==start||h.EndPeriod!==end||h.Currency!==currency||h.ReportBasis!==basis||h.SummarizeColumnsBy!=='Total')fail('QuickBooks report dates, currency, basis or column layout do not match',502);
 const cols=report.Columns?.Column;if(cols?.length!==2||cols[1].ColType!=='Money')fail('Expected one QuickBooks total column',502);
 const groups=new Map();function walk(rows){for(const r of rows??[]){if(r.group){if(groups.has(r.group))fail('Ambiguous QuickBooks report groups',502);groups.set(r.group,r);}if(r.Rows)walk(r.Rows.Row);}}walk(report.Rows?.Row);
 const empty=h.Option?.some(x=>x.Name==='NoReportData'&&x.Value==='true');
 const amount=key=>{const row=groups.get(key);if(!row){if(empty)return 0;fail(`QuickBooks report is missing the ${key} summary`,502);}const v=row.Summary?.ColData?.[1]?.value;if(v===undefined)fail('Missing QuickBooks summary amount',502);return v===''?0:cents(v);};
 const incomeCents=amount('Income'),gross=amount('GrossProfit');
 return [{id:'profit-and-loss',basis,incomeCents,cogsCents:incomeCents-gross,expensesCents:amount('Expenses'),netCents:amount('NetIncome')}];
}
export async function readGHL({start,end,config,fetcher}){
 const e=config.env;if(!e.GHL_TOKEN||!e.GHL_LOCATION_ID)fail('Configure the GoHighLevel private integration token and location first');
 const all=[],seen=new Set();let expected=null;
 for(let page=1;page<=50;page++){
  const u=new URL('https://services.leadconnectorhq.com/opportunities/search');u.search=new URLSearchParams({locationId:e.GHL_LOCATION_ID,page:String(page),limit:'100',status:'all'});
  const body=await requestJSON(u,{headers:{Authorization:'Bearer '+e.GHL_TOKEN,Version:'v3',Accept:'application/json'}},fetcher);
  if(!Array.isArray(body.opportunities)||!Number.isInteger(body.meta?.total)||body.meta.total<0||body.meta.total>5000)fail('GoHighLevel pagination could not be verified; use a complete normalized export',502);
  if(expected!==null&&expected!==body.meta.total)fail('GoHighLevel changed during pagination. Retry the snapshot.',502);expected=body.meta.total;
  for(const r of body.opportunities){if(!r.id||seen.has(r.id))fail('Duplicate GoHighLevel page data; retry',502);seen.add(r.id);all.push(r);}
  if(all.length===expected)break;if(all.length>expected||!body.opportunities.length||page===50)fail('GoHighLevel report is incomplete',502);
 }
 const custom=(r,key)=>{if(!key)return null;const f=r.customFields?.find(x=>x.id===key);return f?.fieldValue==null?null:stamp(f.fieldValue);};
 return all.filter(r=>{const d=businessDay(stamp(r.createdAt),config.timezone);return d>=start&&d<=end;}).map(r=>({id:r.id,staffKey:r.assignedTo??null,createdAt:r.createdAt,firstContactAt:custom(r,e.GHL_FIRST_CONTACT_FIELD),nextFollowupAt:custom(r,e.GHL_NEXT_FOLLOWUP_FIELD),status:r.status,stage:r.pipelineStageId}));
}
export function campaignConfig(env){
 let rows;try{rows=JSON.parse(env.HYROS_CAMPAIGNS||'[]');}catch{fail('HYROS_CAMPAIGNS must contain valid JSON');}
 const levels=['facebook_campaign','google_campaign','google_v2_campaign','linkedin_campaign'];
 if(!Array.isArray(rows)||!rows.length||rows.length>50)fail('Configure 1–50 nonoverlapping Hyros campaigns');
 const ids=new Set(),platforms=new Map();for(const r of rows){text(r.id);text(r.name);text(r.channel);if(!levels.includes(r.level)||ids.has(r.id))fail('Use unique campaign IDs and supported campaign levels');ids.add(r.id);const p=r.level.startsWith('google')?'google':r.level;if(platforms.has(p)&&platforms.get(p)!==r.level)fail('Do not mix Google integration generations');platforms.set(p,r.level);}return rows;
}
export async function readHyros({start,end,config,fetcher}){
 const e=config.env;if(!e.HYROS_API_KEY||e.HYROS_TIMEZONE_CONFIRMED!==config.timezone)fail('Configure Hyros credentials and confirm its account timezone');
 // A date-only end bound means end-of-day. Hyros refuses future bounds.
 if(end>=businessDay(new Date(),config.timezone))fail('Hyros direct reads require a completed day; select yesterday or earlier');
 const campaigns=campaignConfig(e),output=[];
 for(const level of [...new Set(campaigns.map(x=>x.level))]){
  const group=campaigns.filter(x=>x.level===level),url=new URL('https://api.hyros.com/v1/api/v1.0/attribution');
  url.search=new URLSearchParams({startDate:start,endDate:end,attributionModel:'last_click',level,ids:group.map(x=>x.id).join(','),fields:'cost,total_revenue,leads',currency:config.currency,sourceConfiguration:'ALL_SOURCES',excludeHardCosts:'false',timeGroupingOption:'source_link',pageSize:'250'});
  const r=await requestJSON(url,{headers:{'API-Key':e.HYROS_API_KEY,Accept:'application/json'}},fetcher);
  if(!Array.isArray(r.result)||r.nextPageId||r.result.length!==group.length)fail('Hyros did not return every configured campaign; review coverage in a normalized import',502);
  for(const c of group){const matches=r.result.filter(x=>String(x.id)===c.id);if(matches.length!==1)fail('Missing or duplicate Hyros campaign',502);const row=matches[0];output.push({id:c.id,channel:c.channel,campaign:c.name,spendCents:cents(row.cost),revenueCents:cents(row.total_revenue),leads:row.leads===null?null:integer(row.leads,0,1e7),model:'last_click'});}
 }
 return output;
}
export async function readSnapshot({provider,start,end,config,fetcher,accessToken,realm}){
 let records;
 if(provider==='ghl')records=await readGHL({start,end,config,fetcher});
 else if(provider==='hyros')records=await readHyros({start,end,config,fetcher});
 else if(provider==='qbo'){
  if(!/^\d+$/.test(realm??''))fail('Connect the configured QuickBooks company first');
  const basis=config.env.QBO_BASIS||'Accrual';if(!['Accrual','Cash'].includes(basis))fail('Invalid QuickBooks accounting basis');
  const host=config.env.QBO_SANDBOX==='true'?'sandbox-quickbooks.api.intuit.com':'quickbooks.api.intuit.com';
  const url=new URL(`https://${host}/v3/company/${realm}/reports/ProfitAndLoss`);url.search=new URLSearchParams({start_date:start,end_date:end,accounting_method:basis,summarize_column_by:'Total'});
  records=qboReport(await requestJSON(url,{headers:{Authorization:'Bearer '+accessToken,Accept:'application/json'}},fetcher),{start,end,currency:config.currency,basis});
 }else fail('TintWiz uses the signed import bridge');
 return validate({provider,start,end,currency:config.currency,timezone:config.timezone,observedAt:new Date().toISOString(),records},config);
}
