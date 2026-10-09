import {randomBytes, scrypt as scryptCb, timingSafeEqual, createHash} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCb);
export const token=()=>randomBytes(32).toString('hex');
export const digest=value=>createHash('sha256').update(value).digest('hex');
export async function hashPassword(value){
 if(typeof value!=='string'||value.length<12||value.length>128) throw Object.assign(new Error('Use a password of 12–128 characters'),{status:400});
 const salt=randomBytes(16).toString('hex');return salt+':'+(await scrypt(value,salt,64)).toString('hex');
}
export async function verify(value,stored){
 const [salt,hash]=stored.split(':');const actual=await scrypt(String(value).slice(0,128),salt,64);return timingSafeEqual(actual,Buffer.from(hash,'hex'));
}
export function email(value){const e=String(value??'').trim().toLowerCase();if(e.length>254||! /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(e)||e.split('@')[0].length>64||e.startsWith('.')||e.includes('..')||e.includes('.@')) throw Object.assign(new Error('Enter a valid email address'),{status:400});return e;}
