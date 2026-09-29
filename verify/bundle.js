// 用 esbuild 把侧边栏打包成一个 IIFE，再注入到 jsdom 里执行。
// 这样可以在没有真实 Chrome 扩展环境的情况下，完整验证面板的渲染与逻辑。
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const EXT = path.resolve(__dirname, '..', 'bilibili-subtitle-assistant');
const OUT = path.join(__dirname, 'build', 'panel.iife.js');

async function build() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, 'test-entry.js')],
    bundle: true,
    format: 'iife',
    outfile: OUT,
    target: 'chrome110',
    logLevel: 'warning',
    sourcemap: false,
    loader: { '.css': 'text' }
  });
  return result;
}

if (require.main === module) {
  build()
    .then(() => console.log('bundled ->', OUT, fs.statSync(OUT).size, 'bytes'))
    .catch((err) => {
      console.error('BUNDLE FAILED');
      console.error(err.message);
      process.exit(1);
    });
}

module.exports = { build, OUT };
