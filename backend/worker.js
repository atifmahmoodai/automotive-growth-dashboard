import {database} from './db.js';
import {config} from './config.js';
import {stage,audit} from './imports.js';
import {readSnapshot} from './providers.js';
import {access} from './oauth.js';
export async function runOne(db,settings,fetcher){
 const job=await db.transaction(async tx=>{
  // Direct reads have a bounded duration (< 14 minutes at the 5,000-record cap).
  await tx.query("UPDATE sync_jobs SET status='failed',message='Worker interrupted. Reconnect QuickBooks if refreshing, then retry.',finished_at=now() WHERE status='running' AND started_at<now()-interval '20 minutes'");
  const r=(await tx.query("SELECT * FROM sync_jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];if(!r)return null;
  await tx.query("UPDATE sync_jobs SET status='running',started_at=now() WHERE id=$1",[r.id]);return r;
 });if(!job)return false;
 try{
  const current=(await db.query("SELECT id FROM users WHERE id=$1 AND active=true AND role='owner'",[job.user_id])).rows[0];if(!current)throw Object.assign(new Error('The requesting owner is no longer active'),{status:403});
  const auth=job.provider==='qbo'?await access(db,settings,fetcher):{};
  const payload=await readSnapshot({provider:job.provider,start:job.start_day,end:job.end_day,config:settings,fetcher,...auth});
  await db.transaction(async tx=>{const lock=(await tx.query('SELECT status FROM sync_jobs WHERE id=$1 FOR UPDATE',[job.id])).rows[0];if(lock.status!=='running')return;const b=await stage(tx,payload,job.user_id,settings);await tx.query("UPDATE sync_jobs SET status='succeeded',message=$2,finished_at=now() WHERE id=$1",[job.id,'Review ready: '+b.id]);});
 }catch(e){await db.transaction(async tx=>{await tx.query("UPDATE sync_jobs SET status='failed',message=$2,finished_at=now() WHERE id=$1 AND status='running'",[job.id,e.status?e.message:'Provider sync failed. Check configuration and retry.']);await audit(tx,job.user_id,'sync_failed',job.id);});}
 return true;
}
if(import.meta.url===new URL(process.argv[1],'file:').href){const db=await database(),settings=config();let stop=false;for(const s of ['SIGTERM','SIGINT'])process.on(s,()=>{stop=true;});do{const worked=await runOne(db,settings);if(process.argv.includes('--once'))break;if(!worked)await new Promise(r=>setTimeout(r,3000));}while(!stop);await db.close();}
