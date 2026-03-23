import os
import uuid
import json
import asyncio
import boto3
import re
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import socketio
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from contextlib import asynccontextmanager

from .session_manager import (
    create_session, get_session, cleanup_sessions,
    set_session_identity, get_session_identity_key,
    set_session_user_category, get_session_user_category
)
from .s3_history import list_scan_history, get_scan_history_detail
from .scan_executor import run_scan
from .account_discovery import discover_accounts
from .terminal_handler import TerminalHandler
from .utils import validate_uuid
import scanners

# Load config
CONFIG = {}
config_path = os.path.join(os.getcwd(), "config.json")
if os.path.exists(config_path):
    with open(config_path, "r") as f:
        CONFIG = json.load(f)
else:
    print("Warning: config.json not found. Using empty config.")

@asynccontextmanager
async def lifespan(app):
    # Secure the sessions directory
    os.makedirs("/tmp/sessions", exist_ok=True)
    os.chmod("/tmp/sessions", 0o700)
    os.makedirs("/tmp/reports", exist_ok=True)
    os.chmod("/tmp/reports", 0o700)

    # Start background cleanup task
    async def cleanup_loop():
        while True:
            await asyncio.sleep(300)  # every 5 minutes
            cleanup_sessions(timeout_minutes=CONFIG.get("session_timeout_minutes", 60))
    cleanup_task = asyncio.create_task(cleanup_loop())
    yield
    cleanup_task.cancel()

app = FastAPI(title="CloudOps Console API", lifespan=lifespan)
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
socket_app = socketio.ASGIApp(sio, app)

CORS_ORIGINS = ["http://localhost:3000"] if os.getenv("ENV") != "production" else [os.getenv("FRONTEND_URL", "http://localhost:8080")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory state
scan_state: Dict[str, Any] = {}
run_ownership: Dict[str, str] = {}  # run_id → session_id
terminals: Dict[str, TerminalHandler] = {}

async def require_session(session_id: str = None, request: Request = None):
    # Try to get session_id from query params or body
    if not session_id:
        # Check body for JSON
        try:
            body = await request.json()
            session_id = body.get("session_id")
        except:
            pass
    
    if not session_id:
        # Check query params
        session_id = request.query_params.get("session_id")

    if not session_id:
        raise HTTPException(status_code=401, detail="Session ID required")
    
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return session

def verify_run_ownership(run_id: str, session_id: str) -> bool:
    return run_ownership.get(run_id) == session_id

class SessionCreate(BaseModel):
    auth_mode: str
    access_key: Optional[str] = None
    secret_key: Optional[str] = None
    session_token: Optional[str] = None
    sso_url: Optional[str] = None
    sso_session_name: Optional[str] = None
    sso_region: Optional[str] = "us-east-1"
    role_name: Optional[str] = None
    external_id: Optional[str] = None
    region: Optional[str] = None
    user_category: Optional[str] = "Users"

class ScanStart(BaseModel):
    session_id: str
    services: List[str]
    scope: str
    accounts: List[str]
    idle_days: int
    regions: List[str] = []  # [] = default region, ["all"] = all regions, or explicit list

@app.get("/api/config")
async def get_config():
    return CONFIG

@app.get("/api/session/init")
async def init_session():
    # Create anonymous pre-session, return UUID
    session_id = str(uuid.uuid4())
    return {"session_id": session_id}

@app.get("/api/session/status")
async def session_status(session_id: str):
    """Check if an existing session is still alive in-memory (page refresh recovery)."""
    if not validate_uuid(session_id):
        return {"valid": False}
    session = get_session(session_id)
    if not session:
        return {"valid": False}
    identity_key = get_session_identity_key(session_id)
    if not identity_key:
        return {"valid": False}
    return {
        "valid": True,
        "identity": identity_key,
        "user_category": get_session_user_category(session_id),
        "auth_mode": session.get("auth_mode"),
    }

@app.post("/api/session")
async def create_session_endpoint(data: SessionCreate):
    session_id = create_session(data.dict())
    set_session_user_category(session_id, data.user_category or "Users")
    return {"session_id": session_id}

@app.post("/api/auth/validate")
async def validate_auth(data: dict, session: dict = Depends(require_session)):
    home = session["home_dir"]
    try:
        creds = session.get("credentials")
        if creds:
            # IAM mode: use explicit credentials from CREDENTIAL_STORE
            sts = boto3.Session(
                aws_access_key_id=creds.get("aws_access_key_id"),
                aws_secret_access_key=creds.get("aws_secret_access_key"),
                aws_session_token=creds.get("aws_session_token")
            ).client('sts')
        else:
            # SSO mode: exchange SSO token for temp credentials, then STS identity
            # The session's .aws/ dir has no profile — we use the token API directly
            from .account_discovery import _read_sso_token
            sso_start_url = session.get("sso_url", "")
            sso_region = session.get("sso_region", "us-east-1")
            role_name = session.get("role_name", "")

            token = _read_sso_token(home, sso_start_url)
            if not token:
                raise Exception("SSO token not found. Please complete 'aws sso login' in the terminal first.")

            sso_client = boto3.client("sso", region_name=sso_region)

            # Try to find the hub account + role from the copied ~/.aws/config profiles.
            # This picks the first profile that belongs to the configured SSO session
            # (e.g. GlobalAdminAccess under CloudScriptSSO) without hardcoding anything.
            import configparser
            auth_account_id = None
            auth_role_name = None
            config_file = os.path.join(home, ".aws", "config")
            if os.path.exists(config_file):
                cfg = configparser.ConfigParser()
                cfg.read(config_file)
                sso_session_name = session.get("sso_session_name", "")
                for section in cfg.sections():
                    if not section.startswith("profile "):
                        continue
                    s = cfg[section]
                    if sso_session_name and s.get("sso_session") != sso_session_name:
                        continue
                    if s.get("sso_account_id") and s.get("sso_role_name"):
                        auth_account_id = s.get("sso_account_id")
                        auth_role_name = s.get("sso_role_name")
                        break

            # Fall back to first accessible account via SSO portal API
            if not auth_account_id:
                paginator = sso_client.get_paginator("list_accounts")
                for page in paginator.paginate(accessToken=token):
                    for acc in page.get("accountList", []):
                        auth_account_id = acc["accountId"]
                        break
                    if auth_account_id:
                        break
            if not auth_account_id:
                raise Exception("No AWS accounts found for this SSO session.")

            # Fall back to first available role if not found from config
            if not auth_role_name:
                roles_resp = sso_client.list_account_roles(accessToken=token, accountId=auth_account_id)
                roles = roles_resp.get("roleList", [])
                if not roles:
                    raise Exception("No roles found for account.")
                auth_role_name = roles[0]["roleName"]

            # Exchange SSO token for temporary credentials
            creds_resp = sso_client.get_role_credentials(
                accessToken=token, accountId=auth_account_id, roleName=auth_role_name
            )
            role_creds = creds_resp["roleCredentials"]

            # Store credentials so scan_executor can use them for role assumption
            from .session_manager import CREDENTIAL_STORE
            CREDENTIAL_STORE[session["session_id"]] = {
                "aws_access_key_id": role_creds["accessKeyId"],
                "aws_secret_access_key": role_creds["secretAccessKey"],
                "aws_session_token": role_creds["sessionToken"],
            }

            sts = boto3.Session(
                aws_access_key_id=role_creds["accessKeyId"],
                aws_secret_access_key=role_creds["secretAccessKey"],
                aws_session_token=role_creds["sessionToken"],
            ).client("sts")

        identity = sts.get_caller_identity()
        arn = identity.get("Arn", "")
        # IAM:  arn:aws:iam::123456789:user/john.doe              → john.doe
        # SSO:  arn:aws:sts::123456789:assumed-role/Role/john@co  → john@co
        identity_key = arn.split("/")[-1] if "/" in arn else arn
        set_session_identity(session["session_id"], identity_key)
        return {"authenticated": True, "identity": identity_key}
    except Exception as e:
        return {"authenticated": False, "error": str(e)}

async def _poll_sso_token(session_id: str, home: str, oidc_client, client_id: str, client_secret: str, device_code: str, interval: int, sso_start_url: str, sso_region: str):
    """Poll AWS OIDC until the user approves in their browser, then cache the token."""
    import hashlib
    from datetime import datetime, timezone, timedelta
    while True:
        await asyncio.sleep(interval)
        try:
            resp = await asyncio.to_thread(
                oidc_client.create_token,
                clientId=client_id,
                clientSecret=client_secret,
                grantType="urn:ietf:params:oauth:grant-type:device_code",
                deviceCode=device_code,
            )
            access_token = resp["accessToken"]
            expires_in = resp.get("expiresIn", 28800)

            # Cache token in session dir (same place _read_sso_token looks)
            cache_dir = os.path.join(home, ".aws", "sso", "cache")
            os.makedirs(cache_dir, exist_ok=True)
            cache_key = hashlib.sha1(sso_start_url.encode()).hexdigest()
            token_data = {
                "startUrl": sso_start_url,
                "region": sso_region,
                "accessToken": access_token,
                "expiresAt": (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
            with open(os.path.join(cache_dir, f"{cache_key}.json"), "w") as f:
                json.dump(token_data, f)

            await sio.emit("sso_authorized", {"session_id": session_id}, room=session_id)
            print(f"[SSO] Token received and cached for session {session_id}")
            break
        except Exception as e:
            err = str(e)
            if "AuthorizationPending" in err or "authorization_pending" in err:
                continue
            elif "SlowDown" in err or "slow_down" in err:
                interval = min(interval + 5, 30)
                continue
            else:
                await sio.emit("sso_error", {"error": err}, room=session_id)
                print(f"[SSO] Polling error for session {session_id}: {err}")
                break


@app.post("/api/auth/sso-start")
async def sso_start(request: Request, session: dict = Depends(require_session)):
    """Start AWS OIDC device authorization flow. Returns a verification URL for the user
    to open in their browser. Backend polls until approved, then emits sso_authorized."""
    sso_start_url = session.get("sso_url", "")
    sso_region = session.get("sso_region", "us-east-1")
    if not sso_start_url:
        raise HTTPException(status_code=400, detail="SSO start URL not configured for this session.")
    try:
        oidc = boto3.client("sso-oidc", region_name=sso_region)
        client_creds = await asyncio.to_thread(
            oidc.register_client, clientName="CloudOpsConsole", clientType="public"
        )
        auth = await asyncio.to_thread(
            oidc.start_device_authorization,
            clientId=client_creds["clientId"],
            clientSecret=client_creds["clientSecret"],
            startUrl=sso_start_url,
        )
        asyncio.create_task(_poll_sso_token(
            session_id=session["session_id"],
            home=session["home_dir"],
            oidc_client=oidc,
            client_id=client_creds["clientId"],
            client_secret=client_creds["clientSecret"],
            device_code=auth["deviceCode"],
            interval=auth.get("interval", 5),
            sso_start_url=sso_start_url,
            sso_region=sso_region,
        ))
        return {
            "verificationUrl": auth["verificationUriComplete"],
            "expiresIn": auth.get("expiresIn", 600),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/config/storage")
async def get_storage_config():
    """Returns S3 storage configuration status (never exposes credentials)."""
    s3 = CONFIG.get("s3_upload", {})
    enabled = s3.get("enabled", False) and bool(s3.get("bucket", ""))
    return {
        "enabled": enabled,
        "mode": s3.get("mode", "env") if enabled else None,
        "bucket": s3.get("bucket", "") if enabled else None,
        "region": s3.get("region", "us-west-2") if enabled else None,
    }

@app.get("/api/history")
async def get_history(session: dict = Depends(require_session)):
    identity_key = get_session_identity_key(session["session_id"])
    if not identity_key:
        return {"history": [], "has_profile": False, "s3_configured": False}

    s3_config = CONFIG.get("s3_upload", {})
    if not s3_config.get("enabled") or not s3_config.get("bucket"):
        return {"history": [], "has_profile": True, "s3_configured": False}

    category = get_session_user_category(session["session_id"])
    history = list_scan_history(identity_key, category, s3_config)
    return {"history": history, "has_profile": True, "s3_configured": True}

@app.get("/api/history/{run_id}")
async def get_history_detail(run_id: str, session: dict = Depends(require_session)):
    identity_key = get_session_identity_key(session["session_id"])
    if not identity_key:
        raise HTTPException(status_code=403, detail="Access denied")

    s3_config = CONFIG.get("s3_upload", {})
    if not s3_config.get("enabled") or not s3_config.get("bucket"):
        raise HTTPException(status_code=404, detail="History bucket not configured")

    category = get_session_user_category(session["session_id"])
    findings = get_scan_history_detail(identity_key, category, run_id, s3_config)
    return {"findings": findings}

@app.get("/api/scanners")
async def list_scanners():
    return [{"id": s.SCANNER_NAME, "description": s.SCANNER_DESCRIPTION} for s in scanners.get_all_scanners()]

@app.get("/api/accounts")
async def get_accounts(session_id: str, session: dict = Depends(require_session)):
    accounts = discover_accounts(session)
    return {"accounts": accounts}

class AccountSummaryRequest(BaseModel):
    session_id: str
    accounts: List[Dict[str, str]]

async def _sso_call_with_retry(fn, *args, retries=3, **kwargs):
    """Call a sync boto3 function in a thread, retrying on throttling with exponential backoff."""
    for attempt in range(retries):
        try:
            return await asyncio.to_thread(fn, *args, **kwargs)
        except Exception as e:
            err = str(e)
            if attempt < retries - 1 and ("Throttling" in err or "TooManyRequests" in err or "SlowDown" in err or "Rate exceeded" in err):
                await asyncio.sleep(2 ** attempt)
                continue
            raise


async def _prefetch_sso_sessions(accounts: list, sso_token: str, sso_region: str, default_region: str) -> dict:
    """Phase 1: fetch SSO credentials for all accounts concurrently with retry on throttle."""
    sso_client = boto3.client("sso", region_name=sso_region)

    def role_priority(r):
        name = r.get("roleName", "").lower()
        if name == "administratoraccess": return 0
        if "admin" in name: return 1
        return 2

    async def get_one(account):
        try:
            role_list = []
            kwargs = {"accessToken": sso_token, "accountId": account['id']}
            while True:
                resp = await _sso_call_with_retry(sso_client.list_account_roles, **kwargs)
                role_list.extend(resp.get("roleList", []))
                next_token = resp.get("nextToken")
                if not next_token:
                    break
                kwargs["nextToken"] = next_token

            if not role_list:
                print(f"[SSO prefetch] No permission sets found for account {account['id']}")
                return account['id'], None

            for role in sorted(role_list, key=role_priority):
                try:
                    rc = await _sso_call_with_retry(
                        sso_client.get_role_credentials,
                        accessToken=sso_token, accountId=account['id'], roleName=role["roleName"]
                    )
                    r = rc["roleCredentials"]
                    return account['id'], boto3.Session(
                        aws_access_key_id=r['accessKeyId'],
                        aws_secret_access_key=r['secretAccessKey'],
                        aws_session_token=r['sessionToken'],
                        region_name=default_region,
                    )
                except Exception:
                    continue
            return account['id'], None
        except Exception as e:
            print(f"[SSO prefetch] Failed for account {account['id']}: {e}")
            return account['id'], None

    sem = asyncio.Semaphore(20)
    async def bounded(account):
        async with sem:
            return await get_one(account)

    results = await asyncio.gather(*[bounded(acc) for acc in accounts])
    return dict(results)


def _sso_list_all_roles(sso_client, sso_token: str, account_id: str) -> list:
    """Paginate list_account_roles — returns all roles sorted by privilege (Admin first)."""
    role_list = []
    kwargs = {"accessToken": sso_token, "accountId": account_id}
    while True:
        resp = sso_client.list_account_roles(**kwargs)
        role_list.extend(resp.get("roleList", []))
        next_token = resp.get("nextToken")
        if not next_token:
            break
        kwargs["nextToken"] = next_token

    # Prefer most privileged role: AdministratorAccess first, then anything with Admin, then rest
    def role_priority(r):
        name = r.get("roleName", "").lower()
        if name == "administratoraccess":
            return 0
        if "admin" in name:
            return 1
        return 2

    return sorted(role_list, key=role_priority)


def _sso_get_best_session(sso_client, sso_token: str, account_id: str, role_list: list, default_region: str):
    """Try roles in priority order, return first Session that successfully gets credentials."""
    for role in role_list:
        try:
            r = sso_client.get_role_credentials(
                accessToken=sso_token, accountId=account_id, roleName=role["roleName"]
            )["roleCredentials"]
            return boto3.Session(
                aws_access_key_id=r['accessKeyId'],
                aws_secret_access_key=r['secretAccessKey'],
                aws_session_token=r['sessionToken'],
                region_name=default_region,
            )
        except Exception:
            continue
    return None


def _fetch_account_data_sync(user_boto, account: Dict[str, str], role_name: str, external_id: str, default_region: str, sso_token: str = None, sso_region: str = "us-east-1", prefetched_session=None) -> dict:
    """All blocking boto3 work — runs in a thread pool so the event loop stays free."""
    # If a pre-fetched session was provided (SSO mode phase 2), use it directly
    if prefetched_session is not None:
        boto_session = prefetched_session
    else:
        boto_session = user_boto

    if prefetched_session is not None:
        pass  # credentials already resolved
    elif role_name:
        try:
            sts = user_boto.client("sts")
            role_arn = f"arn:aws:iam::{account['id']}:role/{role_name}"
            assume_kwargs = {"RoleArn": role_arn, "RoleSessionName": "CloudOpsSummary"}
            if external_id:
                assume_kwargs["ExternalId"] = external_id
            assumed_role = sts.assume_role(**assume_kwargs)
            c = assumed_role['Credentials']
            boto_session = boto3.Session(
                aws_access_key_id=c['AccessKeyId'],
                aws_secret_access_key=c['SecretAccessKey'],
                aws_session_token=c['SessionToken'],
                region_name=default_region,
            )
        except Exception:
            # Role assumption failed — fall back to SSO per-account credentials if available
            if sso_token:
                sso_client = boto3.client("sso", region_name=sso_region)
                role_list = _sso_list_all_roles(sso_client, sso_token, account['id'])
                if not role_list:
                    raise Exception("AccessDenied — role not found and no SSO roles available for this account.")
                boto_session = _sso_get_best_session(sso_client, sso_token, account['id'], role_list, default_region)
                if not boto_session:
                    raise Exception("AccessDenied — all SSO roles blocked for this account.")
            else:
                raise
    elif sso_token:
        # No role_name — use SSO per-account credentials directly
        sso_client = boto3.client("sso", region_name=sso_region)
        role_list = _sso_list_all_roles(sso_client, sso_token, account['id'])
        if role_list:
            result = _sso_get_best_session(sso_client, sso_token, account['id'], role_list, default_region)
            if result:
                boto_session = result

    # Cost Explorer
    now = datetime.utcnow()
    first_day_current = now.replace(day=1)
    last_day_prev = first_day_current - timedelta(days=1)
    first_day_prev = last_day_prev.replace(day=1)
    current_start = first_day_current.strftime('%Y-%m-%d')
    current_end = now.strftime('%Y-%m-%d')
    if current_start == current_end:
        current_end = (now + timedelta(days=1)).strftime('%Y-%m-%d')
    prev_start = first_day_prev.strftime('%Y-%m-%d')
    prev_end = first_day_current.strftime('%Y-%m-%d')

    try:
        ce = boto_session.client('ce', region_name='us-east-1')
        current_cost_res = ce.get_cost_and_usage(
            TimePeriod={'Start': current_start, 'End': current_end},
            Granularity='MONTHLY', Metrics=['UnblendedCost']
        )
        current_spend = float(current_cost_res['ResultsByTime'][0]['Total']['UnblendedCost']['Amount'])
        prev_cost_res = ce.get_cost_and_usage(
            TimePeriod={'Start': prev_start, 'End': prev_end},
            Granularity='MONTHLY', Metrics=['UnblendedCost']
        )
        prev_spend = float(prev_cost_res['ResultsByTime'][0]['Total']['UnblendedCost']['Amount'])
        change_pct = ((current_spend - prev_spend) / prev_spend * 100) if prev_spend > 0 else 0.0
        top_services_res = ce.get_cost_and_usage(
            TimePeriod={'Start': current_start, 'End': current_end},
            Granularity='MONTHLY', Metrics=['UnblendedCost'],
            GroupBy=[{'Type': 'DIMENSION', 'Key': 'SERVICE'}]
        )
        services = sorted([
            {"service": g['Keys'][0], "spend": float(g['Metrics']['UnblendedCost']['Amount'])}
            for g in top_services_res['ResultsByTime'][0]['Groups']
        ], key=lambda x: x['spend'], reverse=True)
        top_services = services[:3]
    except Exception as e:
        print(f"CE Error for {account['id']}: {e}")
        current_spend = prev_spend = change_pct = 0.0
        top_services = []

    counts = {"ec2": 0, "s3": 0, "rds": 0}
    try:
        ec2 = boto_session.client('ec2')
        reservations = ec2.describe_instances(
            Filters=[{'Name': 'instance-state-name', 'Values': ['running']}]
        )['Reservations']
        counts["ec2"] = sum(len(r['Instances']) for r in reservations)
    except: pass
    try: counts["s3"] = len(boto_session.client('s3').list_buckets()['Buckets'])
    except: pass
    try:
        counts["rds"] = len([
            db for db in boto_session.client('rds').describe_db_instances()['DBInstances']
            if db['DBInstanceStatus'] == 'available'
        ])
    except: pass

    return {
        "account_id": account['id'],
        "account_name": account['name'],
        "current_month_spend": round(current_spend, 2),
        "last_month_spend": round(prev_spend, 2),
        "change_pct": round(change_pct, 1),
        "top_services": top_services,
        "resource_counts": counts,
        "status": "Active"
    }


async def fetch_account_summary(session_id: str, account: Dict[str, str], session_data: dict, prefetched_session=None):
    try:
        creds = session_data.get("credentials")
        if creds:
            user_boto = boto3.Session(
                aws_access_key_id=creds.get("aws_access_key_id"),
                aws_secret_access_key=creds.get("aws_secret_access_key"),
                aws_session_token=creds.get("aws_session_token"),
            )
        else:
            from .account_discovery import _sso_boto_session
            user_boto = _sso_boto_session(session_data["home_dir"])

        auth_mode = session_data.get("auth_mode", "IAM")
        default_region = CONFIG.get("aws", {}).get("default_region", "us-west-2")
        sso_token = None
        sso_region = session_data.get("sso_region", "us-east-1")

        if auth_mode == "SSO":
            # Pure SSO Token mode — use per-account SSO credentials directly, no role assumption
            from .account_discovery import _read_sso_token
            sso_token = _read_sso_token(session_data["home_dir"], session_data.get("sso_url", ""))
            role_name = ""
            external_id = ""
            user_boto = boto3.Session()  # unused when sso_token is set with no role_name
        else:
            role_name = session_data.get("role_name") or CONFIG.get("aws", {}).get("role_name", "")
            external_id = session_data.get("external_id") or ""
            # Users category in SSO_ROLE mode: fall back to per-account SSO creds if role assumption fails
            user_category = get_session_user_category(session_id)
            if not creds and user_category == "Users":
                from .account_discovery import _read_sso_token
                sso_token = _read_sso_token(session_data["home_dir"], session_data.get("sso_url", ""))

        try:
            # Run all blocking boto3 calls in a thread — keeps event loop free for WebSocket flushes
            summary = await asyncio.to_thread(
                _fetch_account_data_sync, user_boto, account, role_name, external_id, default_region,
                sso_token, sso_region, prefetched_session
            )
            print(f"[Summary] OK {account['id']}")
            await sio.emit('summary_result', summary, room=session_id)

        except Exception as e:
            err = str(e)
            if "AccessDenied" in err:
                hint = ("AccessDenied — trust policy may require an External ID. Add it at login."
                        if not external_id else
                        "AccessDenied — role not found or trust policy does not allow your identity.")
            elif "NoSuchEntity" in err or "does not exist" in err.lower():
                hint = f"Role '{role_name}' does not exist in this account."
            else:
                hint = err[:120]
            print(f"[Summary] DENIED {account['id']}: {err[:80]}")
            await sio.emit('summary_result', {
                "account_id": account['id'],
                "account_name": account['name'],
                "status": "Access Denied",
                "hint": hint,
                "current_month_spend": 0, "last_month_spend": 0, "change_pct": 0,
                "top_services": [], "resource_counts": {"ec2": 0, "s3": 0, "rds": 0}
            }, room=session_id)

    except Exception as e:
        print(f"Summary error for {account['id']}: {e}")

@app.post("/api/accounts/summary")
async def start_account_summary(
    data: AccountSummaryRequest,
    session: dict = Depends(require_session)
):
    # Run in background — two-phase for SSO mode, single-phase for IAM/SSO_ROLE
    async def run_summaries():
        try:
            print(f"[Summary] Starting for {len(data.accounts)} accounts, session={data.session_id}")
            auth_mode = session.get("auth_mode", "IAM")
            prefetched: dict = {}

            if auth_mode == "SSO":
                # Phase 1: fetch all SSO credentials concurrently (semaphore=50, fast API calls)
                from .account_discovery import _read_sso_token
                sso_token = _read_sso_token(session["home_dir"], session.get("sso_url", ""))
                sso_region = session.get("sso_region", "us-east-1")
                default_region = CONFIG.get("aws", {}).get("default_region", "us-west-2")
                if sso_token:
                    print(f"[Summary] Phase 1: prefetching SSO credentials for {len(data.accounts)} accounts")
                    prefetched = await _prefetch_sso_sessions(data.accounts, sso_token, sso_region, default_region)
                    print(f"[Summary] Phase 1 done: {sum(1 for v in prefetched.values() if v)} sessions resolved")

            # Phase 2: run heavy queries with pre-fetched sessions (semaphore=25)
            sem = asyncio.Semaphore(25)
            async def bounded(account):
                async with sem:
                    await fetch_account_summary(data.session_id, account, session,
                                                prefetched_session=prefetched.get(account['id']))
            await asyncio.gather(*[bounded(acc) for acc in data.accounts])
            print(f"[Summary] All done for session={data.session_id}")
        except Exception as e:
            print(f"[Summary] FATAL: {e}")
            import traceback; traceback.print_exc()

    asyncio.create_task(run_summaries())
    return {"status": "started"}

@app.post("/api/scan")
async def start_scan(data: ScanStart, session: dict = Depends(require_session)):
    run_id = str(uuid.uuid4())
    run_ownership[run_id] = data.session_id  # record owner
    scan_state[run_id] = {
        "status": "running",
        "progress": 0,
        "results": [],
        "metrics": {"total": 0, "optimized": 0, "savings": "$0.00", "risk": "Low"}
    }
    
    asyncio.create_task(run_scan(run_id, session, data, scan_state, sio))
    return {"run_id": run_id}

@app.get("/api/scan/{run_id}/status")
async def scan_status(run_id: str, session_id: str):
    if not verify_run_ownership(run_id, session_id):
        raise HTTPException(status_code=403, detail="Access denied")
    if run_id not in scan_state:
        raise HTTPException(status_code=404, detail="Scan not found")
    return scan_state[run_id]

@app.post("/api/scan/{run_id}/stop")
async def stop_scan(run_id: str, data: dict):
    if not verify_run_ownership(run_id, data.get("session_id", "")):
        raise HTTPException(status_code=403, detail="Access denied")
    if run_id in scan_state:
        scan_state[run_id]["status"] = "aborted"
    return {"success": True}

@app.get("/api/scan/{run_id}/report/xlsx")
async def download_xlsx(run_id: str, session_id: str):
    if not verify_run_ownership(run_id, session_id):
        raise HTTPException(status_code=403, detail="Access denied")
    if not validate_uuid(run_id):
        raise HTTPException(status_code=400, detail="Invalid run ID")
    path = f"/tmp/reports/{run_id}/report.xlsx"
    if os.path.exists(path):
        return FileResponse(path, filename=f"scan_report_{run_id}.xlsx")
    raise HTTPException(status_code=404, detail="Report not found")

@app.get("/api/scan/{run_id}/report/html")
async def download_html(run_id: str, session_id: str):
    if not verify_run_ownership(run_id, session_id):
        raise HTTPException(status_code=403, detail="Access denied")
    if not validate_uuid(run_id):
        raise HTTPException(status_code=400, detail="Invalid run ID")
    path = f"/tmp/reports/{run_id}/report.html"
    if os.path.exists(path):
        return FileResponse(path, filename=f"scan_report_{run_id}.html")
    raise HTTPException(status_code=404, detail="Report not found")

@sio.on('connect')
async def connect(sid, environ):
    pass

@sio.on('join_session')
async def join_session(sid, data):
    session_id = data.get('session_id')
    if session_id:
        await sio.enter_room(sid, session_id)
        print(f"[Socket] {sid} joined room {session_id}")

@sio.on('disconnect')
async def disconnect(sid):
    # Cleanup terminal if exists
    for session_id, term in list(terminals.items()):
        if term.sid == sid:
            term.close()
            del terminals[session_id]

@sio.on('terminal_start')
async def terminal_start(sid, data):
    session_id = data.get('session_id')
    session = get_session(session_id)

    # Read the SSO session name from the *copied* ~/.aws/config in the session dir.
    # This is authoritative — config.json may have a different/stale name.
    sso_session_name = ""
    if session:
        import configparser
        config_file = os.path.join(session["home_dir"], ".aws", "config")
        if os.path.exists(config_file):
            cfg = configparser.ConfigParser()
            cfg.read(config_file)
            for section in cfg.sections():
                if section.startswith("sso-session "):
                    sso_session_name = section[len("sso-session "):]
                    break
        if not sso_session_name:
            sso_session_name = session.get("sso_session_name", "")
        print(f"[Terminal] Starting SSO login — session name: '{sso_session_name}'")

    term = TerminalHandler(session_id, sid, sio, sso_session_name=sso_session_name)
    terminals[session_id] = term
    await term.start()

@sio.on('terminal_input')
async def terminal_input(sid, data):
    session_id = data.get('session_id')
    if session_id in terminals:
        await terminals[session_id].write(data.get('input', ''))

# Serve frontend static files in production (built by Docker)
frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.exists(frontend_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist, "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_frontend(full_path: str):
        # Serve any static file from dist root (logo, favicon, etc.) if it exists
        static_file = os.path.join(frontend_dist, full_path)
        if full_path and os.path.isfile(static_file):
            return FileResponse(static_file)
        # Fall back to SPA index for all other paths
        return FileResponse(os.path.join(frontend_dist, "index.html"))

# Mount socket app
app = socket_app
