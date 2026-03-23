import importlib
import pkgutil
import os

def get_all_scanners():
    scanners = []
    package_dir = os.path.dirname(__file__)
    for _, module_name, _ in pkgutil.iter_modules([package_dir]):
        module = importlib.import_module(f"scanners.{module_name}")
        if hasattr(module, 'SCANNER_NAME') and hasattr(module, 'run'):
            scanners.append(module)
    return scanners
