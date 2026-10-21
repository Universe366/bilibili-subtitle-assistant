import { app } from 'electron';

app.whenReady().then(async () => {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t(a TEXT)');
    db.prepare('INSERT INTO t VALUES (?)').run('hello');
    db.exec("CREATE VIRTUAL TABLE f USING fts5(text, tokenize='trigram')");
    db.prepare('INSERT INTO f(rowid, text) VALUES (?, ?)').run(1, '这台折叠屏手机的折痕控制得不错');
    const hit = db.prepare('SELECT rowid FROM f WHERE f MATCH ?').all('"折叠屏"');
    console.log('SQLITE_OK', JSON.stringify({ rows: db.prepare('SELECT * FROM t').all(), hit }));
  } catch (error) {
    console.log('SQLITE_FAIL', error && error.message);
  }
  app.exit(0);
});
