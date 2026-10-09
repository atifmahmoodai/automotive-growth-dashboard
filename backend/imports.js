import {randomUUID} from 'node:crypto';
import {validate,fail} from './contracts.js';
import {digest} from './security.js';
export const audit=(db,user,action,reference)=>db.query('INSERT INTO activity(user_id,action,reference) VALUES($1,$2,$3)',[user,action,reference]);
export async function stage(tx,input,user,config){
 const payload=validate(input,config),id=randomUUID();
 const version=(await tx.query('SELECT version FROM source_versions WHERE provider=$1 FOR SHARE',[payload.provider])).rows[0].version;
 await tx.query('INSERT INTO batches(id,provider,start_day,end_day,payload,digest,base_version,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,payload.provider,payload.start,payload.end,JSON.stringify(payload),digest(JSON.stringify(payload)),version,user]);
 await audit(tx,user,'snapshot_review_created',id);return {id,provider:payload.provider,records:payload.records.length};
}
export async function apply(db,id,user){
 return db.transaction(async tx=>{
  const b=(await tx.query('SELECT * FROM batches WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!b)fail('Review not found',404);
  if(b.status==='applied')return {ok:true,alreadyApplied:true};if(b.status!=='review')fail('Review is no longer pending',409);
  const v=(await tx.query('SELECT version FROM source_versions WHERE provider=$1 FOR UPDATE',[b.provider])).rows[0].version;
  if(v!==b.base_version)fail('A newer source was accepted. Import a fresh snapshot before applying.',409);
  if(Date.now()-Date.parse(b.created_at)>1800000)fail('Review expired after 30 minutes. Import again.',409);
  const prior=(await tx.query('SELECT payload FROM snapshots WHERE provider=$1 AND start_day=$2 AND end_day=$3',[b.provider,b.start_day,b.end_day])).rows[0];
  if(prior&&prior.payload.observedAt>b.payload.observedAt)fail('This snapshot is older than the accepted data',409);
  await tx.query('INSERT INTO snapshots(provider,start_day,end_day,batch_id,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(provider,start_day,end_day) DO UPDATE SET batch_id=EXCLUDED.batch_id,payload=EXCLUDED.payload,updated_at=now()',[b.provider,b.start_day,b.end_day,id,JSON.stringify(b.payload)]);
  await tx.query('UPDATE source_versions SET version=version+1 WHERE provider=$1',[b.provider]);
  await tx.query("UPDATE batches SET status='applied',applied_at=now() WHERE id=$1",[id]);await audit(tx,user,'snapshot_accepted',id);return {ok:true};
 });
}
