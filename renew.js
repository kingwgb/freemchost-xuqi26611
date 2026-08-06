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

    // 自动重试机制：解决页面偶发性加载不全或 "Couldn't load this server" 问题
    for (let retry = 0; retry < 3; retry++) {
      await forceDismissPopups(page);

      const hasRenewBtn = await page.evaluate(() => {
        const text = document.body.innerText || '';
        return text.toLowerCase().includes('renew now');
      });

      if (hasRenewBtn) {
        console.log('✅ 成功检测到服务器详情及 [Renew now] 按钮！');
        break;
      }

      console.log(`⏳ 第 ${retry + 1} 次尝试：页面未完全加载服务器组件，正在刷新重试...`);
      await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(3000);
    }

    // 1. 点击 [Renew now] 按钮
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
        console.log('👉 已成功点击 [Renew now] 按钮！');
        break;
      }
      
      console.log(`⏳ 第 ${attempt + 1} 次尝试未查找到按钮，再次扫除干扰弹窗...`);
      await forceDismissPopups(page);
      await page.waitForTimeout(2000);
    }

    if (!renewClicked) {
      throw new Error('未能在页面找到 [Renew now] 按钮，页面可能未正常渲染。');
    }

    // 2. 等待 "Keep your server online" 弹窗，并精确点击 "48 hours" 选项
    console.log('📋 正在等待续期选项弹窗...');
    await page.waitForTimeout(2000);

    let clicked48h = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      clicked48h = await page.evaluate(() => {
        const allEls = Array.from(document.querySelectorAll('*'));
        // 查找包含 48 hours 文本的底层节点
        const targetText = allEls.find(el => 
          el.children.length === 0 && 
          el.textContent.trim().toLowerCase().includes('48 hours')
        );

        if (targetText) {
          // 向上向上寻找到卡片容器节点并触发点击
          let clickableParent = targetText;
          for (let i = 0; i < 5; i++) {
            if (clickableParent.parentElement && clickableParent.parentElement !== document.body) {
              clickableParent = clickableParent.parentElement;
              // 触发卡片或容器的点击事件
              if (clickableParent.tagName === 'BUTTON' || 
                  clickableParent.getAttribute('role') === 'button' ||
                  clickableParent.onclick ||
                  (clickableParent.className && typeof clickableParent.className === 'string' && 
                   (clickableParent.className.includes('border') || clickableParent.className.includes('card') || clickableParent.className.includes('rounded')))) {
                clickableParent.click();
                return true;
              }
            }
          }
          // 保底直接点击文本节点本身
          targetText.click();
          return true;
        }
        return false;
      });

      if (clicked48h) {
        console.log('👉 已成功选择 [48 hours] 免费续期卡片！');
        break;
      }

      await page.waitForTimeout(1500);
    }

    if (!clicked48h) {
      console.log('⚠️ DOM 层未找到 48h 选项，尝试使用 Playwright Locator 强行点击...');
      const hours48Option = page.locator('text=/48 hours/i').first();
      await hours48Option.waitFor({ state: 'visible', timeout: 10000 });
      await hours48Option.click({ force: true });
    }

    // 3. 完成续期操作，保存截图并发送通知
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
