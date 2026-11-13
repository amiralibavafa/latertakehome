import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatService, resolvePointer, validateAnswer, buildChatSnapshot, SYSTEM_PROMPT } from '../lib/chat.js';

const now = new Date('2026-11-02T20:00:00Z');
const workspace = { fetchedAt:now.toISOString(), source:'Later Projects API', total:1, projects:[{id:'proj_test',title:'Example project',description:'Source text',status:'wip',updatedAt:now.toISOString(),todos:[{id:'todo_test',title:'Finance review',assignee:'carlos',dueAt:'2026-11-01T20:00:00Z',done:false}]}],submissions:[],activity:{trackingSince:now.toISOString(),events:[]} };
const config = {apiKey:'fake-test-key-not-a-real-credential',model:'gemini-2.5-flash'};
async function fixture(t, extra={}) {
  const directory = await mkdtemp(join(tmpdir(),'later-chat-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  return {config,getSnapshot:async()=>structuredClone(workspace),snapshotPath:join(directory,'context.json'),now:()=>now,...extra};
}
test('snapshot contains all source data and computes overdue work using the selected timezone',()=>{
  const snapshot=buildChatSnapshot(workspace,{now,timeZone:'America/Vancouver'});
  assert.deepEqual(snapshot.projects,workspace.projects);
  assert.equal(snapshot.computed.overdueTasks.length,1);
  assert.equal(snapshot.computed.overdueTasks[0].daysOverdue,1);
  assert.equal(snapshot.historyCoverage.editsTrackedSince,now.toISOString());
});
test('pointer validation rejects invented records, prototype access, and array pseudo-properties',()=>{
  assert.equal(resolvePointer(workspace,'/projects/0/title'),'Example project');
  assert.equal(resolvePointer(workspace,'/projects/99'),undefined);
  assert.equal(resolvePointer(workspace,'/projects/length'),undefined);
  assert.equal(resolvePointer(workspace,'/__proto__'),undefined);
});
test('unsupported answers are normalized instead of returning uncited outside knowledge',()=>{
  const answer=validateAnswer({answer:'Unrelated outside knowledge',evidence:[],insufficientData:true},workspace);
  assert.doesNotMatch(answer.answer,/Unrelated outside knowledge/);
  assert.equal(answer.insufficientData,true);
  assert.throws(()=>validateAnswer({answer:'Invented fact',evidence:['/secrets/key'],insufficientData:false},workspace));
  assert.throws(()=>validateAnswer({answer:'Uncited fact',evidence:[],insufficientData:false},workspace));
});
test('each question writes and reads a fresh JSON file; key goes only in the server header',async t=>{
  let call=0;
  const options=await fixture(t,{getSnapshot:async()=>({...structuredClone(workspace),fetchedAt:new Date(now.getTime()+call*1000).toISOString()}),fetchImpl:async(url,init)=>{
    assert.ok(url.startsWith('https://generativelanguage.googleapis.com/'));
    assert.ok(!url.includes(config.apiKey));
    assert.equal(init.headers['x-goog-api-key'],config.apiKey);
    const payload=JSON.parse(init.body);
    assert.equal(payload.systemInstruction.parts[0].text,SYSTEM_PROMPT);
    assert.ok(!Object.hasOwn(payload,'tools'));
    const supplied=JSON.parse(payload.contents[0].parts[0].text).workspace_snapshot_json;
    const stored=JSON.parse(await readFile(options.snapshotPath,'utf8'));
    assert.deepEqual(supplied,stored);
    assert.ok(!init.body.includes(config.apiKey));
    call++;
    return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({answer:'Finance review is overdue.',evidence:['/computed/overdueTasks'],insufficientData:false})}]}}]});
  }});
  const service=createChatService(options);
  const first=await service.ask({message:'What is late?',timeZone:'America/Vancouver'});
  const second=await service.ask({message:'And now?',history:[null],timeZone:'America/Vancouver'});
  assert.notEqual(first.snapshotAt,second.snapshotAt);
  assert.equal(first.sources.length,1);
  assert.equal(first.readOnly,true);
});
test('provider error details and credential values never reach the user error',async t=>{
  const service=createChatService(await fixture(t,{fetchImpl:async()=>Response.json({error:{message:config.apiKey}},{status:403})}));
  await assert.rejects(()=>service.ask({message:'What is late?'}),error=>!error.message.includes(config.apiKey)&&error.status===503);
});
test('configured secrets accidentally included in data are redacted before snapshot storage and transmission',async t=>{
  const data=structuredClone(workspace);data.projects[0].description=config.apiKey;
  const options=await fixture(t,{getSnapshot:async()=>data,fetchImpl:async(_url,init)=>{
    assert.ok(!init.body.includes(config.apiKey));
    return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({answer:'Not available.',evidence:[],insufficientData:true})}]}}]});
  }});
  await createChatService(options).ask({message:'What data do you have?'});
  assert.ok(!(await readFile(options.snapshotPath,'utf8')).includes(config.apiKey));
});
test('missing key and a question containing the configured key are rejected without a provider call',async t=>{
  const options=await fixture(t,{fetchImpl:async()=>{throw new Error('Must not call provider');}});
  await assert.rejects(()=>createChatService({...options,config:{...config,apiKey:''}}).ask({message:'Hello'}),error=>error.status===503);
  await assert.rejects(()=>createChatService(options).ask({message:config.apiKey}),error=>error.status===400);
});
