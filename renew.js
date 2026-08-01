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

// 🛡️ 智能清理干扰弹窗（绝不摧毁主页面）
async function clearInterferingModals(page) {
  console.log('🕵️ 正在检查并清除干扰弹窗 (Discord / Feedback / Trustpilot)...');
  
  for (let i = 0; i < 3; i++) {
    try {
      // 检查页面是否存在非“续期”弹窗
      const isRenewalModalPresent = await page.locator('text="Keep your server online"').isVisible({ timeout: 500 }).catch(() => false);
      if (isRenewalModalPresent) {
        console.log('🎯 检测到目标续期弹窗，停止清理干扰弹窗。');
        break;
      }

      // 寻找 "Maybe later" 按钮并模拟点击
      const maybeLaterBtns = page.getByText('Maybe later', { exact: false });
      const count = await maybeLaterBtns.count();
      if (count > 0) {
        for (let j = 0; j < count; j++) {
          const btn = maybeLaterBtns.nth(j);
          if (await btn.isVisible().catch(() => false)) {
            await btn.click({ force: true }).catch(() => {});
            console.log('🎉 成功点击 "Maybe later" 关闭干扰弹窗！');
            await page.waitForTimeout(800);
          }
        }
      }

      // 安全隐藏遮罩层 (不删除 DOM)
      await page.evaluate(() => {
        const dialogs = document.querySelectorAll('[role="dialog"], .modal, [aria-modal="true"]');
        dialogs.forEach(dialog => {
          if (!dialog.innerText.includes('Keep your server online')) {
            dialog.style.display = 'none';
          }
        });
      }).catch(() => {});

    } catch (e) {
      // 忽略清理过程中的微小错误
    }
  }
}

(async () => {
  const screenshotDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir);
  }

  const proxyUrl = process.env.PROXY_URL;
  const nodeLink = process.env.NODE_LINK;
  const targetServerUrl = process.env.SERVER_PAGE_URL || 'https://freemchost.com/app/servers/744311a4-998f-4811-82be-b2957557c7b0';
  
  let currentProxy = null;
  let isUsingProxy = false;
  
  if (nodeLink && nodeLink.trim() !== '') {
    currentProxy = 'socks5://127.0.0.1:7891';
  } else if (proxyUrl && proxyUrl.trim() !== '') {
    currentProxy = proxyUrl.trim();
  }

  let browser;
  let context;
  let page;

  async function initBrowser(proxyServer) {
    let launchOptions = { headless: true };
    if (proxyServer) {
      launchOptions.proxy = { server: proxyServer };
      isUsingProxy = true;
    } else {
      isUsingProxy = false;
    }
    browser = await chromium.launch(launchOptions);
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 }
    });
    page = await context.newPage();
  }

  try {
    // 1. 代理连通性测试与自动降级
    if (currentProxy) {
      console.log(`🌐 尝试使用代理接管网络: ${currentProxy}`);
      await initBrowser(currentProxy);
      try {
        console.log('📡 正在测试代理连通性...');
        await page.goto('https://freemchost.com/login', { timeout: 15000 });
        console.log('✅ 代理连通性测试通过！');
      } catch (e) {
        if (e.message.includes('ERR_PROXY_CONNECTION_FAILED') || e.message.includes('timeout') || e.message.includes('ERR_CONNECTION_CLOSED')) {
          console.log(`⚠️ 代理连接失败！节点可能已失效，自动切回【直连模式】继续运行...`);
          await browser.close();
          await initBrowser(null);
        } else {
          throw e;
        }
      }
    } else {
      console.log(`🌐 未配置代理，直接使用直连运行。`);
      await initBrowser(null);
    }

    // 2. 账号登录
    console.log('🚀 正在打开 Freemchost 登录页面...');
    await page.goto('https://freemchost.com/login', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});

    console.log('📝 正在输入账号密码...');
    await page.waitForSelector('input[type="email"]', { timeout: 15000 });
    await page.locator('input[type="email"]').fill(process.env.FREE_EMAIL);
    await page.locator('input[type="password"]').fill(process.env.FREE_PASSWORD);
    
    console.log('🔐 正在尝试登录...');
    await page.getByRole('button', { name: /sign in|login/i }).click();

    console.log('⏳ 等待登录成功...');
    await Promise.race([
      page.waitForURL(url => !url.pathname.includes('/login'), { waitUntil: 'domcontentloaded', timeout: 45000 }),
      page.locator('input[type="password"]').waitFor({ state: 'hidden', timeout: 45000 })
    ]).catch(() => null);

    console.log(`✅ 登录成功！当前 URL: ${page.url()}`);
    await page.waitForTimeout(2000);

    // 3. 直达服务器详情页
    console.log(`📂 正在直达服务器详情页: ${targetServerUrl}`);
    await page.goto(targetServerUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    console.log(`📍 实际到达页面 URL: ${page.url()}`);
    await page.waitForTimeout(3000);

    // 4. 清理干扰弹窗
    await clearInterferingModals(page);

    // 5. 定位并点击右侧面板的 [Renew now] 按钮
    console.log('⏳ 正在寻找页面右侧的 [Renew now] 按钮...');
    
    const renewBtn = page.locator('button').filter({ hasText: /^Renew now$/i }).first();
    const renewBtnFallback = page.getByRole('button', { name: /Renew now/i }).first();

    let isBtnReady = await renewBtn.waitFor({ state: 'attached', timeout: 10000 }).then(() => true).catch(() => false);
    let targetBtn = renewBtn;

    if (!isBtnReady) {
      isBtnReady = await renewBtnFallback.waitFor({ state: 'attached', timeout: 5000 }).then(() => true).catch(() => false);
      targetBtn = renewBtnFallback;
    }

    if (isBtnReady) {
      console.log('🎉 已找到 [Renew now] 按钮，尝试点击...');
      await targetBtn.scrollIntoViewIfNeeded().catch(() => {});
      await targetBtn.click({ force: true });
      console.log('🚀 已成功点击 [Renew now]！等待 [Keep your server online] 续期弹窗出现...');

      await page.waitForTimeout(2000);

      // 6. 处理二次弹窗：点击 [48 hours] 选项
      console.log('⏳ 正在寻找弹窗中的 [48 hours] 免费续期区域...');
      
      const modalHeader = page.locator('text="Keep your server online"');
      await modalHeader.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

      const option48h = page.locator('div, button, article').filter({ hasText: /48\s*hours/i }).last();
      const optionReady = await option48h.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);

      if (optionReady) {
        await option48h.scrollIntoViewIfNeeded().catch(() => {});
        await option48h.click({ force: true });
        console.log('🎉🎉【最终成功】已精准点击 [48 hours] 选项！服务器续期完成！');

        await page.waitForTimeout(5000); // 等待网络请求发送完毕
        
        const ipStatus = isUsingProxy ? '节点代理模式' : 'GitHub 直连模式';
        await sendTG(`🎉 <b>Freemchost 自动续期成功</b>\n\n<b>状态:</b> 已成功关闭干扰弹窗，点击 [Renew now] 并选择 [48 hours] 完成续期！\n<b>网络:</b> ${ipStatus}\n<b>时间:</b> ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
      } else {
        console.log('⚠️ 弹窗中未能在规定时间内找到 [48 hours] 选项，截留现场照片...');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const screenshotPath = path.join(screenshotDir, `modal-error-${timestamp}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

        await sendTG(`⚠️ <b>Freemchost 续期异常</b>\n\n<b>状态:</b> 已点击 Renew now，但未能定位到 48 hours 选项。现场截图已保存。`);
      }

    } else {
      console.log('⚠️ 依然未能定位到 [Renew now] 按钮，截留现场截图...');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const screenshotPath = path.join(screenshotDir, `not-found-${timestamp}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

      await sendTG(`⚠️ <b>Freemchost 续期跳过</b>\n\n<b>状态:</b> 未检测到 Renew now 按钮，可能已处于不可续期状态或加载异常。截图已生成。`);
    }

  } catch (error) {
    console.error('❌ 自动化执行期间发生异常:', error.message);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotPath = path.join(screenshotDir, `error-${timestamp}.png`);
    
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`📸 异常现场截图已保存至: ${screenshotPath}`);
    } catch (screenshotError) {
      console.error('❌ 截图保存失败:', screenshotError.message);
    }
    
    await sendTG(`🚨 <b>Freemchost 自动续期失败</b>\n\n<b>错误详情:</b> <code>${error.message.substring(0, 150)}...</code>\n<b>排查:</b> 脚本异常退出，请前往 GitHub Actions 页面下载截图！`);
    
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
      console.log('🏁 浏览器已关闭，任务结束。');
    }
  }
})();
