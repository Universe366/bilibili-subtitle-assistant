// 只读检查正式配置的 B 站登录态（不输出 cookie 值）。
import { app, session } from 'electron';
import path from 'node:path';
import os from 'node:os';

app.setPath('userData', path.join(os.homedir(), 'AppData', 'Roaming', 'bsub-desktop'));

app.whenReady().then(async () => {
  try {
    const cookies = await session.defaultSession.cookies.get({ domain: '.bilibili.com' });
    const names = new Set(cookies.map((cookie) => cookie.name));
    const nav = await session.defaultSession.fetch(
      'https://api.bilibili.com/x/web-interface/nav',
      { headers: { referer: 'https://www.bilibili.com/' } }
    );
    const json = await nav.json();
    console.log(
      JSON.stringify({
        cookies: cookies.length,
        hasSessdata: names.has('SESSDATA'),
        isLogin: Boolean(json?.data?.isLogin),
        uname: json?.data?.uname || '',
        vip: Boolean(json?.data?.vipStatus)
      })
    );
  } catch (error) {
    console.error('AUTH_CHECK_FAILED', error.message);
  } finally {
    app.quit();
  }
});
