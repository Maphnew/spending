'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);

module.exports = function mountInsights(app, options = {}) {
  const project = options.project || process.env.ANALYSIS_PROJECT_DIR || path.resolve(__dirname, '../codex-home/monthly-spend');
  const cacheFile = options.cacheFile || path.join(__dirname, 'insights-cache.json');
  const reports = { consolidated: 'consolidated-report.json', categories: 'category-expenses.json', fixed: 'fixed-expenses.json', plan: 'spending-plan.json' };
  let current = null;
  let running = false;
  function collect() {
    const result = {};
    for (const [key, file] of Object.entries(reports)) result[key] = JSON.parse(fs.readFileSync(path.join(project, 'data', file), 'utf8'));
    if (!Array.isArray(result.plan.budgets) || !Array.isArray(result.categories.categories) || !Array.isArray(result.fixed.groups)) throw new Error('Invalid analysis reports');
    // Never publish a mixture of generations after a partially failed refresh.
    if (result.categories.sourceBuiltAt !== result.consolidated.builtAt || result.fixed.dataBuiltAt !== result.consolidated.builtAt) throw new Error('Analysis generations do not match');
    if (result.plan.budgets.reduce((sum, row) => sum + row.amount, 0) !== result.plan.monthlySpendingLimit) throw new Error('Budget does not reconcile');
    return {
      generatedAt: result.consolidated.builtAt,
      sourceCount: result.consolidated.totals.dbOriginalRows,
      deduplication: result.consolidated.totals,
      categories: result.categories,
      fixed: result.fixed,
      plan: result.plan,
      transactions: result.consolidated.ledger.filter(row => row.kind === 'expense').map(row => ({ id: row.id, date: row.date, amount: row.amount, description: row.description, category: row.category, source: row.source, dateBasis: row.dateBasis })),
    };
  }
  function publish(result) {
    const temp = cacheFile + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(result));
    fs.renameSync(temp, cacheFile);
    current = result;
  }
  try { current = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (_) { /* First run uses existing reports if consistent. */ }
  app.get('/api/insights', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!current) publish(collect());
      res.json({ ...current, refreshing: running });
    } catch (error) {
      console.error('Analysis load failed:', error.message);
      res.status(503).json({ error: '분석 결과를 준비하지 못했습니다. 분석 새로고침을 눌러주세요.' });
    }
  });
  app.post('/api/insights/refresh', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    if (running) return res.status(409).json({ error: '이미 분석을 갱신하고 있습니다. 잠시 후 다시 확인해주세요.' });
    running = true;
    try {
      for (const script of ['consolidate.js', 'analyze-fixed.js', 'analyze-categories.js', 'build-spending-plan.js']) {
        await execute(process.execPath, [path.join(project, script)], {
          cwd: project,
          env: { ...process.env, SPENDING_DB: path.join(__dirname, 'spending.db') },
          windowsHide: true,
          timeout: 120000,
          maxBuffer: 20 * 1024 * 1024,
        });
      }
      publish(collect());
      res.json({ ...current, refreshing: false });
    } catch (error) {
      console.error('Analysis refresh failed:', error.message);
      res.status(500).json({ error: '갱신하지 못했습니다. 마지막 성공 결과는 유지됩니다. 잠시 후 다시 시도해주세요.' });
    } finally { running = false; }
  });
};
