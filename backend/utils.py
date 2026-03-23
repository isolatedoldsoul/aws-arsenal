import re

UUID_PATTERN = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
)

def validate_uuid(value: str) -> bool:
    return bool(UUID_PATTERN.match(value.lower()))

def validate_account_id(account_id: str) -> bool:
    return bool(re.match(r'^\d{12}$', account_id))

def validate_role_name(role_name: str) -> bool:
    return bool(re.match(r'^[\w+=,.@ -]{1,128}$', role_name))
