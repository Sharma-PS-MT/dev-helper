const { JSONPath } = require('jsonpath-plus');

// Simulate the normalizeJsonPath logic from the Angular component
function normalizeJsonPath(path) {
  return path.replace(/\[([^\]]+)\]/g, (match, inner) => {
    const parts = inner.split(',').map(p => p.trim());
    const isQuotedUnion = parts.length > 1 && parts.every(p =>
      /^['"][a-zA-Z_$][a-zA-Z0-9_$]*['"]$/.test(p)
    );
    if (isQuotedUnion) {
      const unquoted = parts.map(p => p.slice(1, -1)).join(',');
      return `[${unquoted}]`;
    }
    return match;
  });
}

const obj = [
  {
    "services": [
      { "companyTax": 100, "companyShareAmount": 50 },
      { "companyTax": 200, "companyShareAmount": 100 }
    ]
  }
];

const queries = [
  "$.[*].services[*]['companyTax','companyShareAmount']",
  "$.[*].services[*]['companyTax','companyTax']",
  "$[*].services[*]['companyTax','companyShareAmount']",
];

console.log('=== Testing normalizeJsonPath fix ===\n');

queries.forEach(q => {
  const normalized = normalizeJsonPath(q);
  const result = JSONPath({ path: normalized, json: obj });
  const sum = result.reduce((a, b) => a + b, 0);
  console.log(`Original:   ${q}`);
  console.log(`Normalized: ${normalized}`);
  console.log(`Result:     ${JSON.stringify(result)}`);
  console.log(`Sum:        ${sum}`);
  console.log('---');
});
