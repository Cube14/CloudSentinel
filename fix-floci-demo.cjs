const {
  EC2Client,
  DescribeSecurityGroupsCommand,
  RevokeSecurityGroupIngressCommand
} = require('@aws-sdk/client-ec2');
const { createInterface } = require('node:readline/promises');

const ec2 = new EC2Client({
  endpoint: 'http://127.0.0.1:4566',
  region: 'us-east-1',
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test'
  }
});

const isOpen = group => group.IpPermissions?.some(
  p => p.IpProtocol === 'tcp' &&
    p.FromPort === 22 && p.ToPort === 22 &&
    p.IpRanges?.some(ip => ip.CidrIp === '0.0.0.0/0')
);

async function main() {
  const groups = (await ec2.send(
    new DescribeSecurityGroupsCommand({})
  )).SecurityGroups || [];

  const vulnerable = groups.filter(
    g => g.GroupName?.startsWith('cloudsentinel-') && isOpen(g)
  );

  if (!vulnerable.length) {
    console.log('No vulnerable CloudSentinel demo security groups found.');
    console.log('Run npm run demo:floci on a disposable emulator if needed.');
    return;
  }

  console.table(vulnerable.map(g => ({
    ID: g.GroupId,
    Name: g.GroupName,
    Risk: 'PUBLIC SSH - CRITICAL'
  })));

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const id = (await rl.question(
      'Paste the demo security group ID to fix: '
    )).trim();

    const target = vulnerable.find(g => g.GroupId === id);
    if (!target) {
      console.log('No changes made: invalid demo group ID.');
      return;
    }

    const confirmation = await rl.question(
      'Type FIX to remove public SSH access: '
    );

    if (confirmation !== 'FIX') {
      console.log('Cancelled. No changes made.');
      return;
    }

    await ec2.send(new RevokeSecurityGroupIngressCommand({
      GroupId: target.GroupId,
      IpPermissions: [{
        IpProtocol: 'tcp',
        FromPort: 22,
        ToPort: 22,
        IpRanges: [{ CidrIp: '0.0.0.0/0' }]
      }]
    }));

    const updated = (await ec2.send(
      new DescribeSecurityGroupsCommand({
        GroupIds: [target.GroupId]
      })
    )).SecurityGroups[0];

    console.log(isOpen(updated)
      ? 'WARNING: SSH exposure remains.'
      : 'SUCCESS: Public SSH ingress removed from Floci.');
  } finally {
    rl.close();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
