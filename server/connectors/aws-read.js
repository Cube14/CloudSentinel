'use strict';

async function read(client, Command, input, signal, absentError) {
  signal.throwIfAborted();
  try {
    return await client.send(new Command(input), { abortSignal: signal });
  } catch (error) {
    if (absentError && [absentError, absentError + 'Exception'].includes(error.name)) return null;
    const detail = [error.code || error.name, error.message].filter(Boolean).join(' ');
    throw new Error(Command.name + ': ' + detail, { cause: error });
  }
}

async function readPages(client, Command, input, field, tokenField, moreField, signal) {
  const items = [];
  const tokens = new Set();
  let token;
  do {
    const response = await read(client, Command, { ...input, [tokenField]: token }, signal);
    items.push(...(response[field] || []));
    token = moreField && !response[moreField] ? undefined : response[tokenField];
    if ((moreField && response[moreField] && !token) || (token && tokens.has(token))) {
      throw new Error('Invalid pagination in ' + Command.name);
    }
    if (token) tokens.add(token);
  } while (token);
  return items;
}

function normalizeGroup(group, region) {
  const ingress = (group.IpPermissions || []).map(permission => ({
    protocol: permission.IpProtocol, fromPort: permission.FromPort, toPort: permission.ToPort,
    cidrs: [...(permission.IpRanges || []).map(range => range.CidrIp),
      ...(permission.Ipv6Ranges || []).map(range => range.CidrIpv6)],
    referencedGroups: (permission.UserIdGroupPairs || []).map(pair => pair.GroupId),
    prefixLists: (permission.PrefixListIds || []).map(entry => entry.PrefixListId)
  }));
  return { id: region ? region + ':' + group.GroupId : group.GroupId, name: group.GroupName,
    type: 'firewall', vpcId: group.VpcId, ingress, ...(region ? { region, nativeId: group.GroupId } : {}) };
}

function normalizeInstance(instance, region) {
  return {
    id: region ? region + ':' + instance.InstanceId : instance.InstanceId,
    name: instance.Tags?.find(tag => tag.Key === 'Name')?.Value || instance.InstanceId,
    type: 'compute', state: instance.State?.Name, publicIp: instance.PublicIpAddress ?? null,
    securityGroups: (instance.SecurityGroups || []).map(group => group.GroupId),
    ...(region ? { region, nativeId: instance.InstanceId } : {})
  };
}

const isBucketName = value => typeof value === 'string' && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value);

module.exports = { read, readPages, normalizeGroup, normalizeInstance, isBucketName };
