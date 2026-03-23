import json

SCANNER_NAME = "S3 Buckets"
SCANNER_DESCRIPTION = "List all S3 buckets with region and basic info"

def run(session, account_id, region, idle_days=30, verbose=False, **kwargs):
    # S3 is global — only run once from us-east-1
    if region != 'us-east-1':
        return
    yield f"INFO | Starting S3 scan for account {account_id}"
    try:
        s3 = session.client('s3', region_name='us-east-1')
        buckets = s3.list_buckets().get('Buckets', [])
        count = 0
        for bucket in buckets:
            bname = bucket['Name']
            created = str(bucket.get('CreationDate', ''))[:10]
            try:
                loc = s3.get_bucket_location(Bucket=bname)
                bloc = loc.get('LocationConstraint') or 'us-east-1'
            except Exception:
                bloc = 'unknown'
            result = {
                'id': bname,
                'type': 'S3 Bucket',
                'account': account_id,
                'region': bloc,
                'status': 'Active',
                'optimization': f"Region: {bloc}",
                'action': f"Created: {created or 'N/A'}"
            }
            yield f"RESULT | {json.dumps(result)}"
            count += 1
        yield f"SUCCESS | S3 scan complete — {count} buckets found"
    except Exception as e:
        yield f"ERROR | S3 scan failed for {account_id}: {str(e)}"
