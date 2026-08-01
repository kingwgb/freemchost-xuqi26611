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

  console.log('🚀 正在启动浏览器...');

  const launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  };

  if (proxyUrl) {
    console.log(`🌐 正在初始化代理网络: ${proxyUrl}`);
    launchOptions.proxy = { server: proxyUrl };
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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

    // 跳转服务器详情页
    const targetUrl = serverPageUrl || 'https://freemchost.com/app';
    console.log('📂 正在直达服务器详情页:', targetUrl);
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });
    console.log('📍 实际到达页面 URL:', page.url());
    await page.waitForTimeout(3000); // 等待页面基础渲染

    // 🛡️ 精准清理干扰弹窗 (只点 Maybe later，绝不碰续期选项)
    console.log('🛡️ 正在扫描并清理好评/广告干扰弹窗...');
    try {
      const maybeLaterBtn = page.locator('text="Maybe later"').first();
      if (await maybeLaterBtn.isVisible({ timeout: 3000 })) {
        console.log('💥 发现 Trustpilot 好评弹窗，正在强行点击 [Maybe later] 关闭！');
        await maybeLaterBtn.click();
        await page.waitForTimeout(1500); // 等待弹窗消失动画
      }
    } catch (e) {
      console.log('👌 未发现好评干扰弹窗，继续执行。');
    }

    // 🚨 致命拦截检测：检查是否被平台识别为 VPN
    console.log('🕵️ 正在检查节点 IP 是否被风控拦截...');
    const vpnWarning = page.locator('text="The use of VPNs is not permitted"').first();
    if (await vpnWarning.isVisible({ timeout: 2000 })) {
      throw new Error('🩸 IP_BLOCKED: 节点已被 Freemchost 识别为 VPN！页面拒绝加载续期按钮。请必须更换更冷门/家宽的节点 IP！');
    }
    console.log('✅ IP 干净，未触发风控拦截！');

    // 1. 点击主页面的 [Renew now] 按钮
    console.log('🔄 正在查找主页面 [Renew now] 按钮...');
    const renewBtn = page.locator('button:has-text("Renew now"), a:has-text("Renew now")').first();
    await renewBtn.waitFor({ state: 'visible', timeout: 30000 });
    
    console.log('👉 找到 [Renew now] 按钮，正在点击...');
    await renewBtn.click();

    // 2. 等待 "Keep your server online" 弹窗出现并点击 [48 hours]
    console.log('📋 正在等待续期选择弹窗出现...');
    const hours48Option = page.locator('text="48 hours"').first();
    await hours48Option.waitFor({ state: 'visible', timeout: 20000 });

    console.log('👉 成功捕获续期弹窗！正在点击 [48 hours] 免费续期选项...');
    await hours48Option.click();

    // 3. 等待响应并保存成功截图
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
