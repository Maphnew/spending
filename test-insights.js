'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const express=require('express');
const Database=require('better-sqlite3');
const mount=require('./insights');
const Budget=require('./public/budget-comparison');
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
 const groups=Budget.buildGroups(updated.body.plan,updated.body.fixed);
 assert.equal(groups.reduce((n,g)=>n+g.budget,0),4500000);
 const comparison=Budget.compare([
  {category:'개인',merchant:'등록',amount:300000},{category:'개인',merchant:'환불',amount:-50000},
  {category:'쇼핑',merchant:'옷',amount:200000},
  {category:'육아 - 교육',amount:77000},{category:'육아 - 생필품',amount:20000},{category:'육아 - 간식',amount:3000},
  {category:'건강/의료',amount:10000},{category:'건강식품',amount:5000},
  {category:'주거',merchant:'예지 청약',amount:20000},{category:'새 분류',amount:7000},{category:'',amount:1000},
 ],groups);
 assert.equal(comparison.actual,573000);assert.equal(comparison.savings,20000);
 assert.equal(comparison.rows.find(r=>r.label==='개인').remaining,20000);
 assert.equal(comparison.rows.find(r=>r.label==='쇼핑').remaining,-50000);
 assert.equal(comparison.rows.find(r=>r.label==='육아 (교육·생필품·간식)').actual,100000);
 assert.equal(comparison.rows.find(r=>r.label==='건강·의료·건강식품').actual,15000);
 assert.equal(comparison.rows.find(r=>r.label==='새 분류').budget,null);
 assert.equal(comparison.rows.filter(r=>r.budget!=null).reduce((n,r)=>n+r.budget,0),4500000);
 assert.equal(Budget.compare([],groups).actual,0);
 assert.throws(()=>Budget.buildGroups({...updated.body.plan,monthlySpendingLimit:1},updated.body.fixed));
 assert.deepEqual(transactions(),before,'Analysis must not mutate spending transactions');
 const cached=JSON.parse(fs.readFileSync(cacheFile,'utf8'));
 const failingCache=path.join(root,'failing-cache.json');fs.writeFileSync(failingCache,JSON.stringify(cached));
 const failurePort=await start({project:path.join(root,'missing-project'),cacheFile:failingCache});
 assert.equal((await request(failurePort,'/api/insights/refresh','POST')).status,500);
 const retained=await request(failurePort,'/api/insights');assert.equal(retained.status,200);assert.equal(retained.body.generatedAt,cached.generatedAt);
 const restarted=await start({project:path.join(root,'missing-project'),cacheFile:failingCache});
 assert.equal((await request(restarted,'/api/insights')).body.generatedAt,cached.generatedAt);
 console.log('PASS: report consistency, real refresh, concurrent refresh lock, unchanged source DB, failed-refresh retention, persistent cache, category budget grouping, refunds, savings exclusion, unplanned categories and budget reconciliation.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
 await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));
 if(path.dirname(root)===path.resolve(os.tmpdir())&&path.basename(root).startsWith('spending-insights-test-'))fs.rmSync(root,{recursive:true,force:true});
});
