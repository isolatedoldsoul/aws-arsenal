import json

SCANNER_NAME = "EIP Addresses"
SCANNER_DESCRIPTION = "List all Elastic IPs with association status"

def run(session, account_id, region, idle_days=30, verbose=False, **kwargs):
    yield f"INFO | Starting EIP scan for account {account_id} / {region}"
    try:
        ec2 = session.client('ec2', region_name=region)
        addresses = ec2.describe_addresses().get('Addresses', [])
        count = 0
        for addr in addresses:
            eip = addr.get('PublicIp', '')
            alloc_id = addr.get('AllocationId', eip)
            instance = addr.get('InstanceId', 'None')
            assoc = addr.get('AssociationId', '')
            domain = addr.get('Domain', '')
            result = {
                'id': alloc_id,
                'type': 'Elastic IP',
                'account': account_id,
                'region': region,
                'status': 'Associated' if assoc else 'Unassociated',
                'optimization': f"IP: {eip} | Domain: {domain}",
                'action': f"Instance: {instance}"
            }
            yield f"RESULT | {json.dumps(result)}"
            count += 1
        yield f"SUCCESS | EIP scan complete — {count} EIPs in {region}"
    except Exception as e:
        yield f"ERROR | EIP scan failed for {account_id}/{region}: {str(e)}"
