import json

SCANNER_NAME = "EC2 Instances"
SCANNER_DESCRIPTION = "List all EC2 instances with state, type, and zone"

def run(session, account_id, region, idle_days=30, verbose=False, **kwargs):
    yield f"INFO | Starting EC2 scan for account {account_id} / {region}"
    try:
        ec2 = session.client('ec2', region_name=region)
        paginator = ec2.get_paginator('describe_instances')
        count = 0
        for page in paginator.paginate():
            for reservation in page['Reservations']:
                for inst in reservation['Instances']:
                    iid = inst['InstanceId']
                    name = next((t['Value'] for t in inst.get('Tags', []) if t['Key'] == 'Name'), 'N/A')
                    az = inst['Placement']['AvailabilityZone']
                    private_ip = inst.get('PrivateIpAddress', 'N/A')
                    result = {
                        'id': iid,
                        'type': 'EC2 Instance',
                        'account': account_id,
                        'region': region,
                        'status': inst['State']['Name'],
                        'optimization': inst['InstanceType'],
                        'action': f"AZ: {az} | Name: {name} | Private IP: {private_ip}"
                    }
                    yield f"RESULT | {json.dumps(result)}"
                    count += 1
        yield f"SUCCESS | EC2 scan complete — {count} instances found in {region}"
    except Exception as e:
        yield f"ERROR | EC2 scan failed for {account_id}/{region}: {str(e)}"
