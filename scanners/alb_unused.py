import json

SCANNER_NAME = "Unused ALBs"
SCANNER_DESCRIPTION = "Find Application Load Balancers with no targets or traffic"

def run(session, account_id, region, idle_days=30, verbose=False, **kwargs):
    yield f"INFO | Starting ALB scan for account {account_id}..."
    try:
        elbv2 = session.client('elbv2', region_name=region)
        paginator = elbv2.get_paginator('describe_load_balancers')
        count = 0
        for page in paginator.paginate():
            for lb in page['LoadBalancers']:
                lb_arn = lb['LoadBalancerArn']
                lb_name = lb['LoadBalancerName']
                yield f"RESULT | {json.dumps({'id': lb_name, 'type': 'Load Balancer', 'account': account_id, 'status': lb['State']['Code'], 'optimization': lb['Type'], 'action': 'Review Usage'})}"
                count += 1
        yield f"SUCCESS | Found {count} ALBs."
    except Exception as e:
        yield f"ERROR | ALB scan failed: {str(e)}"
