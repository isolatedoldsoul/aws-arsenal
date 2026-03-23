import boto3
import json
import os
from datetime import datetime, timezone
from typing import List, Dict

# S3 folder structure:
# {bucket}/{category}/{identity_key}/YYYY/MM/DD/{run_id}/
#   scan_config.json
#   findings.json
#   report.xlsx / report.html
#
# category = GlobalAdmin | CloudOps | Users
# identity_key = plain IAM username or SSO email (e.g. john.doe@company.com)

VALID_CATEGORIES = {"GlobalAdmin", "CloudOps", "Users"}


def get_history_client(s3_config: dict):
    """
    Build an S3 client based on the configured mode:
      env   — server env vars / instance profile / ~/.aws (default, no extra config needed)
      keys  — explicit IAM access_key_id + secret_access_key in config.json
    """
    region = s3_config.get("region", "us-west-2")
    mode = s3_config.get("mode", "env")

    if mode == "keys":
        access_key = s3_config.get("access_key_id", "")
        secret_key = s3_config.get("secret_access_key", "")
        if access_key and secret_key:
            return boto3.client(
                "s3",
                region_name=region,
                aws_access_key_id=access_key,
                aws_secret_access_key=secret_key,
            )
        else:
            print("S3 mode=keys but access_key_id/secret_access_key not set — falling back to env")

    # Default: env vars, instance profile, ~/.aws
    return boto3.client("s3", region_name=region)


def save_scan_history(
    identity_key: str,
    category: str,
    run_id: str,
    scan_config: dict,
    findings: list,
    s3_config: dict,
):
    bucket = s3_config.get("bucket", "")
    if not bucket or not identity_key:
        return

    if category not in VALID_CATEGORIES:
        category = "Users"

    s3 = get_history_client(s3_config)
    now = datetime.now(timezone.utc)
    base_key = f"{category}/{identity_key}/{now.strftime('%Y/%m/%d')}/{run_id}"

    safe_config = {
        "services": scan_config.get("services"),
        "scope": scan_config.get("scope"),
        "accounts": scan_config.get("accounts"),
        "regions": scan_config.get("regions"),
        "idle_days": scan_config.get("idle_days"),
        "timestamp": now.isoformat(),
        "run_id": run_id,
        "identity": identity_key,
        "category": category,
    }
    # Strip any credential fields that may have leaked in
    for key in ["access_key", "secret_key", "session_token", "sso_url",
                "sso_session_name", "role_name", "password", "token",
                "credentials", "auth_mode"]:
        safe_config.pop(key, None)

    try:
        s3.put_object(
            Bucket=bucket,
            Key=f"{base_key}/scan_config.json",
            Body=json.dumps(safe_config, indent=2),
            ContentType="application/json",
        )
        s3.put_object(
            Bucket=bucket,
            Key=f"{base_key}/findings.json",
            Body=json.dumps(findings, indent=2),
            ContentType="application/json",
        )
        for ext in ["xlsx", "html"]:
            report_path = f"/tmp/reports/{run_id}/report.{ext}"
            if os.path.exists(report_path):
                with open(report_path, "rb") as f:
                    s3.put_object(
                        Bucket=bucket,
                        Key=f"{base_key}/report.{ext}",
                        Body=f.read(),
                    )
        print(f"History saved: s3://{bucket}/{base_key}/")
    except Exception as e:
        print(f"History save failed (non-fatal): {e}")


def list_scan_history(
    identity_key: str,
    category: str,
    s3_config: dict,
    limit: int = 20,
) -> List[Dict]:
    bucket = s3_config.get("bucket", "")
    if not bucket or not identity_key:
        return []

    if category not in VALID_CATEGORIES:
        category = "Users"

    s3 = get_history_client(s3_config)
    try:
        paginator = s3.get_paginator("list_objects_v2")
        results = []
        for page in paginator.paginate(
            Bucket=bucket,
            Prefix=f"{category}/{identity_key}/",
        ):
            for obj in page.get("Contents", []):
                if obj["Key"].endswith("scan_config.json"):
                    try:
                        body = s3.get_object(Bucket=bucket, Key=obj["Key"])
                        config = json.loads(body["Body"].read())
                        results.append(config)
                    except Exception:
                        pass
        results.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        return results[:limit]
    except Exception as e:
        print(f"History list failed: {e}")
        return []


def get_scan_history_detail(
    identity_key: str,
    category: str,
    run_id: str,
    s3_config: dict,
) -> Dict:
    bucket = s3_config.get("bucket", "")
    if category not in VALID_CATEGORIES:
        category = "Users"

    s3 = get_history_client(s3_config)
    try:
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(
            Bucket=bucket,
            Prefix=f"{category}/{identity_key}/",
        ):
            for obj in page.get("Contents", []):
                if run_id in obj["Key"] and obj["Key"].endswith("findings.json"):
                    body = s3.get_object(Bucket=bucket, Key=obj["Key"])
                    return json.loads(body["Body"].read())
    except Exception as e:
        print(f"History detail fetch failed: {e}")
    return {}
