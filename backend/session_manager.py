import os
import uuid
import shutil
import time
import json
import hashlib
from typing import Dict
from .utils import validate_uuid

SESSIONS_DIR = "/tmp/sessions"
CREDENTIAL_STORE: Dict[str, dict] = {}   # session_id → credentials (IAM, in-memory only)
IDENTITY_STORE: Dict[str, str] = {}     # session_id → identity_hash (unused for S3, kept for lookup)
IDENTITY_KEY_STORE: Dict[str, str] = {} # session_id → plain identity_key (email or IAM username)
USER_CATEGORY_STORE: Dict[str, str] = {}# session_id → GlobalAdmin | CloudOps | Users

def set_session_identity(session_id: str, identity_key: str):
    clean = identity_key.lower().strip()
    identity_hash = hashlib.sha256(clean.encode()).hexdigest()
    IDENTITY_STORE[session_id] = identity_hash
    IDENTITY_KEY_STORE[session_id] = clean

def get_session_identity_hash(session_id: str) -> str | None:
    return IDENTITY_STORE.get(session_id)

def get_session_identity_key(session_id: str) -> str | None:
    return IDENTITY_KEY_STORE.get(session_id)

def set_session_user_category(session_id: str, category: str):
    valid = {"GlobalAdmin", "CloudOps", "Users"}
    USER_CATEGORY_STORE[session_id] = category if category in valid else "Users"

def get_session_user_category(session_id: str) -> str:
    return USER_CATEGORY_STORE.get(session_id, "Users")

def create_session(auth_data: dict) -> str:
    session_id = str(uuid.uuid4())
    session_dir = os.path.join(SESSIONS_DIR, session_id)
    aws_dir = os.path.join(session_dir, ".aws")
    os.makedirs(aws_dir, exist_ok=True)

    # Copy host ~/.aws/config into the session dir so `aws sso login` can find
    # named SSO sessions (e.g. CloudScriptSSO) without any user typing.
    # The host dir is mounted read-only at /root/.aws — we copy config only (not credentials).
    host_config = "/root/.aws/config"
    if os.path.exists(host_config):
        shutil.copy2(host_config, os.path.join(aws_dir, "config"))
        os.makedirs(os.path.join(aws_dir, "sso", "cache"), exist_ok=True)

    # Store session metadata (no credentials here — IAM creds go to CREDENTIAL_STORE only)
    meta = {
        "session_id": session_id,
        "auth_mode": auth_data.get("auth_mode"),
        "home_dir": session_dir,
        "created_at": time.time(),
        "sso_url": auth_data.get("sso_url", ""),
        "sso_session_name": auth_data.get("sso_session_name", ""),
        "sso_region": auth_data.get("sso_region", "us-east-1"),
        "role_name": auth_data.get("role_name", ""),
        "external_id": auth_data.get("external_id", ""),
        "region": auth_data.get("region", ""),
    }
    with open(os.path.join(session_dir, "session.json"), "w") as f:
        json.dump(meta, f)

    # Store credentials in memory ONLY — never write to disk
    # SSO_ROLE users paste Option 2 creds (access_key + secret_key + session_token),
    # so we store for any auth mode where credentials were provided
    if auth_data.get("access_key") and auth_data.get("secret_key"):
        CREDENTIAL_STORE[session_id] = {
            "aws_access_key_id": auth_data.get("access_key"),
            "aws_secret_access_key": auth_data.get("secret_key"),
            "aws_session_token": auth_data.get("session_token")
        }
                
    return session_id

def get_session(session_id: str) -> dict:
    if not validate_uuid(session_id):
        return None
    session_dir = os.path.join(SESSIONS_DIR, session_id)
    if not os.path.exists(session_dir):
        return None
    meta_path = os.path.join(session_dir, "session.json")
    session = {}
    if os.path.exists(meta_path):
        with open(meta_path) as f:
            session = json.load(f)
    # Attach in-memory credentials if available
    if session_id in CREDENTIAL_STORE:
        session["credentials"] = CREDENTIAL_STORE[session_id]
    return session

def cleanup_sessions(timeout_minutes=60):
    now = time.time()
    if not os.path.exists(SESSIONS_DIR):
        return
    for session_id in os.listdir(SESSIONS_DIR):
        session_dir = os.path.join(SESSIONS_DIR, session_id)
        if os.path.isdir(session_dir):
            mtime = os.path.getmtime(session_dir)
            if (now - mtime) > (timeout_minutes * 60):
                shutil.rmtree(session_dir, ignore_errors=True)
                CREDENTIAL_STORE.pop(session_id, None)
                IDENTITY_STORE.pop(session_id, None)
                IDENTITY_KEY_STORE.pop(session_id, None)
                USER_CATEGORY_STORE.pop(session_id, None)
