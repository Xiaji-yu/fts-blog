#!/usr/bin/env python3
"""Upload corrected files to the blog server and restart."""

import paramiko
import sys

HOST = 'xiaji.xin'
USER = 'tempuser'
PASS = 'testpassword'

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

    # ============================================================
    # 1. Upload corrected import.js via SFTP
    # ============================================================
    print('\n--- Uploading routes/import.js ---')
    local_path = r'D:\code\blog\fts-blog\routes\import.js'
    remote_path = '/var/www/blog/routes/import.js'

    with open(local_path, 'r', encoding='utf-8') as f:
        local_content = f.read()

    # Verify OBSIDIAN_DIR is in the local file
    if "const OBSIDIAN_DIR = path.join(__dirname, '..', '经验');" in local_content:
        print('Local import.js has OBSIDIAN_DIR with correct encoding')
    else:
        print('WARNING: OBSIDIAN_DIR not found in local file!')

    # Write to remote using python3 over SSH
    # We need to escape the content properly
    import base64
    encoded = base64.b64encode(local_content.encode('utf-8')).decode('ascii')

    stdin, stdout, stderr = client.exec_command(f'''python3 -c "
import base64
with open('{remote_path}', 'w', encoding='utf-8') as f:
    f.write(base64.b64decode('{encoded}').decode('utf-8'))
print('Uploaded import.js successfully')
"''')
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    print(out)
    if err: print('ERR:', err)

    # Verify
    out, _ = ssh_exec(client, "grep OBSIDIAN /var/www/blog/routes/import.js")
    print('OBSIDIAN_DIR on server:', out)

    out, _ = ssh_exec(client, "grep -c 'import/directory' /var/www/blog/routes/import.js")
    print('Directory route count:', out)

    # ============================================================
    # 2. Upload corrected admin-import.ejs via SFTP
    # ============================================================
    print('\n--- Uploading views/admin-import.ejs ---')
    local_path = r'D:\code\blog\fts-blog\views\admin-import.ejs'
    remote_path = '/var/www/blog/views/admin-import.ejs'

    with open(local_path, 'r', encoding='utf-8') as f:
        local_content = f.read()

    # Verify scan button is in the local file
    if 'scanBtn' in local_content and '经验/' in local_content:
        print('Local admin-import.ejs has scan button with correct encoding')
    else:
        print('WARNING: scan button not found in local file!')

    encoded = base64.b64encode(local_content.encode('utf-8')).decode('ascii')

    stdin, stdout, stderr = client.exec_command(f'''python3 -c "
import base64
with open('{remote_path}', 'w', encoding='utf-8') as f:
    f.write(base64.b64decode('{encoded}').decode('utf-8'))
print('Uploaded admin-import.ejs successfully')
"''')
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    print(out)
    if err: print('ERR:', err)

    # Verify
    out, _ = ssh_exec(client, "grep -c 'scanBtn' /var/www/blog/views/admin-import.ejs")
    print('scanBtn count:', out)

    out, _ = ssh_exec(client, "grep -c '经验/' /var/www/blog/views/admin-import.ejs")
    print('经验 references:', out)

    # ============================================================
    # 3. Restart blog
    # ============================================================
    print('\n--- Restarting blog ---')

    # Find pm2
    out, _ = ssh_exec(client, 'which pm2 2>/dev/null || find /root -name pm2 -type f 2>/dev/null | head -3')
    print('pm2 location:', out)

    # Try restart via sudo
    out, err = ssh_exec(client, 'sudo -n /root/.nvm/versions/node/v20.20.2/bin/pm2 restart blog 2>&1')
    print('pm2 restart:', out)
    if err and 'password' not in err.lower(): print('ERR:', err)

    import time
    time.sleep(2)

    out, err = ssh_exec(client, 'sudo -n /root/.nvm/versions/node/v20.20.2/bin/pm2 status 2>&1')
    print('pm2 status:', out)
    if err and 'password' not in err.lower(): print('ERR:', err)

    client.close()
    print('\n=== All done! ===')

if __name__ == '__main__':
    main()
