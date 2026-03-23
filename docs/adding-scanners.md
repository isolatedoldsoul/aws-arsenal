# Adding a Scanner

Scanners are Python plugins. Drop a `.py` file in the `scanners/` directory and it is automatically picked up at startup — no registration needed in the backend.

## Minimal Template

```python
import json

SCANNER_NAME = "My Scanner"           # must match the value= in the UI dropdown
SCANNER_DESCRIPTION = "What it does"

def run(session, account_id, region, idle_days=30, verbose=False, **kwargs):
    yield f"INFO | Starting scan for {account_id} / {region}"
    try:
        client = session.client('ec2', region_name=region)
        # ... call AWS APIs ...

        result = {
            'id':           'resource-identifier',
            'type':         'EC2 Instance',
            'account':      account_id,
            'region':       region,
            'status':       'running',
            'optimization': 't2.micro',
            'action':       'AZ: us-east-1a | Name: my-server'
        }
        yield f"RESULT | {json.dumps(result)}"

        yield f"SUCCESS | Scan complete — 1 resource found"
    except Exception as e:
        yield f"ERROR | Scan failed for {account_id}/{region}: {str(e)}"
```

## Result Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique resource identifier (e.g. instance ID, bucket name, allocation ID) |
| `type` | Yes | Human label shown in the Type column (e.g. `EC2 Instance`, `S3 Bucket`) |
| `account` | Yes | AWS account ID |
| `region` | Yes | AWS region (e.g. `us-east-1`) |
| `status` | Yes | Resource state (e.g. `running`, `stopped`, `Associated`, `Unassociated`) |
| `optimization` | Yes | Key attribute shown in the Optimization column (instance type, key policy, etc.) |
| `action` | Yes | Additional detail shown in the Actions column |

## Output Line Protocol

The `run` function is a generator — yield one line at a time:

```
INFO | message        → informational log (grey)
RESULT | {json}       → resource finding added to the results table
SUCCESS | message     → scan finished (green)
ERROR | message       → caught exception — scan continues to next region/account (red)
WARN | message        → non-fatal skip (yellow)
```

## Important Rules

**1. Build dicts before JSON serialization (Python 3.11)**

Python 3.11 does not allow nested quotes inside f-strings. Always build the result dict as a variable first:

```python
# WRONG — SyntaxError: unterminated string literal
yield f"RESULT | {json.dumps({'id': inst['InstanceId'], 'action': f\"AZ: {az}\"})}"

# CORRECT
result = {
    'id': inst['InstanceId'],
    'action': f"AZ: {az}"
}
yield f"RESULT | {json.dumps(result)}"
```

**2. Use `**kwargs`**

Always include `**kwargs` in the `run` signature. The executor may pass additional keyword arguments in future.

**3. Global services (e.g. S3)**

If your scanner covers a global service, guard against duplicate runs:

```python
def run(session, account_id, region, **kwargs):
    if region != 'us-east-1':
        return  # only run once
    ...
```

**4. Opt-in regions**

Accounts that haven't enabled a region return `AuthFailure` from AWS. The executor intercepts these and logs them as `WARN` automatically — your scanner does not need to handle this case specially.

## Registering in the UI

After adding the scanner file, add its name to the service dropdown in `src/App.tsx`:

```jsx
<option value="My Scanner">My Scanner</option>
```

The `value` must exactly match `SCANNER_NAME` in your Python file.

## Existing Scanners (Reference)

| File | SCANNER_NAME | What It Scans |
|------|--------------|---------------|
| `kms_zombie.py` | `KMS Zombie Keys` | Unused KMS keys |
| `alb_unused.py` | `Unused ALBs` | ALBs/NLBs with no healthy targets |
| `ec2_instances.py` | `EC2 Instances` | All EC2 instances regardless of state |
| `s3_buckets.py` | `S3 Buckets` | All S3 buckets (global, runs from us-east-1 only) |
| `eip_addresses.py` | `EIP Addresses` | All Elastic IPs with association status |
| `eip_unassociated.py` | `EIP Unassociated` | Only unassociated (idle, billing) EIPs |
