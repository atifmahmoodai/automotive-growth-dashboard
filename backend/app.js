import express from 'express';
import path from 'node:path';
import {randomUUID,createHmac,timingSafeEqual} from 'node:crypto';
import {token,digest,hashPassword,verify,email} from './security.js';
import {text,integer,windowOf,fail,validate} from './contracts.js';
import {stage,apply,audit} from './imports.js';
import {dashboard} from './metrics.js';
import {oauthReady,exchange,saveToken} from './oauth.js';
const uuid=v=>{if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v??''))fail('Invalid ID');return v;};
export function createApp({db,config,fetcher,frontend=path.resolve('dist')}){
 const {origin,secure,env}=config,app=express();app.disable('x-powered-by');if(env.TRUST_SINGLE_PROXY==='true')app.set('trust proxy',1);
 app.use((req,res,next)=>{res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});if(secure)res.set('Strict-Transport-Security','max-age=31536000');next();});
 app.post('/bridge/:provider',express.raw({type:'application/json',limit:'2mb'}),async(req,res)=>{
  const provider=req.params.provider,secret=env['BRIDGE_'+provider.toUpperCase()+'_SECRET'];
  if(!['ghl','tintwiz','hyros','qbo'].includes(provider)||!secret||secret.length<32)fail('Bridge is not configured',404);
  const ts=req.get('x-bayline-timestamp'),event=req.get('x-bayline-event'),sig=req.get('x-bayline-signature');
  if(!/^\d{10}$/.test(ts??'')||Math.abs(Date.now()/1000-Number(ts))>300||! /^[A-Za-z0-9_-]{8,100}$/.test(event??'')||! /^[a-f0-9]{64}$/.test(sig??'')||!Buffer.isBuffer(req.body))fail('Bridge signature rejected',401);
  const expected=createHmac('sha256',secret).update(ts+'.'+event+'.').update(req.body).digest();if(!timingSafeEqual(expected,Buffer.from(sig,'hex')))fail('Bridge signature rejected',401);
  let input;try{input=JSON.parse(req.body);}catch{fail('Invalid JSON');}if(input.provider!==provider)fail('Provider mismatch');input=validate(input,config);
  const result=await db.transaction(async tx=>{
   // Serialize event lookup and insertion, so replay cannot create a second review.
   await tx.query('SELECT version FROM source_versions WHERE provider=$1 FOR UPDATE',[provider]);
   const existing=(await tx.query('SELECT b.id,b.digest,b.payload FROM bridge_events e JOIN batches b ON b.id=e.batch_id WHERE e.provider=$1 AND e.event_id=$2',[provider,event])).rows[0];
   if(existing){if(digest(JSON.stringify(input))!==existing.digest)fail('Event ID was already used for different data',409);return {id:existing.id,replayed:true};}
   const b=await stage(tx,input,null,config);await tx.query('INSERT INTO bridge_events(provider,event_id,batch_id) VALUES($1,$2,$3)',[provider,event,b.id]);return b;
  });res.status(202).json(result);
 });
 app.use((req,res,next)=>{if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.get('origin')!==origin)return res.status(403).json({error:'Request origin rejected'});next();});
 app.use(express.json({limit:'2mb'}));
 const cookie=(res,value,maxAge)=>res.cookie('session',value,{httpOnly:true,secure,sameSite:'lax',path:'/',maxAge});
 async function throttle(req){const key=digest('login:'+req.ip);const r=await db.query("INSERT INTO throttles(key,count,expires_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN throttles.expires_at<now() THEN 1 ELSE throttles.count+1 END,expires_at=CASE WHEN throttles.expires_at<now() THEN now()+interval '15 minutes' ELSE throttles.expires_at END RETURNING count",[key]);if(r.rows[0].count>30)fail('Too many attempts. Try again in 15 minutes.',429);}
 app.get('/api/health',async(req,res)=>{await db.query('SELECT 1');res.json({ok:true});});
 app.post('/api/login',async(req,res)=>{
  await throttle(req);const address=email(req.body.email),u=(await db.query('SELECT * FROM users WHERE email=$1 AND active=true',[address])).rows[0];
  if(!u||!await verify(req.body.password,u.password))fail('Email or password is incorrect',401);
  const raw=token(),csrf=token();await db.transaction(async tx=>{await tx.query('DELETE FROM sessions WHERE expires_at<now()');await tx.query("INSERT INTO sessions(hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",[digest(raw),u.id,csrf]);await audit(tx,u.id,'login',u.id);});cookie(res,raw,8*3600000);res.json({ok:true});
 });
 app.use('/api',async(req,res,next)=>{
  const raw=(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8)??'';
  const u=(await db.query('SELECT u.id,u.email,u.name,u.role,u.ghl_key,u.tw_key,s.csrf,s.hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=$1 AND s.expires_at>now() AND u.active=true',[digest(raw)])).rows[0];if(!u)fail('Please sign in',401);req.user=u;
  if(!['GET','HEAD'].includes(req.method)&&req.get('x-csrf-token')!==u.csrf)fail('Refresh the page and try again',403);next();
 });
 const owner=(req,res,next)=>{if(req.user.role!=='owner')fail('Owner access required',403);next();};
 app.get('/api/me',(req,res)=>{const {hash,...user}=req.user;res.json({...user,currency:config.currency,timezone:config.timezone});});
 app.post('/api/logout',async(req,res)=>{await db.transaction(async tx=>{await tx.query('DELETE FROM sessions WHERE hash=$1',[req.user.hash]);await tx.query('DELETE FROM oauth_states WHERE session_hash=$1',[req.user.hash]);await audit(tx,req.user.id,'logout',req.user.id);});cookie(res,'',0);res.json({ok:true});});
 app.get('/api/dashboard',async(req,res)=>{
  const {start,end}=windowOf(req.query.start,req.query.end);
  const result=await db.transaction(async tx=>{
   // One SQL statement reads all inputs using one MVCC statement snapshot.
   const r=(await tx.query("SELECT (SELECT coalesce(jsonb_agg(s),'[]') FROM snapshots s WHERE start_day=$1 AND end_day=$2) AS snapshots,(SELECT coalesce(jsonb_agg(u),'[]') FROM (SELECT id,name,role,active,ghl_key,tw_key FROM users) u) AS users,(SELECT to_jsonb(t) FROM targets t WHERE start_day=$1 AND end_day=$2) AS target",[start,end])).rows[0];
   return dashboard({...r,user:req.user});
  });res.json({...result,start,end,currency:config.currency,timezone:config.timezone});
 });
 app.put('/api/targets',owner,async(req,res)=>{
  const b=req.body,{start,end}=windowOf(b.start,b.end);integer(b.revenueCents,1);integer(b.responseMinutes,1,1440);integer(b.closePercent,1,100);if(typeof b.minimumRoas!=='number'||!Number.isFinite(b.minimumRoas)||b.minimumRoas<0||b.minimumRoas>100)fail('ROAS must be between 0 and 100');
  await db.transaction(async tx=>{await tx.query('INSERT INTO targets(start_day,end_day,revenue_cents,response_minutes,close_percent,minimum_roas,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(start_day,end_day) DO UPDATE SET revenue_cents=EXCLUDED.revenue_cents,response_minutes=EXCLUDED.response_minutes,close_percent=EXCLUDED.close_percent,minimum_roas=EXCLUDED.minimum_roas,updated_by=EXCLUDED.updated_by',[start,end,b.revenueCents,b.responseMinutes,b.closePercent,b.minimumRoas,req.user.id]);await audit(tx,req.user.id,'targets_updated',start+'/'+end);});res.json({ok:true});
 });
 app.get('/api/batches',owner,async(req,res)=>res.json((await db.query('SELECT id,provider,start_day,end_day,status,created_at,applied_at,jsonb_array_length(payload->\'records\') AS records FROM batches ORDER BY created_at DESC LIMIT 100')).rows));
 app.post('/api/batches',owner,async(req,res)=>res.status(201).json(await db.transaction(tx=>stage(tx,req.body,req.user.id,config))));
 app.get('/api/batches/:id',owner,async(req,res)=>{const b=(await db.query('SELECT * FROM batches WHERE id=$1',[uuid(req.params.id)])).rows[0];if(!b)fail('Review not found',404);res.json(b);});
 app.post('/api/batches/:id/apply',owner,async(req,res)=>res.json(await apply(db,uuid(req.params.id),req.user.id)));
 app.post('/api/batches/:id/reject',owner,async(req,res)=>{await db.transaction(async tx=>{const r=await tx.query("UPDATE batches SET status='rejected' WHERE id=$1 AND status='review' RETURNING id",[uuid(req.params.id)]);if(!r.rows.length)fail('No pending review found',409);await audit(tx,req.user.id,'snapshot_rejected',req.params.id);});res.json({ok:true});});
 app.get('/api/users',owner,async(req,res)=>res.json((await db.query('SELECT id,email,name,role,ghl_key,tw_key,active FROM users ORDER BY name')).rows));
 const userFields=b=>{if(!['owner','manager','team'].includes(b.role))fail('Invalid role');return [email(b.email),text(b.name,100),b.role,b.ghl_key?text(b.ghl_key):null,b.tw_key?text(b.tw_key):null];};
 app.post('/api/users',owner,async(req,res)=>{const fields=userFields(req.body),password=await hashPassword(req.body.password),id=randomUUID();await db.transaction(async tx=>{await tx.query('INSERT INTO users(id,email,name,role,ghl_key,tw_key,password) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,...fields,password]);await audit(tx,req.user.id,'user_created',id);});res.status(201).json({id});});
 app.put('/api/users/:id',owner,async(req,res)=>{
  const id=uuid(req.params.id),fields=userFields(req.body);if(typeof req.body.active!=='boolean')fail('Active must be true or false');
  await db.transaction(async tx=>{await tx.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');if(!req.body.active||req.body.role!=='owner'){const remaining=(await tx.query("SELECT id FROM users WHERE active=true AND role='owner' AND id<>$1",[id])).rows;if(!remaining.length)fail('Keep at least one active owner',409);}
   const r=await tx.query('UPDATE users SET email=$2,name=$3,role=$4,ghl_key=$5,tw_key=$6,active=$7 WHERE id=$1 RETURNING id',[id,...fields,req.body.active]);if(!r.rows.length)fail('User not found',404);await tx.query('DELETE FROM sessions WHERE user_id=$1',[id]);await audit(tx,req.user.id,'user_updated',id);
  });res.json({ok:true});
 });
 app.get('/api/activity',owner,async(req,res)=>res.json((await db.query('SELECT a.*,u.name FROM activity a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 300')).rows));
 app.get('/api/connections',owner,async(req,res)=>{
  const q=(await db.query("SELECT realm,busy FROM oauth_tokens WHERE provider='qbo'")).rows[0];res.json({ghl:{configured:!!(env.GHL_TOKEN&&env.GHL_LOCATION_ID)},tintwiz:{configured:(env.BRIDGE_TINTWIZ_SECRET?.length??0)>=32},hyros:{configured:!!(env.HYROS_API_KEY&&env.HYROS_CAMPAIGNS&&env.HYROS_TIMEZONE_CONFIRMED===config.timezone)},qbo:{configured:!!q&&!q.busy&&q.realm===env.QBO_REALM_ID,reconnect:!!q?.busy}});
 });
 app.post('/api/oauth/qbo/start',owner,async(req,res)=>{
  oauthReady(config);const state=token();await db.transaction(async tx=>{await tx.query('DELETE FROM oauth_states WHERE session_hash=$1 OR expires_at<now()',[req.user.hash]);await tx.query("INSERT INTO oauth_states(hash,session_hash,expires_at) VALUES($1,$2,now()+interval '5 minutes')",[digest(state),req.user.hash]);});
  const url=new URL('https://appcenter.intuit.com/connect/oauth2');url.search=new URLSearchParams({client_id:env.QBO_CLIENT_ID,response_type:'code',scope:'com.intuit.quickbooks.accounting',redirect_uri:origin+'/api/oauth/qbo/callback',state});res.json({url:url.toString()});
 });
 app.get('/api/oauth/qbo/callback',owner,async(req,res)=>{
  const state=text(req.query.state,200);const r=await db.query('DELETE FROM oauth_states WHERE hash=$1 AND session_hash=$2 AND expires_at>now() RETURNING hash',[digest(state),req.user.hash]);if(!r.rows.length)fail('OAuth state expired or belongs to another session',403);
  if(req.query.error)fail('QuickBooks connection was not authorized');if(req.query.realmId!==env.QBO_REALM_ID)fail('This QuickBooks company is not the approved company',403);
  const tokens=await exchange(config,{grant_type:'authorization_code',code:text(req.query.code,2048),redirect_uri:origin+'/api/oauth/qbo/callback'},fetcher);
  await db.transaction(async tx=>{await saveToken(tx,tokens,req.query.realmId,config);await audit(tx,req.user.id,'qbo_connected',req.query.realmId);});res.redirect('/?connected=qbo');
 });
 app.delete('/api/oauth/qbo',owner,async(req,res)=>{await db.transaction(async tx=>{await tx.query("DELETE FROM oauth_tokens WHERE provider='qbo'");await tx.query('DELETE FROM oauth_states');await audit(tx,req.user.id,'qbo_disconnected','qbo');});res.json({ok:true});});
 app.get('/api/syncs',owner,async(req,res)=>res.json((await db.query('SELECT * FROM sync_jobs ORDER BY created_at DESC LIMIT 50')).rows));
 app.post('/api/syncs',owner,async(req,res)=>{const {provider,start,end}=req.body;windowOf(start,end);if(!['ghl','hyros','qbo'].includes(provider))fail('Select a supported direct connection');const id=randomUUID();await db.transaction(async tx=>{await tx.query('INSERT INTO sync_jobs(id,provider,start_day,end_day,user_id) VALUES($1,$2,$3,$4,$5)',[id,provider,start,end,req.user.id]);await audit(tx,req.user.id,'sync_queued',id);});res.status(202).json({id});});
 app.use('/api',(req,res)=>res.status(404).json({error:'Endpoint not found'}));app.use(express.static(frontend,{index:'index.html'}));
 app.use((err,req,res,next)=>{if(res.headersSent)return next(err);const status=err.status??(err.code==='23505'?409:500);res.status(status).json({error:status===500?'Request failed; contact your administrator':err.code==='23505'?'A matching record or pending sync already exists':status===413?'Snapshot exceeds 2 MB':err.message});if(status===500)console.error('Request failed',err.code??err.name);});return app;
}
