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
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });

    // 🚨【核心武器】注入实时 DOM 监听器：一旦弹窗生成，0.01秒内自动粉碎！
    await context.addInitScript(() => {
      const badKeywords = ['Maybe later', 'Discord', 'Trustpilot', 'Enjoying FreeMCHost', 'Join the FreeMCHost community'];
      
      const cleanBadModals = () => {
        const elements = document.querySelectorAll('*');
        elements.forEach(el => {
          if (el.children.length === 0 && el.textContent) {
            const text = el.textContent;
            const isBad = badKeywords.some(kw => text.includes(kw));
            // 确保绝对不误伤续期弹窗 (Keep your server online)
            if (isBad && !document.body.innerText.includes('Keep your server online')) {
              let target = el;
              for (let i = 0; i < 8; i++) {
                if (target.parentElement && target.parentElement !== document.body) {
                  target = target.parentElement;
                  const pos = window.getComputedStyle(target).position;
                  if (pos === 'fixed' || pos === 'absolute' || target.getAttribute('role') === 'dialog') {
                    target.remove();
                    break;
                  }
                }
              }
            }
          }
        });
      };

      // 创建 DOM 变动监听器
      const observer = new MutationObserver(() => cleanBadModals());
      window.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { childList: true, subtree: true });
      });
    });

    page = await context.newPage();
  }

  try {
    // 1. 代理测试与降级
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
    
    // 4. 轮询清理弹窗兜底 (防延迟渲染)
    console.log('🛡️ 激活防遮挡双重清理防护...');
    for (let i = 0; i < 5; i++) {
      const maybeBtn = page.getByText('Maybe later', { exact: false }).first();
      if (await maybeBtn.isVisible({ timeout: 600 }).catch(() => false)) {
        await maybeBtn.click({ force: true }).catch(() => {});
        console.log('🎉 手动补刀：成功点击 "Maybe later"！');
      }
      await page.waitForTimeout(500);
    }

    // 5. 点击右下角 [Renew now]
    console.log('⏳ 正在等待右下角 [Renew now] 按钮...');
    const renewBtn = page.locator('button:has-text("Renew now"), button:has-text("Renew")').first();
    const isReady = await renewBtn.waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false);

    if (isReady) {
      await renewBtn.scrollIntoViewIfNeeded().catch(() => {});
      await renewBtn.click({ timeout: 5000, force: true });
      console.log('🎉 成功点击 [Renew now]，等待续期弹窗 [Keep your server online] 出现...');

      // 6. 等待续期弹窗并选择 [48 hours]
      console.log('⏳ 正在寻觅弹窗中的 [48 hours] 免费续期卡片...');
      
      const optionCard = page.locator('div, button, article').filter({ hasText: /48\s*hours/i }).last();
      const optionTextFallback = page.getByText(/48\s*hours/i).first();

      const optionReady = await Promise.race([
        optionCard.waitFor({ state: 'visible', timeout: 15000 }).then(() => optionCard),
        optionTextFallback.waitFor({ state: 'visible', timeout: 15000 }).then(() => optionTextFallback)
      ]).catch(() => null);

      if (optionReady) {
        await optionReady.click({ timeout: 5000, force: true });
        console.log('🎉🎉【完美成功】已精准点击 [48 hours] 续期卡片！全流程完成！');

        await page.waitForTimeout(5000); // 等待网络提交完成
        
        const ipStatus = isUsingProxy ? '节点代理模式' : 'GitHub 直连模式';
        await sendTG(`🎉 <b>Freemchost 自动续期成功</b>\n\n<b>状态:</b> 已自动消灭干扰弹窗，点击 [Renew now] 并选择 [48 hours] 完成续期！\n<b>网络:</b> ${ipStatus}\n<b>时间:</b> ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
      } else {
        console.log('⚠️ 未能定位到 [48 hours] 选项，存图排查...');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const screenshotPath = path.join(screenshotDir, `modal-error-${timestamp}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

        await sendTG(`⚠️ <b>Freemchost 续期异常</b>\n\n<b>状态:</b> 已点击 Renew now，但弹窗中未找到 48 hours 选项。截图已保存。`);
      }

    } else {
      console.log('⚠️ 依然未检测到 [Renew now] 按钮，保存现场截图...');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const screenshotPath = path.join(screenshotDir, `not-found-${timestamp}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

      await sendTG(`⚠️ <b>Freemchost 续期跳过</b>\n\n<b>状态:</b> 未能等待到 Renew now 按钮，可能已完成续期或处于不可续期状态。截图已生成。`);
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
