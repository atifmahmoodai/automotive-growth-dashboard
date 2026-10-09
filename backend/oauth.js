import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {fail} from './contracts.js';
import {requestJSON} from './providers.js';
const tokenURL='https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
function key(config){const s=config.env.TOKEN_ENCRYPTION_KEY;if(!/^[a-f0-9]{64}$/i.test(s??''))fail('Set a 32-byte hex TOKEN_ENCRYPTION_KEY');return Buffer.from(s,'hex');}
export function seal(value,config){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(config),iv);c.setAAD(Buffer.from('bayline:qbo:v1'));return [iv,Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]),c.getAuthTag()].map(x=>x.toString('base64')).join('.');}
export function unseal(value,config){const [iv,body,tag]=value.split('.').map(x=>Buffer.from(x,'base64')),d=createDecipheriv('aes-256-gcm',key(config),iv);d.setAAD(Buffer.from('bayline:qbo:v1'));d.setAuthTag(tag);return JSON.parse(Buffer.concat([d.update(body),d.final()]).toString('utf8'));}
export function oauthReady(config){key(config);for(const k of ['QBO_CLIENT_ID','QBO_CLIENT_SECRET','QBO_REALM_ID'])if(!config.env[k])fail('Configure QuickBooks OAuth credentials and approved company ID');if(!/^\d+$/.test(config.env.QBO_REALM_ID))fail('Invalid approved company ID');}
export async function exchange(config,params,fetcher){
 oauthReady(config);const e=config.env;
 const r=await requestJSON(tokenURL,{method:'POST',headers:{Authorization:'Basic '+Buffer.from(e.QBO_CLIENT_ID+':'+e.QBO_CLIENT_SECRET).toString('base64'),'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams(params).toString()},fetcher);
 if(typeof r.access_token!=='string'||!r.access_token||typeof r.refresh_token!=='string'||!r.refresh_token||!Number.isFinite(Number(r.expires_in))||Number(r.expires_in)<60||Number(r.expires_in)>86400)fail('Invalid QuickBooks token response; reconnect',502);
 return {access:r.access_token,refresh:r.refresh_token,expires:new Date(Date.now()+Number(r.expires_in)*1000).toISOString()};
}
export async function saveToken(db,t,realm,config){await db.query("INSERT INTO oauth_tokens(provider,encrypted,expires_at,realm,busy) VALUES('qbo',$1,$2,$3,false) ON CONFLICT(provider) DO UPDATE SET encrypted=EXCLUDED.encrypted,expires_at=EXCLUDED.expires_at,realm=EXCLUDED.realm,busy=false",[seal(t,config),t.expires,realm]);}
export async function access(db,config,fetcher){
 const claimed=await db.transaction(async tx=>{
  const row=(await tx.query("SELECT * FROM oauth_tokens WHERE provider='qbo' FOR UPDATE")).rows[0];
  if(!row||row.busy)fail('QuickBooks requires reconnection or another refresh is in progress',409);
  if(row.realm!==config.env.QBO_REALM_ID)fail('Configured QuickBooks company changed; reconnect',409);
  if(Date.parse(row.expires_at)>Date.now()+60000)return {...row,ready:true};
  // Commit the claim before external I/O. A crash leaves a reconnect-required hold, never replaying an uncertain refresh.
  await tx.query("UPDATE oauth_tokens SET busy=true WHERE provider='qbo'");return row;
 });
 const t=unseal(claimed.encrypted,config);if(claimed.ready)return {accessToken:t.access,realm:claimed.realm};
 const next=await exchange(config,{grant_type:'refresh_token',refresh_token:t.refresh},fetcher);
 const r=await db.query("UPDATE oauth_tokens SET encrypted=$1,expires_at=$2,busy=false WHERE provider='qbo' AND encrypted=$3 AND busy=true RETURNING realm",[seal(next,config),next.expires,claimed.encrypted]);
 if(!r.rows.length)fail('QuickBooks connection changed during refresh. Retry.',409);
 return {accessToken:next.access,realm:r.rows[0].realm};
}
