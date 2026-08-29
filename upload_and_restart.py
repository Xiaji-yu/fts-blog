#!/usr/bin/env python3
"""Upload corrected files to the blog server and restart."""

import paramiko
import sys
import os

import os
if not os.path.exists('deploy_config.py'):
    raise SystemExit('Missing deploy_config.py — copy deploy_config.example.py to deploy_config.py and fill in credentials.')
try:
    from deploy_config import HOST, USER, PASS
except ImportError as e:
    raise SystemExit('deploy_config.py exists but is missing HOST/USER/PASS — add the missing variable(s) and retry.') from e

FILES = [
    (r'D:\code\blog\fts-blog\routes\import.js', '/var/www/blog/routes/import.js'),
    (r'D:\code\blog\fts-blog\views\admin-import.ejs', '/var/www/blog/views/admin-import.ejs'),
]

def ssh_exec(client, cmd):
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    return out, err

def main():
    print(f'Connecting to {HOST}...')
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS, timeout=15)
    print('Connected!')

    # Open SFTP
    sftp = client.open_sftp()

    for local_path, remote_path in FILES:
        filename = os.path.basename(local_path)
        print(f'\n--- Uploading {filename} ---')

        # Read local file
        with open(local_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # Quick sanity checks
        if filename == 'import.js':
            if "const OBSIDIAN_DIR = path.join(__dirname, '..', '经验');" in content:
                print('  Local file has OBSIDIAN_DIR with correct encoding')
            if '/import/directory' in content:
                print('  Local file has /import/directory route')
            if 'function parseFrontmatter' in content:
                print('  Local file has parseFrontmatter')
        elif filename == 'admin-import.ejs':
            if 'scanBtn' in content:
                print('  Local file has scanBtn')
            if '经验/' in content:
                print('  Local file has 经验/ references')

        # Upload via SFTP
        with sftp.open(remote_path, 'w') as remote_file:
            remote_file.write(content)

        print(f'  Uploaded to {remote_path}')

        # Verify on server
        out, _ = ssh_exec(client, f"python3 -c \"with open('{remote_path}', 'r', encoding='utf-8') as f: c = f.read(); print('Lines:', len(c.split(chr(10)))); print('Size:', len(c), 'bytes')\"")
        print(f'  Server says: {out}')

    sftp.close()

    # ============================================================
    # Restart blog
    # ============================================================
    print('\n--- Restarting blog ---')

    out, _ = ssh_exec(client, 'which pm2 2>/dev/null || echo "not found"')
    print('pm2 location:', out)

    pm2_path = '/root/.nvm/versions/node/v20.20.2/bin/pm2'
    out, err = ssh_exec(client, f'sudo -n {pm2_path} restart blog 2>&1')
    print('pm2 restart:', out)
    if err and 'password' not in err.lower():
        print('ERR:', err)

    import time
    time.sleep(2)

    out, err = ssh_exec(client, f'sudo -n {pm2_path} status 2>&1')
    print('pm2 status:', out)
    if err and 'password' not in err.lower():
        print('ERR:', err)

    client.close()
    print('\n=== All done! ===')

if __name__ == '__main__':
    main()
