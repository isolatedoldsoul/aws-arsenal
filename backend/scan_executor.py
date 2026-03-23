import asyncio
import boto3
import os
import json
import openpyxl
import pathlib
from typing import Dict, Any
import scanners
from .utils import validate_account_id, validate_role_name
from .s3_history import save_scan_history
from .session_manager import get_session_identity_key, get_session_user_category

CONFIG_PATH = pathlib.Path(__file__).parent.parent / "config.json"
if CONFIG_PATH.exists():
    with open(CONFIG_PATH) as f:
        CONFIG = json.load(f)
else:
    CONFIG = {}

def get_boto_session(session: dict) -> boto3.Session:
    creds = session.get("credentials")
    if creds:
        return boto3.Session(
            aws_access_key_id=creds.get("aws_access_key_id"),
            aws_secret_access_key=creds.get("aws_secret_access_key"),
            aws_session_token=creds.get("aws_session_token"),
            region_name=session.get("region", "us-east-1")
        )
    # SSO — use HOME override for aws config file
    home = session["home_dir"]
    os.environ["AWS_CONFIG_FILE"] = os.path.join(home, ".aws", "config")
    os.environ["AWS_SHARED_CREDENTIALS_FILE"] = os.path.join(home, ".aws", "credentials")
    return boto3.Session(region_name=session.get("region", "us-east-1"))


async def _sso_call_with_retry(fn, *args, retries=3, **kwargs):
    """Call a sync boto3 function in a thread, retrying on throttling with exponential backoff."""
    for attempt in range(retries):
        try:
            return await asyncio.to_thread(fn, *args, **kwargs)
        except Exception as e:
            err = str(e)
            if attempt < retries - 1 and ("Throttling" in err or "TooManyRequests" in err or "SlowDown" in err or "Rate exceeded" in err):
                await asyncio.sleep(2 ** attempt)  # 1s, 2s, 4s
                continue
            raise


async def _prefetch_sso_sessions_for_scan(account_ids: list, sso_token: str, sso_region: str) -> dict:
    """Pre-fetch per-account SSO credentials concurrently before scanning (SSO Token mode)."""
    sso_client = boto3.client("sso", region_name=sso_region)

    def role_priority(r):
        name = r.get("roleName", "").lower()
        if name == "administratoraccess": return 0
        if "admin" in name: return 1
        return 2

    async def get_one(account_id):
        try:
            # Paginate list_account_roles with retry
            role_list = []
            kwargs = {"accessToken": sso_token, "accountId": account_id}
            while True:
                resp = await _sso_call_with_retry(sso_client.list_account_roles, **kwargs)
                role_list.extend(resp.get("roleList", []))
                next_token = resp.get("nextToken")
                if not next_token:
                    break
                kwargs["nextToken"] = next_token

            if not role_list:
                print(f"[SSO prefetch] No permission sets found for account {account_id}")
                return account_id, None

            # Try roles in priority order — some may be blocked by MFA/SCP; retry on throttle
            for role in sorted(role_list, key=role_priority):
                try:
                    rc = await _sso_call_with_retry(
                        sso_client.get_role_credentials,
                        accessToken=sso_token, accountId=account_id, roleName=role["roleName"]
                    )
                    r = rc["roleCredentials"]
                    session = boto3.Session(
                        aws_access_key_id=r['accessKeyId'],
                        aws_secret_access_key=r['secretAccessKey'],
                        aws_session_token=r['sessionToken'],
                    )
                    print(f"[SSO prefetch] {account_id} → {role['roleName']}")
                    return account_id, (session, role["roleName"])
                except Exception as role_err:
                    err = str(role_err)
                    if "Throttling" in err or "TooManyRequests" in err:
                        print(f"[SSO prefetch] {account_id}/{role['roleName']} throttled after retries")
                    else:
                        print(f"[SSO prefetch] {account_id}/{role['roleName']} blocked: {err[:80]}")
                    continue

            print(f"[SSO prefetch] All roles exhausted for account {account_id}")
            return account_id, None
        except Exception as e:
            print(f"[SSO prefetch] Failed for account {account_id}: {e}")
            return account_id, None

    # Reduced semaphore to avoid hammering SSO API (throttling source)
    sem = asyncio.Semaphore(20)
    async def bounded(account_id):
        async with sem:
            return await get_one(account_id)

    results = await asyncio.gather(*[bounded(aid) for aid in account_ids])
    return dict(results)

async def run_scan(run_id: str, session: dict, data: Any, scan_state: Dict[str, Any], sio):
    room = session["session_id"]  # emit to session room — frontend is already joined there
    try:
        boto_session = get_boto_session(session)
        accounts = data.accounts
        if not accounts:
            accounts = ["current"]

        auth_mode = session.get("auth_mode", "IAM")
        total_accounts = len(accounts)

        # For SSO Token mode: pre-fetch all per-account credentials before scanning
        sso_sessions: dict = {}
        if auth_mode == "SSO":
            from .account_discovery import _read_sso_token
            sso_token = _read_sso_token(session["home_dir"], session.get("sso_url", ""))
            sso_region = session.get("sso_region", "us-east-1")
            if sso_token:
                await sio.emit('scan_log', {'run_id': run_id, 'log': f'INFO | Pre-fetching SSO credentials for {len(accounts)} accounts...'}, room=room)
                non_current = [a for a in accounts if a != "current"]
                sso_sessions = await _prefetch_sso_sessions_for_scan(non_current, sso_token, sso_region)
                resolved = sum(1 for v in sso_sessions.values() if v)
                await sio.emit('scan_log', {'run_id': run_id, 'log': f'INFO | SSO credentials resolved for {resolved}/{len(non_current)} accounts.'}, room=room)

        for i, account_id in enumerate(accounts):
            if scan_state[run_id]["status"] == "aborted":
                await sio.emit('scan_log', {'run_id': run_id, 'log': 'WARN | Scan aborted by user'}, room=room)
                break

            if account_id != "current" and not validate_account_id(account_id):
                await sio.emit('scan_log', {'run_id': run_id, 'log': f'ERROR | Invalid account ID: {account_id}'}, room=room)
                continue

            await sio.emit('scan_log', {'run_id': run_id, 'log': f'INFO | Scanning account {account_id}...'}, room=room)

            # For SSO Token mode: use pre-fetched per-account session
            if auth_mode == "SSO" and account_id != "current":
                sso_result = sso_sessions.get(account_id)
                if not sso_result:
                    await sio.emit('scan_log', {'run_id': run_id, 'log': f'WARN | Skipping account {account_id} — no SSO access (no permission set assigned)'}, room=room)
                    continue
                target_session, used_role = sso_result
                await sio.emit('scan_log', {'run_id': run_id, 'log': f'INFO | Account {account_id} — using SSO role: {used_role}'}, room=room)
            else:
                target_session = boto_session

            role_name = session.get("role_name") or CONFIG.get("aws", {}).get("role_name", "")
            external_id = session.get("external_id", "")
            if auth_mode != "SSO" and account_id != "current" and role_name:
                if not validate_role_name(role_name):
                    await sio.emit('scan_log', {'run_id': run_id, 'log': f'ERROR | Invalid role name: {role_name}'}, room=room)
                    continue
                try:
                    sts = boto_session.client('sts')
                    role_arn = f"arn:aws:iam::{account_id}:role/{role_name}"
                    assume_kwargs = {"RoleArn": role_arn, "RoleSessionName": "CloudOpsScan"}
                    if external_id:
                        assume_kwargs["ExternalId"] = external_id
                    resp = sts.assume_role(**assume_kwargs)
                    creds = resp['Credentials']
                    target_session = boto3.Session(
                        aws_access_key_id=creds['AccessKeyId'],
                        aws_secret_access_key=creds['SecretAccessKey'],
                        aws_session_token=creds['SessionToken']
                    )
                except Exception as e:
                    err = str(e)
                    if "AccessDenied" in err:
                        if not external_id:
                            hint = "AccessDenied — role exists but trust policy may require an External ID. Add it at login and retry."
                        else:
                            hint = "AccessDenied — role may not exist in this account, or trust policy does not allow your identity."
                    elif "NoSuchEntity" in err or "does not exist" in err.lower():
                        hint = f"Role '{role_name}' does not exist in account {account_id}."
                    else:
                        hint = err
                    await sio.emit('scan_log', {'run_id': run_id, 'log': f'WARN | Skipping account {account_id} — cannot assume role: {hint}'}, room=room)
                    continue
                    # Don't skip — fall through with boto_session (direct access)
            
            # Resolve regions to scan
            default_region = CONFIG.get("aws", {}).get("default_region", "us-east-1")
            requested = getattr(data, "regions", [])
            if not requested or requested == ["default"]:
                scan_regions = [default_region]
            elif "all" in requested:
                try:
                    ec2 = target_session.client("ec2", region_name=default_region)
                    scan_regions = [r["RegionName"] for r in ec2.describe_regions()["Regions"]]
                except Exception:
                    scan_regions = [default_region]
            else:
                scan_regions = requested

            # Run scanners across all selected regions
            for region in scan_regions:
                for scanner in scanners.get_all_scanners():
                    if scanner.SCANNER_NAME in data.services or "All" in data.services:
                        for output in scanner.run(target_session, account_id, region, idle_days=data.idle_days):
                            if output.startswith("RESULT | "):
                                result = json.loads(output.replace("RESULT | ", ""))
                                scan_state[run_id]["results"].append(result)
                            else:
                                if output.startswith("ERROR |") and "AuthFailure" in output:
                                    output = f"WARN | Skipping {region} for {account_id} — region not enabled or not accessible"
                                await sio.emit('scan_log', {'run_id': run_id, 'log': output}, room=room)
            
            scan_state[run_id]["progress"] = int(((i + 1) / total_accounts) * 100)
            await sio.emit('scan_progress', {'run_id': run_id, 'progress': scan_state[run_id]["progress"]}, room=room)
            
        if scan_state[run_id]["status"] != "aborted":
            scan_state[run_id]["status"] = "completed"
            scan_state[run_id]["metrics"]["total"] = len(scan_state[run_id]["results"])
            await sio.emit('scan_log', {'run_id': run_id, 'log': 'SUCCESS | Scan completed.'}, room=room)
            
            # Generate reports
            generate_reports(run_id, scan_state[run_id]["results"])
            
            # Save to S3 history if configured
            s3_config = CONFIG.get("s3_upload", {})
            identity_key = get_session_identity_key(session["session_id"])
            category = get_session_user_category(session["session_id"])
            if identity_key and s3_config.get("enabled") and s3_config.get("bucket"):
                save_scan_history(
                    identity_key,
                    category,
                    run_id,
                    data.dict() if hasattr(data, 'dict') else data,
                    scan_state[run_id]["results"],
                    s3_config,
                )
            
    except Exception as e:
        scan_state[run_id]["status"] = "error"
        await sio.emit('scan_log', {'run_id': run_id, 'log': f'ERROR | {str(e)}'}, room=room)

def generate_reports(run_id, results):
    report_dir = f"/tmp/reports/{run_id}"
    os.makedirs(report_dir, exist_ok=True)
    
    # Excel
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Findings"
    ws.append(["Resource ID", "Type", "Account", "Status", "Optimization", "Action"])
    for r in results:
        ws.append([r.get("id"), r.get("type"), r.get("account"), r.get("status"), r.get("optimization"), r.get("action")])
    wb.save(os.path.join(report_dir, "report.xlsx"))
    
    # HTML
    html = "<html><body><h1>Scan Report</h1><table border='1'><tr><th>Resource ID</th><th>Type</th><th>Account</th><th>Status</th></tr>"
    for r in results:
        html += f"<tr><td>{r.get('id')}</td><td>{r.get('type')}</td><td>{r.get('account')}</td><td>{r.get('status')}</td></tr>"
    html += "</table></body></html>"
    with open(os.path.join(report_dir, "report.html"), "w") as f:
        f.write(html)
