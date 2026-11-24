'use strict';

const { randomUUID } = require('node:crypto');
const { createInterface } = require('node:readline/promises');
const { EC2Client, CreateSecurityGroupCommand, AuthorizeSecurityGroupIngressCommand, RevokeSecurityGroupIngressCommand,
  DeleteSecurityGroupCommand } =
  require('@aws-sdk/client-ec2');
const { createScanner } = require('../server/scans');
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
    const permission = { IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '0.0.0.0/0' }] };
    const ingress = { GroupId: groupId, IpPermissions: [permission] };
    await send(new AuthorizeSecurityGroupIngressCommand(ingress));
    const source = flociSource(endpoint);
    const scanner = createScanner([source]);
    const [environment] = scanner.selected(source.id);
    await scanner.run(source.id);
    if (environment.status !== 'succeeded') throw new Error('The initial Floci scan did not complete.');
    const finding = environment.result.findings.find(entry => entry.ruleId === 'CSPM-004' && entry.resourceId === groupId);
    if (!finding || finding.severity !== 'CRITICAL') throw new Error('Floci scan did not observe the critical SSH finding.');
    await send(new RevokeSecurityGroupIngressCommand(ingress));
    await scanner.run(source.id);
    const observed = environment.inventory.find(asset => asset.id === groupId);
    const resolution = environment.resolved.find(entry => entry.id === finding.id);
    if (environment.status !== 'succeeded' || !observed || !resolution) {
      throw new Error('A complete independent Floci scan did not verify resolution on the existing group.');
    }
    return { finding, resolution };
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
    const confirm = await readline.question('Type DEMO SSH to create, scan, remediate and remove a detached local Floci security group: ');
    if (confirm !== 'DEMO SSH') throw new Error('Confirmation did not match.');
  } finally { readline.close(); }
  console.log(JSON.stringify({ ...await demonstrateSSH(process.env.FLOCI_ENDPOINT),
    cleanup: 'Temporary detached group removed' }, null, 2));
}

if (require.main === module) main().catch(error => {
  console.error(error.name === 'NotImplemented' ? 'This Floci emulator does not support the SSH demo.' : error.message);
  process.exitCode = 1;
});

module.exports = { demonstrateSSH };
