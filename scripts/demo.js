import {randomUUID} from 'node:crypto';
import {database,migrate} from '../backend/db.js';
import {hashPassword} from '../backend/security.js';
import {stage,apply} from '../backend/imports.js';
import {config} from '../backend/config.js';
import {businessDay} from '../backend/contracts.js';
export function demoSnapshots(settings){
 const today=businessDay(new Date(),settings.timezone),start=today.slice(0,8)+'01',days=Number(today.slice(-2));
 const base={start,end:today,currency:settings.currency,timezone:settings.timezone,observedAt:new Date().toISOString()};
 const jobs=[],leads=[];const day=i=>start.slice(0,8)+String(i).padStart(2,'0');
 for(let i=1;i<=days;i++){
  for(let b=1;b<=2;b++)jobs.push({kind:'capacity',id:`capacity-${i}-${b}`,day:day(i),bay:'Bay '+b,minutes:480});
  for(let j=0;j<5;j++)jobs.push({kind:'job',id:`job-${i}-${j}`,day:day(i),staffKey:j%2?'tw-jamie':'tw-sam',service:['Tint','Ceramic','PPF','Wrap','Tint'][j],amountCents:[42000,98000,165000,235000,46000][j]+i*500,refundCents:i===2&&j===0?5000:0,bay:'Bay '+(j%2+1),bayMinutes:[90,120,180,180,90][j]});
  for(let j=0;j<9;j++){const createdAt=day(i)+'T12:00:00Z';const status=j<3?'won':j===3?'lost':'open';leads.push({id:`lead-${i}-${j}`,staffKey:j%2?'ghl-jamie':'ghl-sam',createdAt,firstContactAt:j===8?null:day(i)+`T12:${String([4,7,12,18,22,25,35,40][j]).padStart(2,'0')}:00Z`,nextFollowupAt:status==='open'&&j!==8?day(i)+'T16:00:00Z':null,status,stage:status==='open'?'Consultation scheduled':status==='won'?'Booked':'Closed'});}
 }
 return [{...base,provider:'ghl',records:leads},{...base,provider:'tintwiz',records:jobs},{...base,provider:'hyros',records:[{id:'meta-ppf',channel:'Meta',campaign:'PPF · local discovery',spendCents:186000,revenueCents:1084000,leads:64,model:'last_click'},{id:'google-tint',channel:'Google',campaign:'Window tint · search',spendCents:124000,revenueCents:768000,leads:42,model:'last_click'}]},{...base,provider:'qbo',records:[{id:'profit-and-loss',basis:'Accrual',incomeCents:days*580000,cogsCents:days*146000,expensesCents:days*112000,netCents:days*322000}]}];
}
export async function seed(db,settings,password){
 if((await db.query('SELECT id FROM users LIMIT 1')).rows.length)throw new Error('Demo requires an empty database');if(settings.timezone!=='UTC')throw new Error('Fictional demo uses UTC only');
 const hash=await hashPassword(password),owner=randomUUID();for(const [id,name,role,key] of [[owner,'Alex Morgan','owner',null],[randomUUID(),'Sam Rivera','team','sam'],[randomUUID(),'Jamie Chen','manager','jamie']])await db.query('INSERT INTO users(id,email,name,password,role,ghl_key,tw_key) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,role+'@example.test',name,hash,role,key?'ghl-'+key:null,key?'tw-'+key:null]);
 const snapshots=demoSnapshots(settings);for(const p of snapshots){const b=await db.transaction(tx=>stage(tx,p,owner,settings));await apply(db,b.id,owner);}
 const p=snapshots[0];await db.query('INSERT INTO targets(start_day,end_day,revenue_cents,response_minutes,close_percent,minimum_roas,updated_by) VALUES($1,$2,$3,15,45,4,$4)',[p.start,p.end,Math.max(8000000,Number(p.end.slice(-2))*700000),owner]);return {owner,snapshots};
}
if(import.meta.url===new URL(process.argv[1],'file:').href){if(process.env.ALLOW_DEMO!=='true'||process.env.NODE_ENV==='production')throw new Error('Demo requires ALLOW_DEMO=true outside production');const db=await database();try{await migrate(db);await seed(db,config(),process.env.DEMO_PASSWORD);console.log('Fictional demo created. Accounts: owner, manager, team @example.test.');}finally{await db.close();}}
