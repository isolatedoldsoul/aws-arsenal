import boto3
import botocore.credentials
import glob
import json
import os
from datetime import datetime, timezone


def _sso_boto_session(home: str) -> boto3.Session:
    """Build a boto3 session for SSO users that uses the session's .aws/ dir
    and ignores any server-level env var credentials (S3 bucket creds)."""
    import botocore.session as bcs
    bc = bcs.Session()
    # Strip the EnvProvider so server AWS_ACCESS_KEY_ID doesn't shadow user creds
    resolver = bc.get_component('credential_provider')
    resolver.providers = [
        p for p in resolver.providers
        if not isinstance(p, botocore.credentials.EnvProvider)
    ]
    bc.set_config_variable("config_file", os.path.join(home, ".aws", "config"))
    bc.set_config_variable("credentials_file", os.path.join(home, ".aws", "credentials"))
    return boto3.Session(botocore_session=bc)


def _read_sso_token(home_dir: str, sso_start_url: str) -> str | None:
    """Read cached SSO access token from ~/.aws/sso/cache/ after aws sso login.

    Checks two locations (in order):
      1. Session-local cache — /tmp/sessions/{id}/.aws/sso/cache/  (terminal-based login)
      2. Host cache — /root/.aws/sso/cache/ (mounted from ~/.aws; login run on the host Mac)

    Within each location: exact startUrl match preferred, first valid token as fallback.
    This handles the Docker networking issue where the OAuth callback can't reach a
    server running inside the container from the host browser.
    """
    def _scan_cache(cache_dir: str) -> str | None:
        if not os.path.exists(cache_dir):
            return None
        fallback = None
        for cache_file in glob.glob(os.path.join(cache_dir, "*.json")):
            try:
                with open(cache_file) as f:
                    data = json.load(f)
                expires_at = data.get("expiresAt", "")
                if expires_at:
                    expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                    if expiry < datetime.now(timezone.utc):
                        continue
                token = data.get("accessToken")
                if not token:
                    continue
                if sso_start_url and data.get("startUrl") == sso_start_url:
                    return token
                if fallback is None:
                    fallback = token
            except Exception:
                continue
        return fallback

    # 1. Session-local cache (terminal ran inside container)
    token = _scan_cache(os.path.join(home_dir, ".aws", "sso", "cache"))
    if token:
        return token

    # 2. Host cache (user ran `aws sso login` on their Mac; mounted at /root/.aws)
    return _scan_cache("/root/.aws/sso/cache")


def discover_accounts(session: dict) -> list:
    home = session["home_dir"]
    auth_mode = session.get("auth_mode", "IAM")
    sso_start_url = session.get("sso_url", "")
    sso_region = session.get("sso_region", "us-east-1")

    creds = session.get("credentials")
    if creds:
        # IAM mode: use explicit credentials
        boto_session = boto3.Session(
            aws_access_key_id=creds.get("aws_access_key_id"),
            aws_secret_access_key=creds.get("aws_secret_access_key"),
            aws_session_token=creds.get("aws_session_token"),
        )
    else:
        # SSO mode: use session's .aws/ dir, stripping server env var creds
        boto_session = _sso_boto_session(home)

    accounts: dict[str, dict] = {}  # id → account dict

    # 1. SSO token — exact same list as the AWS SSO portal shows the user
    if auth_mode in ("SSO", "SSO_ROLE") and sso_start_url:
        token = _read_sso_token(home, sso_start_url)
        if token:
            try:
                sso = boto_session.client("sso", region_name=sso_region)
                paginator = sso.get_paginator("list_accounts")
                for page in paginator.paginate(accessToken=token):
                    for acc in page.get("accountList", []):
                        accounts[acc["accountId"]] = {
                            "id": acc["accountId"],
                            "name": acc["accountName"],
                            "source": "sso",
                        }
            except Exception as e:
                print(f"SSO account listing failed: {e}")

    # 2. Organizations — works for GlobalAdmins / CloudOps with org-level access
    # Merges any accounts not already found via SSO
    try:
        org = boto_session.client("organizations")
        paginator = org.get_paginator("list_accounts")
        for page in paginator.paginate():
            for acc in page["Accounts"]:
                if acc["Status"] == "ACTIVE" and acc["Id"] not in accounts:
                    accounts[acc["Id"]] = {
                        "id": acc["Id"],
                        "name": acc["Name"],
                        "source": "organizations",
                    }
    except Exception as e:
        print(f"Organizations listing skipped (no access): {e}")

    # 3. Fall back to current account if nothing found (e.g. IAM user scoped to one account)
    if not accounts:
        try:
            sts = boto_session.client("sts")
            identity = sts.get_caller_identity()
            account_id = identity["Account"]
            accounts[account_id] = {
                "id": account_id,
                "name": "Current Account",
                "source": "current",
            }
        except Exception as e:
            print(f"Could not get current account: {e}")

    return list(accounts.values())
