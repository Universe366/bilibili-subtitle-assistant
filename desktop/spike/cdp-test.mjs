import { app, BrowserWindow } from 'electron';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + label)), ms))]);

console.log('boot');

app.whenReady().then(async () => {
  console.log('ready');
  const win = new BrowserWindow({ width: 900, height: 600, show: true });
  console.log('window created');
  try {
    await win.loadURL('data:text/html,<h1>hello</h1>');
    console.log('loaded', win.webContents.getURL());
  } catch (e) {
    console.log('load failed', e.message);
  }

  const wc = win.webContents;
  try {
    wc.debugger.attach('1.3');
    console.log('attached:', wc.debugger.isAttached());
  } catch (e) {
    console.log('attach failed:', e.message);
  }

  for (const cmd of ['Runtime.enable', 'Page.enable', 'Page.getFrameTree']) {
    try {
      const r = await timeout(wc.debugger.sendCommand(cmd), 5000, cmd);
      console.log(cmd, 'OK', JSON.stringify(r).slice(0, 160));
    } catch (e) {
      console.log(cmd, 'FAIL', e.message);
    }
  }

  try {
    wc.debugger.detach();
    console.log('detached');
  } catch (e) {
    console.log('detach failed', e.message);
  }

  await sleep(300);
  app.exit(0);
}).catch((e) => {
  console.log('FATAL', e && e.stack || e);
  app.exit(1);
});
