const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3');

const dbPath = process.env.INCOGNIDE_DB_PATH || path.join(os.homedir(), '.incognide', 'history.db');

const db = new sqlite3.Database(dbPath);

const updateQuery = `
  UPDATE conversation_history
  SET execution_mode = CASE
    WHEN (tool_calls IS NOT NULL AND tool_calls != '' AND tool_calls != '[]') OR role = 'tool' THEN 'tool_agent'
    ELSE 'chat'
  END
  WHERE execution_mode IS NULL
`;

db.run(updateQuery, function(err) {
  if (err) {
    console.error('Backfill failed:', err.message);
    process.exit(1);
  }
  console.log(`Backfilled ${this.changes} rows.`);
  db.close();
});
