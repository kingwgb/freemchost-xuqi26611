const { chromium } = require('playwright');
const fs = require('fs');

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

// 🛡️ 扫除遮罩与干扰弹窗
async function forceDismissPopups(page) {
  console.log('🛡️ 正在执行 DOM 级弹窗粉碎策略...');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    const allEls = Array.from(document.querySelectorAll('*'));
    // 点击常规关闭按钮
    const targets = allEls.filter(el => 
      el.children.length === 0 && 
      ['maybe later', 'i need help'].includes(el.textContent.trim().toLowerCase())
    );
    targets.forEach(el => el.click());

    // 移除干扰 Modal 容器
    const ideaHeader = allEls.find(el => el.textContent && el.textContent.includes('Got an idea to make FreeMCHost better'));
    if (ideaHeader) {
      let container = ideaHeader;
      for (let i = 0; i < 5; i++) {
        if (container.parentElement && container.parentElement !== document.body) {
          container = container.parentElement;
        }
      }
      if (container && container !== document.body) {
        container.remove();
      }
    }
  });
  await page.waitForTimeout(1000);
}

(async () => {
  const email = process.env.FREE_EMAIL;
  const password = process.env.FREE_PASSWORD;
  const serverPageUrl = process.env.SERVER_PAGE_URL;
  const proxyUrl = process.env.PROXY_URL;
  const tgToken = process.env.TG_BOT_TOKEN;
  const tgChatId = process.env.TG_CHAT_ID;

  console.log('🚀 正在启动伪装浏览器...');

  const launchOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080'
    ]
  };

  if (proxyUrl) {
    console.log(`🌐 正在初始化代理网络: ${proxyUrl}`);
    launchOptions.proxy = { server: proxyUrl };
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US'
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
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

    const targetUrl = serverPageUrl || 'https://freemchost.com/app';
    console.log('📂 正在直达服务器详情页:', targetUrl);
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });
    console.log('📍 实际到达页面 URL:', page.url());
    await page.waitForTimeout(3000);

    // 检查代理 IP 是否被 FreeMCHost 拦截
    const pageContent = await page.content();
    if (pageContent.includes('use of VPNs is not permitted') || pageContent.includes("Couldn't load this server")) {
      throw new Error('当前代理 IP 被 FreeMCHost 识别并拦截 ("The use of VPNs is not permitted")，无法加载服务器详情，请更换干净节点！');
    }

    // 1. 扫除干扰弹窗
    await forceDismissPopups(page);

    // 2. 查找并点击 [Renew now] 按钮
    console.log('🔄 正在寻找并点击 [Renew now] 按钮...');
    let renewClicked = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      renewClicked = await page.evaluate(() => {
        const allBtns = Array.from(document.querySelectorAll('button, a, div[role="button"], span'));
        const target = allBtns.find(b => b.textContent && b.textContent.trim().toLowerCase() === 'renew now');
        if (target) {
          target.click();
          return true;
        }
        return false;
      });

      if (renewClicked) {
        console.log('👉 已成功触发 [Renew now] 按钮点击！');
        break;
      }
      
      console.log(`⏳ 第 ${attempt + 1} 次尝试未查找到按钮，再次扫除干扰弹窗...`);
      await forceDismissPopups(page);
      await page.waitForTimeout(2000);
    }

    if (!renewClicked) {
      throw new Error('未能在页面找到 [Renew now] 按钮，请检查页面结构。');
    }

    // 3. 等待 "Keep your server online" 续期弹窗出现并点击 [48 hours]
    console.log('📋 正在等待 48小时 续期选择弹窗...');
    await page.waitForTimeout(2000);

    const clicked48h = await page.evaluate(() => {
      const allEls = Array.from(document.querySelectorAll('*'));
      // 寻找包含 "48 hours" 的文本节点
      const targetText = allEls.find(el => 
        el.children.length === 0 && 
        el.textContent.trim().toLowerCase().includes('48 hours')
      );
      if (targetText) {
        // 向上寻找该选项的外层可点击容器
        let clickableParent = targetText;
        for (let i = 0; i < 4; i++) {
          if (clickableParent.parentElement && clickableParent.parentElement !== document.body) {
            clickableParent = clickableParent.parentElement;
            if (clickableParent.tagName === 'BUTTON' || 
                clickableParent.getAttribute('role') === 'button' || 
                clickableParent.className.includes('cursor-pointer') ||
                clickableParent.className.includes('option') ||
                clickableParent.className.includes('card')) {
              clickableParent.click();
              return true;
            }
          }
        }
        // 如果未定位到特定 class 属性，则直接点击外层容器
        clickableParent.click();
        return true;
      }
      return false;
    });

    if (!clicked48h) {
      console.log('⚠️ DOM 定位未直接触发，尝试 Playwright Locator 强行点击 [48 hours]...');
      const hours48Option = page.locator('text=/48 hours/i').first();
      await hours48Option.waitFor({ state: 'visible', timeout: 15000 });
      await hours48Option.click({ force: true });
    }

    // 4. 等待响应并保存成功截图
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'screenshots/renew_success.png', fullPage: true });

    const successMsg = '🎉 Freemchost 服务器已成功点击 48小时 续期！';
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
