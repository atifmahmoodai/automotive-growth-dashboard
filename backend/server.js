import {database,migrate} from './db.js';
import {createApp} from './app.js';
import {config} from './config.js';
const settings=config(),db=await database();await migrate(db);const server=createApp({db,config:settings}).listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Bayline is ready'));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(async()=>{await db.close();process.exit(0);}));
