'use strict';
const {createHash}=require('node:crypto');
const weights={CRITICAL:10,HIGH:7,MEDIUM:4,LOW:1};
const keyHash=parts=>createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,32);
const finding=(ruleId,title,severity,asset,evidence,recommendation)=>({id:`FND-${keyHash([asset.provider,asset.environment,asset.type,asset.id,ruleId])}`,ruleId,title,severity,resourceId:asset.id,resource:asset.name,provider:asset.provider,environment:asset.environment,source:asset.source,evidence,recommendation,status:'OPEN',detectedAt:new Date().toISOString()});
const publicNet = r=>r==='0.0.0.0/0'||r==='::/0';
function scan(assets){
 const findings=[];
 for(const a of assets){
 const add=(...args)=>findings.push(finding(...args));
 if(a.type==='storage'){
  if(a.public===true)add('CSPM-001','Public storage access','CRITICAL',a,`public=${a.public}`,'Disable anonymous/public access');
  if(a.publicPolicy===true)add('S3-001','Public S3 bucket policy','HIGH',a,'GetBucketPolicyStatus: IsPublic=true','Review the policy and S3 Block Public Access settings');
  if(a.encrypted===false)add('CSPM-002','Storage encryption disabled','HIGH',a,`encrypted=${a.encrypted}`,'Enable storage encryption');
  if(a.encryptionAlgorithms?.length===0)add('CSPM-002','S3 encryption configuration absent','HIGH',a,'GetBucketEncryption reported no default encryption configuration','Review default object encryption settings');
  if(a.logging===false)add('CSPM-003','Storage access logging disabled','MEDIUM',a,`logging=${a.logging}`,'Enable storage access logging');
 }
 if(a.type==='firewall')for(const [port,rule,service] of [[22,'CSPM-004','SSH'],[3389,'CSPM-005','RDP']]){
  const exposed=(a.ingress||[]).filter(p=>[undefined,'tcp','6','-1'].includes(p.protocol) &&
   (p.protocol==='-1'||((p.fromPort??p.port)<=port&&(p.toPort??p.port)>=port)));
  const cidrs=[...new Set(exposed.flatMap(p=>(p.cidrs||[]).filter(publicNet)))].sort();
  if(cidrs.length)add(rule,`${service} exposed to the internet`,'CRITICAL',a,`TCP port ${port}; public CIDRs: ${cidrs.join(', ')}`,'Restrict inbound access to trusted addresses');
 }
 if(a.type==='identity'){
  if((a.permissions||[]).some(p=>p==='*'||p==='*:*'||p==='AdministratorAccess'))add('CSPM-006','Administrative or wildcard access','CRITICAL',a,`permissions=${JSON.stringify(a.permissions)}`,'Apply least-privilege permissions');
  if(a.mfaRequired===false)add('CSPM-007','MFA not required','HIGH',a,'mfaRequired=false','Require MFA for interactive access');
  if(a.consoleLogin===true&&a.mfaDevices===0)add('IAM-002','Console IAM user has no MFA device','HIGH',a,'GetLoginProfile: present; ListMFADevices: empty','Enroll an MFA device or remove console login');
  if(a.adminPolicyArn)add('IAM-003','AWS AdministratorAccess policy attached','HIGH',a,`ListAttachedUserPolicies: ${a.adminPolicyArn}`,'Review the direct policy assignment and apply least privilege');
  if(a.permissions?.includes('iam:PassRole') && a.permissions?.some(p=>['lambda:CreateFunction','ec2:RunInstances','*'].includes(p))) add('IAM-001','Potential privilege escalation combination','HIGH',a,`permissions=${JSON.stringify(a.permissions)}`,'Review PassRole target restrictions and service execution permissions; exploitability not proven');
 }
 if(a.type==='compute'&&a.publicIp&&a.production===true)add('CSPM-008','Production compute publicly accessible','HIGH',a,`publicIp=${a.publicIp}`,'Restrict network exposure or justify public endpoint');
 }
 const unique=[...new Map(findings.map(f=>[f.id,f])).values()];
 const totalAssets=assets.length;
 const penalty=unique.reduce((s,f)=>s+weights[f.severity],0);
 const score=totalAssets?Math.max(0,Math.min(100,Math.round(100*(1-penalty/(10*totalAssets))))):null;
 const counts=Object.fromEntries(Object.keys(weights).map(k=>[k,unique.filter(f=>f.severity===k).length]));
 return {assets:totalAssets,findings:unique,score,counts,scannedAt:new Date().toISOString()};
}
const stages={CreateAccessKey:'Credential Access',AttachRolePolicy:'Privilege Escalation',PutUserPolicy:'Privilege Escalation',ListUsers:'Discovery',ListRoles:'Discovery',ListBuckets:'Discovery',DescribeInstances:'Discovery',GetObject:'Collection',DownloadObject:'Collection'};
function detect(events){
 const sorted=events.filter(e=>Number.isFinite(Date.parse(e?.timestamp))).sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
 const groups=new Map();
 for(const e of sorted){if(!e.actor||!e.action)continue; const key=JSON.stringify([e.provider||'lab',e.environment||'default',e.actor]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e)}
 const incidents=[];
 for(const [key,es] of groups){
  const windowed=es.filter(e=>Date.parse(e.timestamp)>=Date.parse(es[es.length-1].timestamp)-15*60*1000);
  const actions=new Set(windowed.map(e=>e.action));const rules=[];
  if(actions.has('CreateAccessKey'))rules.push('DET-001');
  if(actions.has('AttachRolePolicy')||actions.has('PutUserPolicy'))rules.push('DET-002');
  if(['ListUsers','ListRoles','ListBuckets','DescribeInstances'].filter(x=>actions.has(x)).length>=3)rules.push('DET-003');
  if(windowed.some(e=>(e.action==='GetObject'||e.action==='DownloadObject')&&e.sensitive===true))rules.push('DET-004');
  if(windowed.some(e=>(e.action==='GetObject'||e.action==='DownloadObject')&&Number(e.bytes||0)>=100000000))rules.push('DET-005');
  if(!rules.length)continue;
  const related=windowed.filter(e=>stages[e.action]);
  const chain=[...new Set(related.map(e=>stages[e.action]))];
  incidents.push({id:`INC-${keyHash([key])}`,actor:es[0].actor,provider:es[0].provider||'lab',environment:es[0].environment||'default',severity:rules.length>=3?'CRITICAL':'HIGH',ruleIds:rules,attackStages:chain,events:related,affectedResources:[...new Set(related.map(e=>e.resource).filter(Boolean))],status:'OPEN',createdAt:related[0].timestamp,summary:`${rules.length} alert rule(s) triggered across ${related.length} related events. Suspicious activity; not proof of compromise.`});
 }
 return incidents;
}
module.exports={scan,detect};
