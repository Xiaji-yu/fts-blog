#!/usr/bin/env python3
"""Restart pm2 blog as root via su."""

import paramiko
import sys
import time

HOST = 'xiaji.xin'
USER = 'tempuser'
PASS = 'test'
ROOT_PASS = None  # We'll try without password first

def ssh_exec(client, cmd):
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    return out, err

def main():
    print(f'Connecting to {HOST} as {USER}...')
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS, timeout=15)
    print('Connected!')

    # Try restart via su to root
    print('\n--- Trying su to root ---')

    # Use a PTY to run interactive commands
    chan = client.get_transport().open_session()
    chan.get_pty()
    chan.invoke_shell()
    time.sleep(0.5)

    # Clear any initial output
    while chan.recv_ready():
        chan.recv(1024)

    # Try su to root
    print('Sending: su -')
    chan.send('su -\n')
    time.sleep(1)

    # Check if password is required
    output = ''
    while chan.recv_ready():
        output += chan.recv(1024).decode('utf-8', errors='replace')
    print('After su:', repr(output))

    if 'Password' in output:
        print('Root password required - cannot proceed')
        print('Please run on server as root:')
        print('  /root/.nvm/versions/node/v20.20.2/bin/pm2 restart blog')
        chan.close()
        client.close()
        return

    # If no password required (NOPASSWD sudoers)
    print('No password required, sending pm2 restart...')
    chan.send('/root/.nvm/versions/node/v20.20.2/bin/pm2 restart blog\n')
    time.sleep(2)

    output = ''
    while chan.recv_ready():
        output += chan.recv(1024).decode('utf-8', errors='replace')
    print('pm2 restart output:', output)

    chan.send('/root/.nvm/versions/node/v20.20.2/bin/pm2 status\n')
    time.sleep(1)

    output = ''
    while chan.recv_ready():
        output += chan.recv(1024).decode('utf-8', errors='replace')
    print('pm2 status:', output)

    chan.close()
    client.close()
    print('\n=== Done! ===')

if __name__ == '__main__':
    main()
