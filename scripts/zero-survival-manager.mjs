import fs from 'node:fs';
import {execFileSync} from 'node:child_process';

const run=(cmd,args=[])=>{
  try{return{ok:true,out:execFileSync(cmd,args,{cwd:process.cwd(),encoding:'utf8',stdio:['ignore','pipe','pipe']})}}
  catch(e){return{ok:false,out:String(e.stdout||e.stderr||e.message||'')}}
};

const site='https://panikajeevansathi.onrender.com';
const domain='panikajeevansathi.coolstore.in';

console.log('==============================================');
console.log(' PANIKA JEEVAN SATHI — ₹0 SURVIVAL MANAGER');
console.log('==============================================');

console.log('\n[1] LOCAL AGENTS');
const agents=run(process.execPath,['scripts/agent-team-check.mjs']);
console.log(agents.out.trim());

console.log('\n[2] LOCAL WEBSITE TESTS');
const tests=run('npm',['test']);
console.log(tests.out.slice(-5000));

console.log('\n[3] GITHUB');
const git=run('git',['status','--short']);
console.log(git.out.trim()||'CLEAN');

console.log('\n[4] RENDER LIVE CHECK');
const curl=run('curl',['-L','-sS','-o','/dev/null','-w','%{http_code}',site]);
console.log('Render: '+curl.out.trim());

console.log('\n[5] CPANEL DOMAIN CHECK');
const cp=run('curl',['-L','-sS','-o','/dev/null','-w','%{http_code}',`https://${domain}`]);
console.log('cPanel domain: '+cp.out.trim());

console.log('\n[6] NODE PROJECT');
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
console.log('Node project: FOUND');
console.log('Start script: '+(pkg.scripts?.start||'NOT DEFINED'));
console.log('Dependencies: '+Object.keys(pkg.dependencies||{}).length);

console.log('\n[7] PERSISTENCE CHECK');
console.log(fs.existsSync('data')?'SQLite data directory: FOUND':'SQLite data directory: NOT FOUND');
console.log(fs.existsSync('uploads')?'Uploads directory: FOUND':'Uploads directory: NOT FOUND');

console.log('\n[8] DECISION');

let decision='NEEDS_REVIEW';

if(tests.ok && curl.out.trim()==='200' && cp.out.trim()==='200'){
 decision='CPANEL_AVAILABLE_FOR_MIGRATION_TEST';
}else if(tests.ok && curl.out.trim()==='200'){
 decision='RENDER_WORKING_BUT_PERSISTENCE_MUST_BE_VERIFIED';
}else if(!tests.ok){
 decision='LOCAL_REPAIR_REQUIRED';
}else{
 decision='HOSTING_INVESTIGATION_REQUIRED';
}

fs.mkdirSync('reports/agents',{recursive:true});
fs.writeFileSync(
 'reports/agents/zero-survival-latest.json',
 JSON.stringify({
  time:new Date().toISOString(),
  render_status:curl.out.trim(),
  cpanel_status:cp.out.trim(),
  local_tests:tests.ok,
  agents:agents.ok,
  decision,
  paid_service_activated:false,
  production_ui_changed:false
 },null,2)+'\n'
);

console.log('\n==============================================');
console.log('DECISION: '+decision);
console.log('REPORT: reports/agents/zero-survival-latest.json');
console.log('PAID SERVICE: NOT ACTIVATED');
console.log('UI CHANGE: NONE');
console.log('==============================================');

if(tests.ok) console.log('ALL LOCAL TESTS: PASS');
else console.log('ALL LOCAL TESTS: FAIL — REPAIR REQUIRED');
