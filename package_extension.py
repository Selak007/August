"""
August — Package Extension to ZIP

Creates a clean, distributable august-extension.zip from the extension/ directory.
Usage:
    python package_extension.py
"""

import os
import zipfile

def package():
    root_dir = os.path.dirname(os.path.abspath(__file__))
    ext_dir = os.path.join(root_dir, "extension")
    zip_path = os.path.join(root_dir, "august-extension.zip")

    if not os.path.exists(ext_dir):
        print(f"Error: extension directory not found at {ext_dir}")
        return

    print(f"Packaging {ext_dir} -> {zip_path} ...")

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(ext_dir):
            for file in files:
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, ext_dir)
                zf.write(full_path, rel_path)
                print(f"  + {rel_path}")

    size_kb = os.path.getsize(zip_path) / 1024
    print(f"\nSuccessfully created {zip_path} ({size_kb:.1f} KB)")
    print("Ready to load or distribute!")

if __name__ == "__main__":
    package()
