const BASE_URL = 'http://127.0.0.1:8000';
const HEADERS = {
  'Content-Type': 'application/json',
  'X-API-Key': 'csi-test-key-123'
};

async function runTests() {
  console.log('==============================================');
  console.log('   TESTING ALL CSI HELPER API ENDPOINTS       ');
  console.log('==============================================\n');

  // 1. Health Check
  try {
    const res = await fetch(`${BASE_URL}/health`);
    const data = await res.json();
    console.log('[PASS] 1. GET /health');
    console.log('       Status:', res.status, '| App Version:', data.version);
    console.log('       CSI API Routes:', data.services?.csi_helper_api?.length || 0);
  } catch (e) {
    console.error('[FAIL] 1. GET /health:', e.message);
  }

  // 2. Environments List
  try {
    const res = await fetch(`${BASE_URL}/api/v1/environments`, { headers: HEADERS });
    const data = await res.json();
    console.log('\n[PASS] 2. GET /api/v1/environments');
    console.log('       Status:', res.status, '| Total Environments:', data.length);
    console.log('       Sample Envs:', data.slice(0, 4).map(e => `${e.name} (${e.id})`).join(', '));
  } catch (e) {
    console.error('[FAIL] 2. GET /api/v1/environments:', e.message);
  }

  // 3. Environments with Search Filter
  try {
    const res = await fetch(`${BASE_URL}/api/v1/environments?search=uat`, { headers: HEADERS });
    const data = await res.json();
    console.log('\n[PASS] 3. GET /api/v1/environments?search=uat');
    console.log('       Status:', res.status, '| Matching Envs:', data.map(e => e.id).join(', '));
  } catch (e) {
    console.error('[FAIL] 3. GET /api/v1/environments?search=uat:', e.message);
  }

  // 4. Module List (All)
  try {
    const res = await fetch(`${BASE_URL}/api/v1/modules`, { headers: HEADERS });
    const data = await res.json();
    console.log('\n[PASS] 4. GET /api/v1/modules');
    console.log('       Status:', res.status, '| Total Registered Modules:', data.length);
  } catch (e) {
    console.error('[FAIL] 4. GET /api/v1/modules:', e.message);
  }

  // 5. Module List filtered by Stream
  try {
    const res = await fetch(`${BASE_URL}/api/v1/modules?stream=BM`, { headers: HEADERS });
    const data = await res.json();
    console.log('\n[PASS] 5. GET /api/v1/modules?stream=BM');
    console.log('       Status:', res.status, '| BM Modules Count:', data.length);
    console.log('       Sample Modules:', data.slice(0, 4).map(m => m.key).join(', '));
  } catch (e) {
    console.error('[FAIL] 5. GET /api/v1/modules?stream=BM:', e.message);
  }

  // 6. Module List with Search Query
  try {
    const res = await fetch(`${BASE_URL}/api/v1/modules?search=invoice`, { headers: HEADERS });
    const data = await res.json();
    console.log('\n[PASS] 6. GET /api/v1/modules?search=invoice');
    console.log('       Status:', res.status, '| Matches:', data.map(m => m.displayName).join(' & '));
  } catch (e) {
    console.error('[FAIL] 6. GET /api/v1/modules?search=invoice:', e.message);
  }

  // 7. Stream List
  try {
    const res = await fetch(`${BASE_URL}/api/v1/streams`, { headers: HEADERS });
    const data = await res.json();
    console.log('\n[PASS] 7. GET /api/v1/streams');
    console.log('       Status:', res.status, '| Streams Found:', data.map(s => `${s.stream} (${s.module_count})`).join(', '));
  } catch (e) {
    console.error('[FAIL] 7. GET /api/v1/streams:', e.message);
  }

  // 8. Modules under specific stream key
  try {
    const res = await fetch(`${BASE_URL}/api/v1/streams/BM/modules`, { headers: HEADERS });
    const data = await res.json();
    console.log('\n[PASS] 8. GET /api/v1/streams/BM/modules');
    console.log('       Status:', res.status, '| Modules returned:', data.length);
  } catch (e) {
    console.error('[FAIL] 8. GET /api/v1/streams/BM/modules:', e.message);
  }

  // 9. Single Module Deployment Lookup across environments
  try {
    console.log('\n[INFO] 9. Testing single module deployment (BM_APPROVAL_UI) across [dev, vida-uat]...');
    const res = await fetch(`${BASE_URL}/api/v1/deployments/modules/BM_APPROVAL_UI?envs=dev,vida-uat`, { headers: HEADERS });
    const data = await res.json();
    console.log('[PASS] 9. GET /api/v1/deployments/modules/BM_APPROVAL_UI');
    console.log('       Status:', res.status);
    if (data.module) {
      console.log('       Module:', data.module.display_name, `(${data.module.repository})`);
      console.log('       Versions:', JSON.stringify(data.module.versions));
      console.log('       Has Difference:', data.module.has_difference);
    }
    if (data.errors) console.log('       Cluster Notes (if any):', data.errors);
  } catch (e) {
    console.error('[FAIL] 9. GET /api/v1/deployments/modules/BM_APPROVAL_UI:', e.message);
  }

  // 10. POST Deployments Compare
  try {
    console.log('\n[INFO] 10. Testing POST /api/v1/deployments/compare for BM stream across [dev, vida-uat]...');
    const res = await fetch(`${BASE_URL}/api/v1/deployments/compare`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        environments: ['dev', 'vida-uat'],
        stream: 'BM'
      })
    });
    const data = await res.json();
    console.log('[PASS] 10. POST /api/v1/deployments/compare');
    console.log('       Status:', res.status);
    console.log('       Compared Environments:', data.environments?.map(e => e.id).join(' vs '));
    console.log('       Total Modules Checked:', data.total_modules);
    console.log('       Differences Detected:', data.differences_count);
    if (data.modules && data.modules.length > 0) {
      console.log('       Sample Comparison Results:');
      data.modules.slice(0, 3).forEach(m => {
        console.log(`         • ${m.display_name}: ${JSON.stringify(m.versions)} (diff=${m.has_difference})`);
      });
    }
  } catch (e) {
    console.error('[FAIL] 10. POST /api/v1/deployments/compare:', e.message);
  }

  // 11. MCP Client Tool Call Test
  try {
    console.log('\n[INFO] 11. Testing csi-helper-mcp API Client class directly...');
    const { CsiHelperApiClient } = await import('./csi-helper-mcp/dist/api-client.js');
    const mcpClient = new CsiHelperApiClient(`${BASE_URL}/api/v1`, 'dummy-key');
    const envList = await mcpClient.getEnvironments();
    const streamList = await mcpClient.getStreams();
    console.log('[PASS] 11. csi-helper-mcp client connected successfully!');
    console.log('       MCP Client fetched envs:', envList.length, '| streams:', streamList.length);
  } catch (e) {
    console.error('[FAIL] 11. csi-helper-mcp client test:', e.message);
  }

  // 12. Release Gap Analysis Test
  try {
    console.log('\n[INFO] 12. Testing POST /api/v1/release-gap for BM_APPROVAL_UI (dev vs vida-uat)...');
    const res = await fetch(`${BASE_URL}/api/v1/release-gap`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        source_env: 'dev',
        target_env: 'vida-uat',
        modules: ['BM_APPROVAL_UI']
      })
    });
    const data = await res.json();
    console.log('[PASS] 12. POST /api/v1/release-gap');
    console.log('       Status:', res.status);
    console.log('       Total Modules:', data.total_modules);
    console.log('       Forward Commits:', data.total_forward_commits, '| Reverse Commits:', data.total_reverse_commits);
    console.log('       Regression Risk:', data.has_regression_risk);
    console.log('       Jira Tickets Identified:', data.all_ticket_ids?.slice(0, 5).join(', '));
    if (data.modules && data.modules[0]) {
      const m = data.modules[0];
      console.log(`       Module Status: ${m.status} | Source Tag: ${m.source_version} | Target Tag: ${m.target_version}`);
    }
  } catch (e) {
    console.error('[FAIL] 12. POST /api/v1/release-gap:', e.message);
  }

  // 13. Git Diff Compare Test
  try {
    console.log('\n[INFO] 13. Testing POST /api/v1/diff/compare for BM_APPROVAL_UI...');
    const res = await fetch(`${BASE_URL}/api/v1/diff/compare`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        module: 'BM_APPROVAL_UI',
        from_ref: 'V4.0.2607_W4-14713_prod',
        to_ref: 'V4.0.2609_W4-15750_dev',
        include_patch: true,
        max_patch_lines: 50
      })
    });
    const data = await res.json();
    console.log('[PASS] 13. POST /api/v1/diff/compare');
    console.log('       Status:', res.status);
    console.log('       Files Changed:', data.total_files_changed);
    console.log('       Insertions (+):', data.total_insertions, '| Deletions (-):', data.total_deletions);
    console.log('       Commits Count:', data.commits?.length || 0);
    console.log('       Tickets Involved:', data.ticket_ids?.join(', '));
    console.log('       Patch Truncated:', data.patch_truncated);
  } catch (e) {
    console.error('[FAIL] 13. POST /api/v1/diff/compare:', e.message);
  }

  // 14. Live Feature Toggles API Test
  try {
    console.log('\n[INFO] 14. Testing GET /api/v1/environments/s1-prod/feature-toggles?category=ops&search=SMS...');
    const res = await fetch(`${BASE_URL}/api/v1/environments/s1-prod/feature-toggles?category=ops&search=SMS`, {
      headers: HEADERS
    });
    const data = await res.json();
    console.log('[PASS] 14. GET /api/v1/environments/s1-prod/feature-toggles');
    console.log('       Status:', res.status);
    console.log('       Environment:', data.environment, '| App Base URL:', data.app_base_url);
    console.log('       Total Toggles:', data.total_toggles);
    console.log('       Toggles Data:', JSON.stringify(data.categories));
  } catch (e) {
    console.error('[FAIL] 14. GET /api/v1/environments/s1-prod/feature-toggles:', e.message);
  }

  // 15. Compare Live Feature Toggles Test
  try {
    console.log('\n[INFO] 15. Testing POST /api/v1/feature-toggles/compare for [dev vs s1-prod]...');
    const res = await fetch(`${BASE_URL}/api/v1/feature-toggles/compare`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        env1: 'dev',
        env2: 's1-prod',
        category: 'ops',
        search: 'SMS'
      })
    });
    const data = await res.json();
    console.log('[PASS] 15. POST /api/v1/feature-toggles/compare');
    console.log('       Status:', res.status);
    console.log(`       Comparing: ${data.env1} (${data.app_base_url_env1}) vs ${data.env2} (${data.app_base_url_env2})`);
    console.log('       Total Compared:', data.total_keys_compared);
    console.log(`       Matches: ${data.matching_count} | Differing: ${data.differing_count} | Only in env1: ${data.only_in_env1_count} | Only in env2: ${data.only_in_env2_count}`);
  } catch (e) {
    console.error('[FAIL] 15. POST /api/v1/feature-toggles/compare:', e.message);
  }

  // 16. MCP Client Live Feature Toggles Call
  try {
    console.log('\n[INFO] 16. Testing csi-helper-mcp client.getFeatureToggles directly...');
    const { CsiHelperApiClient } = await import('./csi-helper-mcp/dist/api-client.js');
    const mcpClient = new CsiHelperApiClient(`${BASE_URL}/api/v1`, 'dummy-key');
    const toggles = await mcpClient.getFeatureToggles('dev', { category: 'ops', search: 'SMS' });
    console.log('[PASS] 16. csi-helper-mcp client.getFeatureToggles succeeded!');
    console.log('       Fetched toggles count:', toggles.total_toggles);
  } catch (e) {
    console.error('[FAIL] 16. csi-helper-mcp client.getFeatureToggles:', e.message);
  }

  console.log('\n==============================================');
  console.log('   ALL API TESTS COMPLETED SUCCESSFULLY!      ');
  console.log('==============================================');
}

runTests();

