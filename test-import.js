const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';

// Helper to make HTTP requests
function makeRequest(method, urlPath, data = null, cookies = '') {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    if (cookies) {
      options.headers['Cookie'] = cookies;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body), cookies: res.headers['set-cookie'] });
        } catch {
          resolve({ status: res.statusCode, data: body, cookies: res.headers['set-cookie'] });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function testObsidianImport() {
  console.log('=== Testing Obsidian Import ===\n');

  // Step 1: Login
  console.log('[1] Logging in...');
  const loginRes = await makeRequest('POST', '/api/auth/login', {
    username: 'admin',
    password: 'admin123'
  });

  if (loginRes.status !== 200) {
    console.error('Login failed:', loginRes.data);
    process.exit(1);
  }
  console.log('✓ Logged in as admin\n');

  // Extract cookies
  const cookies = loginRes.cookies ? loginRes.cookies.join('; ') : '';

  // Step 2: Read sample Obsidian file
  console.log('[2] Reading sample Obsidian file...');
  const samplePath = path.join(__dirname, 'examples', 'obsidian-sample.md');
  const content = fs.readFileSync(samplePath, 'utf-8');
  console.log(`✓ Read ${content.length} characters\n`);

  // Step 3: Import the file
  console.log('[3] Importing Obsidian file...');
  const importRes = await makeRequest('POST', '/admin/import', {
    files: [
      {
        filename: 'vite-notes-2026.md',
        content: content,
        frontmatter: {
          title: '前端技术笔记',
          date: '2026-08-18',
          tags: ['前端', 'JavaScript', 'CSS']
        }
      }
    ]
  }, cookies);

  console.log(`Status: ${importRes.status}`);
  console.log(`Imported: ${importRes.data.imported}`);
  console.log(`Failed: ${importRes.data.failed}`);

  if (importRes.data.imported > 0) {
    console.log('\n✓ Import successful!');
    console.log('Imported files:');
    importRes.data.details.imported.forEach(file => {
      console.log(`  - ${file.title} (${file.slug})`);
    });
  }

  if (importRes.data.failed > 0) {
    console.log('\nFailed files:');
    importRes.data.details.failed.forEach(file => {
      console.log(`  - ${file.filename}: ${file.error}`);
    });
  }

  // Step 4: Verify the imported post
  console.log('\n[4] Verifying imported post...');
  const postRes = await makeRequest('GET', '/api/posts/vite-notes-2026', null, cookies);

  if (postRes.status === 200) {
    console.log('✓ Post found!');
    console.log(`  Title: ${postRes.data.title}`);
    console.log(`  Tags: ${postRes.data.tags.join(', ')}`);
    console.log(`  Content preview:`);
    console.log(postRes.data.content.substring(0, 200) + '...');
  } else {
    console.log('✗ Post not found (status:', postRes.status, ')');
  }

  console.log('\n=== Test Complete ===');
}

testObsidianImport().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
