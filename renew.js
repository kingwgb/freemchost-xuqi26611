const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// 确保截图保存目录存在
if (!fs.existsSync('screenshots')) {
  fs.mkdirSync('screenshots');
}

// Telegram 通知工具
async function sendTelegramMessage(botToken, chatId, text) {
  if (!botToken || !chatId) return;
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' })
    });
    console.log('📢 TG 通知已发送！');
  } catch (err) {
    console.error('❌ TG 通知发送失败:', err.message);
  }
}

(async () => {
  const email = process.env.FREE_EMAIL;
  const password = process.env.FREE_PASSWORD;
  const serverPageUrl = process.env.SERVER_PAGE_URL;
  const proxyUrl = process.env.PROXY_URL;
  const tgToken = process.env.TG_BOT_TOKEN;
  const tgChatId = process.env.TG_CHAT_ID;

  console.log('🚀 正在启动隐藏特征的伪装浏览器...');

  const launchOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled', // 核心：禁用 Chrome 自动化标记
      '--disable-infobars',
      '--window-size=1920,1080'
    ]
  };

  if (proxyUrl) {
    console.log(`🌐 正在初始化代理网络: ${proxyUrl}`);
    launchOptions.proxy = { server: proxyUrl };
  }

  const browser = await chromium.launch(launchOptions);
  
  // 创建模拟真实用户的 Context
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    extraHTTPHeaders: {
      'accept-language': 'en-US,en;q=0.9'
    }
  });

  // 🛡️ 注入 Stealth 脚本：抹除 webdriver 特征，模仿正常人浏览器
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });

  const page = await context.newPage();

  try {
    console.log('🚀 正在打开 Freemchost 登录页面...');
    await page.goto('https://freemchost.com/login', { waitUntil: 'networkidle', timeout: 60000 });

    console.log('📝 正在输入账号密码...');
    await page.fill('input[type="email"], input[name="email"]', email);
    await page.fill('input[type="password"], input[name="password"]', password);

    console.log('🔐 正在尝试登录...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 60000 }),
      page.click('button[type="submit"]')
    ]);

    console.log('✅ 登录成功！当前 URL:', page.url());

    // 直达服务器详情页
    const targetUrl = serverPageUrl || 'https://freemchost.com/app';
    console.log('📂 正在直达服务器详情页:', targetUrl);
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });
    console.log('📍 实际到达页面 URL:', page.url());
    await page.waitForTimeout(4000); // 留足页面 JS 渲染时间

    // 1. 处理可能挡住屏幕的广告/好评弹窗 (如 Maybe later)
    try {
      const maybeLaterBtn = page.getByText(/maybe later/i).first();
      if (await maybeLaterBtn.isVisible({ timeout: 3000 })) {
        console.log('💥 发现干扰弹窗，正在点击 [Maybe later] 关闭...');
        await maybeLaterBtn.click();
        await page.waitForTimeout(1500);
      }
    } catch (e) {}

    // 2. 寻找主页面的 [Renew now] 按钮并点击
    console.log('🔄 正在寻找 [Renew now] 按钮...');
    
    // 强制滚动并等待按钮出现，兼容任意包裹标签
    const renewBtn = page.locator('*:has-text("Renew now")').last();
    await renewBtn.waitFor({ state: 'visible', timeout: 30000 });
    
    console.log('👉 找到 [Renew now] 按钮，点击中...');
    await renewBtn.click({ force: true });

    // 3. 等待弹窗出现并选择 48 hours
    console.log('📋 正在等待续期选择弹窗...');
    const hours48Option = page.locator('*:has-text("48 hours")').last();
    await hours48Option.waitFor({ state: 'visible', timeout: 20000 });

    console.log('👉 点击 [48 hours] 选项...');
    await hours48Option.click({ force: true });

    // 4. 完成续期并存图
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'screenshots/renew_success.png', fullPage: true });

    const successMsg = '🎉 Freemchost 服务器已成功选择 48小时 续期！';
    console.log('✅ ' + successMsg);
    await sendTelegramMessage(tgToken, tgChatId, successMsg);

  } catch (error) {
    console.error('❌ 执行过程中出错:', error.message);
    await page.screenshot({ path: 'screenshots/renew_error.png', fullPage: true });
    await sendTelegramMessage(tgToken, tgChatId, `⚠️ Freemchost 续期失败: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
    console.log('🏁 浏览器已关闭，任务结束。');
  }
})();
