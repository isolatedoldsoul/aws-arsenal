import json

SCANNER_NAME = "EIP Unassociated"
SCANNER_DESCRIPTION = "Find Elastic IPs not associated with any resource (costing money unused)"

def run(session, account_id, region, idle_days=30, verbose=False, **kwargs):
    yield f"INFO | Starting unassociated EIP scan for account {account_id} / {region}"
    try:
        ec2 = session.client('ec2', region_name=region)
        addresses = ec2.describe_addresses().get('Addresses', [])
        findings = []
        for addr in addresses:
            if not addr.get('AssociationId'):
                eip = addr.get('PublicIp', '')
                alloc_id = addr.get('AllocationId', eip)
                findings.append({
                    'id': alloc_id,
                    'type': 'Elastic IP',
                    'account': account_id,
                    'region': region,
                    'status': 'Unassociated',
                    'optimization': f"IP: {eip} — idle, accruing charges",
                    'action': 'Release to stop charges (~$0.005/hr per EIP)'
                })
        for f in findings:
            yield f"RESULT | {json.dumps(f)}"
        yield f"SUCCESS | EIP unassociated scan complete — {len(findings)} idle EIPs in {region}"
    except Exception as e:
        yield f"ERROR | EIP unassociated scan failed for {account_id}/{region}: {str(e)}"
