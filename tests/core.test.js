import test from 'node:test';import assert from 'node:assert/strict';
import {fixture,login,base,lead,job} from './helpers.js';
import {validate,cents,windowOf} from '../backend/contracts.js';
import {dashboard} from '../backend/metrics.js';
import {stage,apply} from '../backend/imports.js';
import {createHmac} from 'node:crypto';import request from 'supertest';
const snapshot=p=>({provider:p.provider,payload:p,updated_at:new Date().toISOString()});
test('strict snapshot contracts reject duplicate IDs, currency, dates and unsafe amounts',()=>{
 assert.throws(()=>validate(base('ghl',[lead(),lead()])));assert.throws(()=>validate({...base('ghl'),currency:'EUR'}));assert.throws(()=>windowOf('2026-02-30','2026-03-01'));assert.throws(()=>windowOf('2026-01-01','2026-05-01'));assert.throws(()=>validate(base('tintwiz',[{...job(),refundCents:100001}])));assert.throws(()=>validate(base('ghl',[{...lead(),firstContactAt:'2026-01-01T00:00:00Z'}])));assert.throws(()=>validate({...base('ghl'),observedAt:'2020-01-01T00:00:00Z'}));assert.equal(cents('-1.05'),-105);assert.throws(()=>cents('1.005'));assert.throws(()=>validate(base('qbo')));
});
test('metrics distinguish missing, explicit zero, denominator absence and incomplete bay coverage',()=>{
 const user={role:'owner'},empty=dashboard({snapshots:[],users:[],user});assert.equal(empty.ops.leads,null);assert.equal(empty.finance,null);assert.equal(empty.ads,null);
 const zero=dashboard({snapshots:[snapshot(base('ghl')),snapshot(base('tintwiz')),snapshot(base('hyros'))],users:[],user});assert.equal(zero.ops.leads,0);assert.equal(zero.ops.revenueCents,0);assert.equal(zero.ops.closeRate,null);assert.equal(zero.ads.roas,null);
 const jobs=[job(),{kind:'capacity',id:'c',day:'2026-01-02',bay:'Bay 1',minutes:480}];const d=dashboard({snapshots:[snapshot(base('tintwiz',jobs)),snapshot(base('ghl',[lead(),{...lead('two'),status:'won'}]))],users:[{id:'1',name:'Team',active:true,ghl_key:'ghl-team',tw_key:'tw-team'}],user});assert.equal(d.ops.revenueCents,95000);assert.equal(d.bays.utilization,.25);assert.equal(d.ops.followupCoverage,1);assert.equal(d.team[0].followupCoverage,1);assert.equal(d.ops.closeRate,1);
 jobs[0].bay=null;assert.equal(dashboard({snapshots:[snapshot(base('tintwiz',jobs))],users:[],user}).bays,null);
});
test('server-side role filtering strips every financial field and other staff from team results',()=>{
 const users=[{id:'t',name:'T',ghl_key:'ghl-team',tw_key:'tw-team',active:true}],snapshots=[snapshot(base('ghl',[lead(),lead('other','other')])),snapshot(base('tintwiz',[job(),job('other','other')])),snapshot(base('qbo',[{id:'profit-and-loss',basis:'Cash',incomeCents:999,cogsCents:1,expensesCents:1,netCents:997}]))];
 const d=dashboard({snapshots,users,user:{...users[0],role:'team'},target:{revenue_cents:999}});assert.equal(d.ops.leads,1);assert.equal(d.ops.jobs,1);assert.equal(d.followups.length,1);assert.doesNotMatch(JSON.stringify(d),/Cents|finance|income|target|other|997/);assert.equal(d.team,undefined);
 const manager=dashboard({snapshots,users,user:{role:'manager'}});assert.equal(manager.finance,undefined);assert(!manager.sources.some(s=>s.provider==='qbo'));
});
test('imports apply atomically and idempotently, reject conflicts and expired reviews',async()=>{
 const f=await fixture();try{const a=await f.db.transaction(tx=>stage(tx,base('ghl',[lead()]),f.ids.owner,f.settings)),b=await f.db.transaction(tx=>stage(tx,base('ghl'),f.ids.owner,f.settings));await apply(f.db,a.id,f.ids.owner);assert.equal((await apply(f.db,a.id,f.ids.owner)).alreadyApplied,true);await assert.rejects(apply(f.db,b.id,f.ids.owner),/newer source/);assert.equal((await f.db.query('SELECT payload FROM snapshots')).rows[0].payload.records.length,1);
 const c=await f.db.transaction(tx=>stage(tx,base('tintwiz'),f.ids.owner,f.settings));await f.db.query("UPDATE batches SET created_at=now()-interval '31 minutes' WHERE id=$1",[c.id]);await assert.rejects(apply(f.db,c.id,f.ids.owner),/expired/);await assert.rejects(f.db.query("UPDATE activity SET action='tampered'"),/append-only/);
 }finally{await f.close();}
});
test('session, CSRF, role enforcement, exact-window reads and disabled-session revocation',async()=>{
 const f=await fixture();try{await request(f.app).get('/api/dashboard?start=2026-01-01&end=2026-01-31').expect(401);const own=await login(f),team=await login(f,'team'),manager=await login(f,'manager');
 for(const p of ['/api/users','/api/batches','/api/activity','/api/connections','/api/syncs']){await team.client.get(p).expect(403);await manager.client.get(p).expect(403);}
 await own.client.post('/api/batches').set('Origin',f.settings.origin).send(base('ghl')).expect(403);await own.client.post('/api/batches').set('Origin','https://evil.test').set('X-CSRF-Token',own.csrf).send(base('ghl')).expect(403);
 await team.mutate('post','/api/batches',base('ghl')).expect(403);await manager.mutate('put','/api/targets',{}).expect(403);
 const b=await own.mutate('post','/api/batches',base('ghl',[lead(),lead('another','ghl-manager')])).expect(201);await own.mutate('post',`/api/batches/${b.body.id}/apply`,{}).expect(200);
 const d=await team.client.get('/api/dashboard?start=2026-01-01&end=2026-01-31').expect(200);assert.equal(d.body.ops.leads,1);assert.equal(d.body.finance,undefined);assert.equal((await own.client.get('/api/dashboard?start=2026-01-02&end=2026-01-31')).body.ops.leads,null);
 await own.mutate('put','/api/users/'+f.ids.team,{email:'team@example.test',name:'Team',role:'team',active:false}).expect(200);await team.client.get('/api/me').expect(401);
 await own.mutate('put','/api/users/'+f.ids.owner,{email:'owner@example.test',name:'Owner',role:'manager',active:true}).expect(409);
 await own.mutate('post','/api/logout',{}).expect(200);await own.client.get('/api/me').expect(401);
 }finally{await f.close();}
});
test('signed bridge verifies raw bytes, rejects tampering and expiry, and deduplicates replay',async()=>{
 const secret='a'.repeat(48),f=await fixture({BRIDGE_TINTWIZ_SECRET:secret});try{const body=JSON.stringify(base('tintwiz',[job()])),ts=String(Math.floor(Date.now()/1000)),event='snapshot-event-1',sig=createHmac('sha256',secret).update(ts+'.'+event+'.'+body).digest('hex');const send=(raw,signature=sig,timestamp=ts)=>request(f.app).post('/bridge/tintwiz').set('Content-Type','application/json').set('X-Bayline-Timestamp',timestamp).set('X-Bayline-Event',event).set('X-Bayline-Signature',signature).send(raw);
 const a=await send(body).expect(202),b=await send(body).expect(202);assert.equal(a.body.id,b.body.id);assert.equal((await f.db.query('SELECT * FROM batches')).rows.length,1);assert.equal((await f.db.query('SELECT * FROM snapshots')).rows.length,0);await send(body+' ').expect(401);await send(body,sig,'1000000000').expect(401);const modified=JSON.stringify(base('tintwiz',[])),sig2=createHmac('sha256',secret).update(ts+'.'+event+'.'+modified).digest('hex');await send(modified,sig2).expect(409);
 }finally{await f.close();}
});
