import json
from datetime import datetime, timezone, timedelta

SCANNER_NAME = "KMS Zombie Keys"
SCANNER_DESCRIPTION = "Find KMS keys with no usage in N days"

def run(session, account_id, region, idle_days=30, verbose=False, **kwargs):
    yield f"INFO | Starting KMS zombie scan in {account_id} / {region}"
    kms = session.client('kms', region_name=region)
    cloudtrail = session.client('cloudtrail', region_name=region)

    paginator = kms.get_paginator('list_keys')
    findings = []
    cutoff = datetime.now(timezone.utc) - timedelta(days=idle_days)

    for page in paginator.paginate():
        for key in page['Keys']:
            key_id = key['KeyId']
            try:
                meta = kms.describe_key(KeyId=key_id)['KeyMetadata']
                if meta['KeyState'] != 'Enabled' or meta['KeyManager'] == 'AWS':
                    continue  # skip disabled or AWS-managed keys

                # Check last usage via CloudTrail
                events = cloudtrail.lookup_events(
                    LookupAttributes=[{'AttributeKey': 'ResourceName', 'AttributeValue': key_id}],
                    MaxResults=1
                )
                last_used = None
                if events['Events']:
                    last_used = events['Events'][0]['EventTime']

                is_zombie = last_used is None or last_used < cutoff
                if is_zombie:
                    findings.append({
                        "id": key_id,
                        "type": "KMS Key",
                        "account": account_id,
                        "region": region,
                        "status": "Zombie",
                        "last_used": str(last_used) if last_used else "Never",
                        "optimization": f"Idle >{idle_days} days",
                        "action": "Review and Schedule Deletion"
                    })
                    if verbose:
                        yield f"INFO | Zombie key found: {key_id} (last used: {last_used or 'Never'})"

            except Exception as e:
                yield f"WARN | Could not check key {key_id}: {str(e)}"

    for finding in findings:
        yield f"RESULT | {json.dumps(finding)}"
    yield f"SUCCESS | KMS scan complete — {len(findings)} zombie keys found"
