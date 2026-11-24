'use strict';

const { randomUUID } = require('node:crypto');
const { createInterface } = require('node:readline/promises');
const { EC2Client, CreateSecurityGroupCommand, AuthorizeSecurityGroupIngressCommand, DeleteSecurityGroupCommand } =
  require('@aws-sdk/client-ec2');
const { scan } = require('../security-engine/engine');
const { flociSource } = require('../server/floci');
const { endpoint, verifyEmulator } = require('../server/floci-lab');

async function demonstrateSSH(configuredEndpoint) {
  if (configuredEndpoint !== endpoint) throw new Error('The SSH demo requires the fixed local Floci endpoint.');
  await verifyEmulator();
  const ec2 = new EC2Client({ endpoint, region: 'us-east-1', maxAttempts: 1,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
  const send = command => ec2.send(command, { abortSignal: AbortSignal.timeout(6000) });
  let groupId;
  try {
    const group = await send(new CreateSecurityGroupCommand({
      GroupName: 'cs-demo-ssh-' + randomUUID(), Description: 'Temporary detached CloudSentinel SSH posture demo'
    }));
    groupId = group.GroupId;
    if (!/^sg-[a-z0-9-]+$/.test(groupId || '')) throw new Error('Floci returned an invalid security-group ID.');
    await send(new AuthorizeSecurityGroupIngressCommand({ GroupId: groupId,
      IpPermissions: [{ IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '0.0.0.0/0' }] }] }));
    const source = flociSource(endpoint);
    const inventory = (await source.collect()).map(asset => ({ ...asset,
      provider: source.provider, environment: source.id, source: source.kind }));
    const finding = scan(inventory).findings.find(finding => finding.ruleId === 'CSPM-004' && finding.resourceId === groupId);
    if (!finding) throw new Error('Floci scan did not observe the expected SSH finding.');
    return finding;
  } finally {
    try {
      if (/^sg-[a-z0-9-]+$/.test(groupId || '')) {
        await send(new DeleteSecurityGroupCommand({ GroupId: groupId })).catch(() => {
          throw new Error('Floci could not remove the detached demo security group ' + groupId + '.');
        });
      }
    } finally { ec2.destroy(); }
  }
}

async function main() {
  if (!process.stdin.isTTY || process.env.FLOCI_LAB_ENABLED !== '1' || process.env.FLOCI_ENDPOINT !== endpoint) {
    throw new Error('Run interactively with the disposable Floci lab enabled on 127.0.0.1:4566.');
  }
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const confirm = await readline.question('Type DEMO SSH to create, scan and remove a detached local Floci security group: ');
    if (confirm !== 'DEMO SSH') throw new Error('Confirmation did not match.');
  } finally { readline.close(); }
  console.log(JSON.stringify({ finding: await demonstrateSSH(process.env.FLOCI_ENDPOINT),
    cleanup: 'Temporary detached group removed' }, null, 2));
}

if (require.main === module) main().catch(error => {
  console.error(error.name === 'NotImplemented' ? 'This Floci emulator does not support the SSH demo.' : error.message);
  process.exitCode = 1;
});

module.exports = { demonstrateSSH };
