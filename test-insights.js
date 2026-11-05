'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const express=require('express');
const Database=require('better-sqlite3');
const mount=require('./insights');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'spending-insights-test-'));
const servers=[];
function start(options){const app=express();mount(app,options);return new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>{servers.push(server);resolve(server.address().port);});});}
function request(port,url,method='GET'){return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path:url,method},res=>{let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(body)});}catch(e){reject(e);}});});req.on('error',reject);req.end();});}
function transactions(){const db=new Database(path.join(__dirname,'spending.db'),{readonly:true});try{return db.prepare('SELECT * FROM transactions ORDER BY id').all();}finally{db.close();}}
(async()=>{
 const before=transactions();
 const project=path.resolve(__dirname,'../codex-home/monthly-spend');
 const cacheFile=path.join(root,'good-cache.json');
 const port=await start({project,cacheFile});
 const first=await request(port,'/api/insights');assert.equal(first.status,200);
 assert.equal(first.body.plan.budgets.reduce((sum,r)=>sum+r.amount,0),4500000);
 const refresh=request(port,'/api/insights/refresh','POST');
 // The first child process cannot finish before this second request reaches the lock.
 const concurrent=await request(port,'/api/insights/refresh','POST');assert.equal(concurrent.status,409);
 const updated=await refresh;assert.equal(updated.status,200);
 assert.equal(updated.body.sourceCount,before.length);
 assert.ok(updated.body.transactions.length>1000);
 const tx=updated.body.transactions.filter(r=>r.date&&r.date<'2026-11-01'&&r.date>='2026-01-01'&&!/청약/.test(r.description));
 assert.equal(tx.reduce((n,r)=>n+r.amount,0),updated.body.categories.consumptionTotal);
 assert.equal(updated.body.fixed.dataBuiltAt,updated.body.generatedAt);
 assert.deepEqual(transactions(),before,'Analysis must not mutate spending transactions');
 const cached=JSON.parse(fs.readFileSync(cacheFile,'utf8'));
 const failingCache=path.join(root,'failing-cache.json');fs.writeFileSync(failingCache,JSON.stringify(cached));
 const failurePort=await start({project:path.join(root,'missing-project'),cacheFile:failingCache});
 assert.equal((await request(failurePort,'/api/insights/refresh','POST')).status,500);
 const retained=await request(failurePort,'/api/insights');assert.equal(retained.status,200);assert.equal(retained.body.generatedAt,cached.generatedAt);
 const restarted=await start({project:path.join(root,'missing-project'),cacheFile:failingCache});
 assert.equal((await request(restarted,'/api/insights')).body.generatedAt,cached.generatedAt);
 console.log('PASS: report consistency, real refresh, concurrent refresh lock, unchanged source DB, failed-refresh retention, persistent cache.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
 await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));
 if(path.dirname(root)===path.resolve(os.tmpdir())&&path.basename(root).startsWith('spending-insights-test-'))fs.rmSync(root,{recursive:true,force:true});
});
