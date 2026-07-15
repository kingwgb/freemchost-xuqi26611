const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// TG 通知函数
async function sendTG(message) {
  const token = process.env.TG_BOT_TOKEN;
  const chatId = process.env.TG_CHAT_ID;
  
  if (!token || !chatId || token.includes('替换')) {
    console.log('未配置有效的 TG 参数，跳过通知。');
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
    });
    console.log('📢 TG 通知已发送！');
  } catch (e) {
    console.error("❌ TG推送失败:", e.message);
  }
}

(async () => {
  // 确保截图保存目录存在
  const screenshotDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir);
  }

  // 启动无头浏览器
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    console.log('🚀 正在打开 Freemchost 登录页面...');
    await page.goto('https://new.freemchost.com/login', { waitUntil: 'networkidle', timeout: 60000 }); 

    console.log('📝 正在输入账号密码...');
    await page.waitForSelector('input[type="email"]', { timeout: 15000 });
    await page.locator('input[type="email"]').fill(process.env.FREE_EMAIL);
    await page.locator('input[type="password"]').fill(process.env.FREE_PASSWORD);
    
    console.log('🔐 正在尝试登录...');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Freemchost 可能使用 SPA 登录，登录成功后 URL 不一定立即变化，
    // 因此不再把 waitForURL / waitForNavigation 作为唯一成功条件。
    console.log('⏳ 等待登录结果...');
    const loginResult = await Promise.race([
      page.locator('input[type="password"]').waitFor({ state: 'hidden', timeout: 45000 }).then(() => 'form-hidden'),
      page.getByText(/sign out/i).first().waitFor({ state: 'visible', timeout: 45000 }).then(() => 'signed-in'),
      page.waitForURL(url => !url.pathname.includes('/login'), { waitUntil: 'domcontentloaded', timeout: 45000 }).then(() => 'url-changed')
    ]).catch(() => null);

    if (!loginResult) {
      const loginError = await page.locator('[role="alert"], .alert, .error, [class*="error"]').allInnerTexts().catch(() => []);
      throw new Error(`登录结果等待超时。当前 URL: ${page.url()}${loginError.length ? `；页面提示: ${loginError.join(' | ')}` : ''}`);
    }
    console.log(`✅ 登录成功！检测方式: ${loginResult}，当前 URL: ${page.url()}`);

    console.log('📂 正在直达服务器详情页...');
    const detailResponse = await page.goto(process.env.SERVER_PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (detailResponse && !detailResponse.ok()) {
      throw new Error(`服务器详情页加载失败，HTTP 状态: ${detailResponse.status()}`);
    }
    await page.waitForTimeout(2500);

    console.log('🕵️ 正在检测并关闭 Trustpilot 弹窗...');
    for (let i = 0; i < 3; i += 1) {
      const closers = [
        page.getByText('Maybe later', { exact: true }),
        page.getByRole('button', { name: /maybe later|close|dismiss/i }),
        page.locator('[aria-label*="close" i]'),
        page.locator('button').filter({ hasText: /^\s*[×✕✖]\s*$/ })
      ];
      let closed = false;
      for (const closer of closers) {
        const button = closer.first();
        if (await button.isVisible({ timeout: 800 }).catch(() => false)) {
          await button.click({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(700);
          closed = true;
          break;
        }
      }
      if (!closed) break;
    }
    await page.keyboard.press('Escape').catch(() => {});

    console.log('🗂️ 正在切换到 [Manage] 标签页...');
    const manageCandidates = [
      page.getByRole('tab', { name: /^Manage$/i }),
      page.getByRole('link', { name: /^Manage$/i }),
      page.getByRole('button', { name: /^Manage$/i }),
      page.getByText(/^\s*Manage\s*$/i)
    ];
    let manageClicked = false;
    for (const candidate of manageCandidates) {
      const manageTab = candidate.first();
      if (await manageTab.isVisible({ timeout: 2500 }).catch(() => false)) {
        await manageTab.scrollIntoViewIfNeeded();
        await manageTab.click({ timeout: 10000 });
        manageClicked = true;
        break;
      }
    }
    if (!manageClicked) {
      throw new Error(`找不到可见的 Manage 标签。当前 URL: ${page.url()}`);
    }

    await page.waitForTimeout(2000);

    console.log('🔍 正在寻觅红色的 [Renew now] 按钮...');
    const renewBtn = page.locator('button:has-text("Renew now")').last();
    
    await renewBtn.waitFor({ state: 'visible', timeout: 10000 });
    
    if (await renewBtn.isVisible()) {
      await renewBtn.click();
      console.log('🎉 【成功】已精准点击续期按钮！');
      
      // 🚨 新增：调用 TG 发送成功通知！
      await sendTG(`🎉 <b>Freemchost 自动续期成功</b>\n\n<b>状态:</b> GitHub 机器人已成功登录并点击续期按钮。\n<b>时间:</b> ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
      
      await page.waitForTimeout(5000);
    } else {
      console.log('⚠️ 未找到续期按钮，可能已被续期，或者页面结构有变。');
      // 🚨 新增：调用 TG 发送跳过通知
      await sendTG(`⚠️ <b>Freemchost 续期跳过</b>\n\n<b>状态:</b> 页面上未找到 Renew now 按钮，可能时间未到或页面变动。`);
    }

  } catch (error) {
    console.error('❌ 自动化执行期间发生异常:', error.message);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotPath = path.join(screenshotDir, `error-${timestamp}.png`);
    
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`📸 现场截图已保存至: ${screenshotPath}`);
    } catch (screenshotError) {
      console.error('❌ 截图保存失败:', screenshotError.message);
    }
    
    // 🚨 新增：调用 TG 发送失败报警！
    await sendTG(`🚨 <b>Freemchost 自动续期失败</b>\n\n<b>错误详情:</b> <code>${error.message.substring(0, 150)}...</code>\n<b>排查:</b> 脚本已异常退出，请前往 GitHub Actions 页面下载案发现场截图！`);
    
    process.exit(1);
  } finally {
    await browser.close();
    console.log('🏁 浏览器已关闭，任务结束。');
  }
})();
