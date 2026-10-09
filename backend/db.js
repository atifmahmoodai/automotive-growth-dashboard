import pg from 'pg';
import {readFile} from 'node:fs/promises';
export async function database(url = process.env.DATABASE_URL) {
 if (!url) throw new Error('DATABASE_URL is required');
 const pool = new pg.Pool({connectionString:url, max:10});
 pool.on('error', () => console.error('Database connection interrupted'));
 return {query:(...args)=>pool.query(...args), exec:sql=>pool.query(sql), close:()=>pool.end(),
  transaction:async fn=>{const client=await pool.connect();try {await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}};
}
export async function migrate(db) {const sql=await readFile(new URL('./schema.sql',import.meta.url),'utf8');await db.transaction(tx=>tx.exec?tx.exec(sql):tx.query(sql));}
