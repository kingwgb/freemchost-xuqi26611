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
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, me Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 }
    });
    page = await context.newPage();
  }

  try {
    // 1. 代理连通性测试与降级
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

    // 🔨【高频打地鼠】启动全局后台弹窗自动点灭守护者 (每 500ms 监控一次)
    const popupDaemon = setInterval(async () => {
      try {
        if (!page || page.isClosed()) return;
        
        // 如果已经到了最终续期选择框，停止点灭，避免误关
        const isRenewalModalOpen = await page.locator('text="Keep your server online"').isVisible().catch(() => false);
        if (isRenewalModalOpen) return;

        // 自动点击 "Maybe later" 按钮
        const maybeLaterBtns = page.getByText('Maybe later', { exact: false });
        const count = await maybeLaterBtns.count().catch(() => 0);
        if (count > 0) {
          for (let i = 0; i < count; i++) {
            const btn = maybeLaterBtns.nth(i);
            if (await btn.isVisible().catch(() => false)) {
              await btn.click({ force: true }).catch(() => {});
              console.log('💥 [后台守护者] 捕获并强制击灭干扰弹窗 (Maybe later)！');
            }
          }
        }
      } catch (e) {
        // 忽略后台扫描微小异常
      }
    }, 500);

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

    // 🚨 检查是否触碰了平台的 VPN/IP 封锁拦截
    let vpnBlocked = await page.locator('text="The use of VPNs is not permitted"').isVisible().catch(() => false);
    let loadFailed = await page.locator('text="Couldn\'t load this server."').isVisible().catch(() => false);

    if (vpnBlocked || loadFailed) {
      console.log('⚠️ 检测到页面提示 VPN 拦截或服务器加载失败，尝试刷新页面重试一次...');
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(4000);
      
      vpnBlocked = await page.locator('text="The use of VPNs is not permitted"').isVisible().catch(() => false);
      loadFailed = await page.locator('text="Couldn\'t load this server."').isVisible().catch(() => false);
    }

    if (vpnBlocked || loadFailed) {
      console.log('❌ 确认被平台识别为机房/VPN IP 拦截，无法加载服务器数据！');
      clearInterval(popupDaemon);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const screenshotPath = path.join(screenshotDir, `vpn-blocked-${timestamp}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

      await sendTG(`🚨 <b>Freemchost 续期失败 (IP被拦截)</b>\n\n<b>原因:</b> 平台检测到当前 IP 为 VPN/数据中心 IP，拒绝加载服务器数据（提示: Couldn't load this server）。\n<b>建议:</b> 请检查 NODE_LINK 代理节点配置，确保节点可用且为原生/家宽 IP！`);
      process.exit(1);
    }

    // 4. 轮询点击 [Renew now] 按钮与后续续期操作
    console.log('🔄 开始监控 [Renew now] 按钮与续期流程...');
    
    let success = false;
    const maxWaitTime = 40000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      // 检查 A: 是否弹出终极续期选单 [Keep your server online]
      const isRenewalModalVisible = await page.locator('text="Keep your server online"').isVisible().catch(() => false);

      if (isRenewalModalVisible) {
        console.log('🎉 成功捕获续期弹窗 [Keep your server online]！准备选择 [48 hours]...');
        await page.waitForTimeout(1000);

        const option48h = page.locator('div, button, article, p, span').filter({ hasText: /48\s*hours/i }).last();
        if (await option48h.isVisible().catch(() => false)) {
          await option48h.scrollIntoViewIfNeeded().catch(() => {});
          await option48h.click({ force: true });
          console.log('🎉🎉【完美成功】已精准点击 [48 hours] 免费续期卡片！全流程完成！');
          success = true;
          break;
        }
      }

      // 检查 B: 点击右侧面板 [Renew now] 按钮
      if (!isRenewalModalVisible) {
        const renewBtn = page.locator('button:has-text("Renew now"), button:has-text("Renew")').first();
        if (await renewBtn.isVisible().catch(() => false)) {
          console.log('🎯 捕获到 [Renew now] 按钮，尝试点击...');
          await renewBtn.scrollIntoViewIfNeeded().catch(() => {});
          await renewBtn.click({ force: true }).catch(() => {});
          await page.waitForTimeout(2000);
        }
      }

      await page.waitForTimeout(1000);
    }

    clearInterval(popupDaemon);

    // 5. 结果处理
    if (success) {
      await page.waitForTimeout(5000);
      const ipStatus = isUsingProxy ? '节点代理模式' : 'GitHub 直连模式';
      await sendTG(`🎉 <b>Freemchost 自动续期成功</b>\n\n<b>状态:</b> 已自动击灭干扰弹窗，点击 [Renew now] 并选择 [48 hours] 完成续期！\n<b>网络:</b> ${ipStatus}\n<b>时间:</b> ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
    } else {
      console.log('⚠️ 轮询超时，未能完成续期，截图保存现场...');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const screenshotPath = path.join(screenshotDir, `not-found-${timestamp}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

      await sendTG(`⚠️ <b>Freemchost 续期跳过</b>\n\n<b>状态:</b> 未能完成续期操作，可能已处于不可续期状态或页面加载异常。截图已生成。`);
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
