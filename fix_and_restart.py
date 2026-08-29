#!/usr/bin/env python3
"""Fix encoding and restart pm2 on the blog server."""

import paramiko
import sys

import os
if not os.path.exists('deploy_config.py'):
    raise SystemExit('Missing deploy_config.py — copy deploy_config.example.py to deploy_config.py and fill in credentials.')
try:
    from deploy_config import HOST, USER, PASS
except ImportError as e:
    raise SystemExit('deploy_config.py exists but is missing HOST/USER/PASS — add the missing variable(s) and retry.') from e

def ssh_exec(client, cmd):
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    return out, err

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS, timeout=15)

    # Fix garbled Chinese in import.js
    out, err = ssh_exec(client, 'python3 -c "'
        "with open(\"/var/www/blog/routes/import.js\", \"r\") as f: content = f.read()"
        " content = content.replace(\"path.join(__dirname, '..', '����')\", \"path.join(__dirname, '..', '经验')\")"
        " with open(\"/var/www/blog/routes/import.js\", \"w\") as f: f.write(content)"
        " print('Fixed OBSIDIAN_DIR encoding')"
    '"')
    print('Fix encoding:', out, err)

    # Verify
    out, _ = ssh_exec(client, "grep OBSIDIAN /var/www/blog/routes/import.js")
    print('OBSIDIAN_DIR:', out)

    # Fix garbled Chinese in admin-import.ejs
    out, err = ssh_exec(client, 'python3 -c "'
        "with open(\"/var/www/blog/views/admin-import.ejs\", \"r\") as f: content = f.read()"
        " content = content.replace('草粉', '经验')"
        " content = content.replace('草粉', '经验')"
        " with open(\"/var/www/blog/views/admin-import.ejs\", \"w\") as f: f.write(content)"
        " print('Fixed ejs encoding')"
    '"')
    print('Fix ejs:', out, err)

    # Find pm2 path
    out, _ = ssh_exec(client, 'sudo -n find / -name pm2 -type f 2>/dev/null | head -5')
    print('pm2 paths:', out)

    # Try restarting pm2 via sudo
    out, err = ssh_exec(client, 'sudo -n /root/.nvm/versions/node/v20.20.2/bin/pm2 restart blog 2>&1')
    print('pm2 restart:', out, err)

    # Also check pm2 status
    out, err = ssh_exec(client, 'sudo -n /root/.nvm/versions/node/v20.20.2/bin/pm2 status 2>&1')
    print('pm2 status:', out, err)

    client.close()

if __name__ == '__main__':
    main()
