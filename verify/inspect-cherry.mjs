// 只读探查本机 Cherry Studio 的配置数据库，用于对齐「内置平台 / MCP / 搜索 / Skills」设计。
//
// 安全约束（本脚本必须遵守）：
//   · 只输出**结构**：表名、列名、行数、平台的 id/类型、模型的 id
//   · 绝不输出任何字段的「值」，尤其是 JSON 字符串内部的值
//     （上一版就是因为 function 里对 JSON 字符串只做整体判断，
//      导致 app_secret 这类嵌套字段被原样打印出来）
//   · 唯一的例外是 id / name / type 这种明确非敏感的短标识，且经过白名单
import fs from 'node:fs';
import path from 'node:path';

const DB = path.join(process.env.APPDATA || '', 'CherryStudio', 'Data', 'cherrystudio.sqlite');
if (!fs.existsSync(DB)) {
  console.log('未找到 Cherry Studio 数据库，跳过');
  process.exit(0);
}

let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch (err) {
  console.log('本机 Node 不支持 node:sqlite，跳过');
  process.exit(0);
}

const db = new DatabaseSync(DB, { readOnly: true });

// 允许输出的列（明确非敏感）。其余列一律只报类型与长度。
const SAFE_COLUMNS = new Set(['id', 'name', 'type', 'kind', 'model_id', 'provider_id', 'provider_name', 'model_name', 'folder_name', 'source', 'namespace', 'author', 'version', 'tags', 'is_enabled', 'enabled', 'sort_order', 'order_key', 'category', 'api_type', 'transport', 'url', 'base_url', 'is_active']);

function safeValue(col, v) {
  if (v === null || v === undefined) return v;
  if (!SAFE_COLUMNS.has(col)) {
    if (typeof v === 'string') return `«string(${v.length})»`;
    if (typeof v === 'number') return '«number»';
    return '«' + typeof v + '»';
  }
  // 即使是安全列，也限制长度并剔除明显像密钥的内容
  const s = String(v);
  if (/^(sk-|Bearer )/i.test(s) || s.length > 80) return `«redacted(${s.length})»`;
  // URL 只保留主机名
  if (/^(https?:)?\/\//i.test(s)) {
    try {
      const u = new URL(s.startsWith('http') ? s : `https:${s}`);
      return `${u.protocol}//${u.host}${u.pathname}`;
    } catch (err) {
      return '«url»';
    }
  }
  return s;
}

function showTable(name, limit = 3) {
  let cols;
  try {
    cols = db.prepare(`pragma table_info(${name})`).all();
  } catch (err) {
    return;
  }
  const cnt = db.prepare(`select count(*) as c from ${name}`).get().c;
  console.log(`\n[${name}] 行数=${cnt}`);
  console.log('  列: ' + cols.map((c) => c.name).join(', '));
  if (!cnt) return;
  try {
    const rows = db.prepare(`select * from ${name} limit ${limit}`).all();
    for (const r of rows) {
      const clean = {};
      for (const [k, v] of Object.entries(r)) clean[k] = safeValue(k, v);
      console.log('  ' + JSON.stringify(clean));
    }
  } catch (err) {
    console.log('  取样失败: ' + err.message);
  }
}

for (const t of ['user_provider', 'user_model', 'mcp_server', 'agent_global_skill', 'preference', 'app_state']) {
  showTable(t);
}

// 统计各 provider 的模型数量（只输出 id 与数量）
console.log('\n=== 各 provider 的 id 与模型数 ===');
try {
  const rows = db
    .prepare('select provider_id, count(*) as n from user_model group by provider_id order by n desc')
    .all();
  for (const r of rows) console.log(`  ${r.provider_id}: ${r.n}`);
} catch (err) {
  console.log('  读取失败: ' + err.message);
}

db.close();
