import {PGlite} from '@electric-sql/pglite';
import {database,migrate} from '../backend/db.js';
import {randomUUID} from 'node:crypto';
import {hashPassword} from '../backend/security.js';
import {createApp} from '../backend/app.js';
import {config} from '../backend/config.js';
import request from 'supertest';
export const password='Fictional-testing-password-27!';
export async function fixture(env={},fetcher){
 let db;if(process.env.TEST_DATABASE_URL){db=await database(process.env.TEST_DATABASE_URL);await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');}else db=new PGlite();await migrate(db);
 const settings=config({APP_ORIGIN:'http://localhost:3000',BUSINESS_TIMEZONE:'UTC',BUSINESS_CURRENCY:'USD',...env}),ids={};const hash=await hashPassword(password);
 for(const role of ['owner','manager','team']){ids[role]=randomUUID();await db.query('INSERT INTO users(id,email,name,password,role,ghl_key,tw_key) VALUES($1,$2,$3,$4,$5,$6,$7)',[ids[role],role+'@example.test',role,hash,role,'ghl-'+role,'tw-'+role]);}
 const app=createApp({db,config:settings,fetcher});return {db,app,ids,settings,close:()=>db.close()};
}
export async function login(f,role='owner'){
 const client=request.agent(f.app);await client.post('/api/login').set('Origin',f.settings.origin).send({email:role+'@example.test',password}).expect(200);const r=await client.get('/api/me').expect(200);return {client,csrf:r.body.csrf,mutate:(method,path,body)=>client[method](path).set('Origin',f.settings.origin).set('X-CSRF-Token',r.body.csrf).send(body)};
}
export const base=(provider,records=[])=>({provider,start:'2026-01-01',end:'2026-01-31',currency:'USD',timezone:'UTC',observedAt:new Date().toISOString(),records});
export const lead=(id='one',staffKey='ghl-team')=>({id,staffKey,createdAt:'2026-01-02T12:00:00Z',firstContactAt:'2026-01-02T12:10:00Z',nextFollowupAt:'2026-01-03T12:00:00Z',status:'open',stage:'Consultation'});
export const job=(id='one',staffKey='tw-team')=>({kind:'job',id,staffKey,day:'2026-01-02',service:'PPF',amountCents:100000,refundCents:5000,bay:'Bay 1',bayMinutes:120});
