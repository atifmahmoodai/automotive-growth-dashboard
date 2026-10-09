export function config(env=process.env){
 const origin=env.APP_ORIGIN||'http://localhost:3000',currency=env.BUSINESS_CURRENCY||'USD',timezone=env.BUSINESS_TIMEZONE||'UTC';
 const u=new URL(origin);if(u.origin!==origin||!['http:','https:'].includes(u.protocol))throw new Error('APP_ORIGIN must be an origin without a trailing slash');
 if(!/^[A-Z]{3}$/.test(currency))throw new Error('Use an ISO currency code');new Intl.DateTimeFormat('en',{timeZone:timezone});
 if(new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits!==2)throw new Error('This installation supports currencies with two decimal places');
 if(env.NODE_ENV==='production'&&u.protocol!=='https:')throw new Error('Production requires HTTPS');
 return {origin,currency,timezone,secure:u.protocol==='https:',env};
}
