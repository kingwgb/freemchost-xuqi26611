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

  // 封装浏览器初始化函数
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
    page = await context.newPage();
  }

  try {
    // 1. 尝试携带代理启动
    if (currentProxy) {
      console.log(`🌐 尝试使用代理接管网络: ${currentProxy}`);
      await initBrowser(currentProxy);
      try {
        console.log('📡 正在测试代理连通性...');
        await page.goto('https://freemchost.com/login', { timeout: 15000 });
        console.log('✅ 代理连通性测试通过！');
      } catch (e) {
        if (e.message.includes('ERR_PROXY_CONNECTION_FAILED') || e.message.includes('timeout') || e.message.includes('ERR_CONNECTION_CLOSED')) {
          console.log(`⚠️ 代理连接失败 (${e.message.split('\n')[0]})！节点可能已失效。`);
          console.log('🔄 触发双重保险：正在销毁当前浏览器，回退至【直连模式】继续运行...');
          await browser.close();
          await initBrowser(null); // 回退到无代理直连
        } else {
          throw e;
        }
      }
    } else {
      console.log(`🌐 未配置代理，直接使用直连运行。`);
      await initBrowser(null);
    }

    // 2. 正式开始执行流程
    console.log('🚀 正在打开 Freemchost 登录页面...');
    // 使用新版域名
    await page.goto('https://freemchost.com/login', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});

    console.log('📝 正在输入账号密码...');
    await page.waitForSelector('input[type="email"]', { timeout: 15000 });
    await page.locator('input[type="email"]').fill(process.env.FREE_EMAIL);
    await page.locator('input[type="password"]').fill(process.env.FREE_PASSWORD);
    
    console.log('🔐 正在尝试登录...');
    await page.getByRole('button', { name: /sign in|login/i }).click();

    console.log('⏳ 等待登录结果并跳转控制台...');
    const loginResult = await Promise.race([
      page.waitForURL(url => url.pathname.includes('/app'), { waitUntil: 'domcontentloaded', timeout: 45000 }).then(() => 'url-changed'),
      page.locator('text="A server is about to expire"').waitFor({ state: 'visible', timeout: 45000 }).then(() => 'dashboard-loaded')
    ]).catch(() => null);

    if (!loginResult) {
      throw new Error(`登录超时或未成功跳转到 /app 首页。当前 URL: ${page.url()}`);
    }
    console.log(`✅ 成功进入控制台面板！当前 URL: ${page.url()}`);
    
    await page.waitForTimeout(3000); // 稍微等待数据渲染

    // 3. 匹配新版 UI 的续期按钮 (直接在首页操作)
    console.log('🔍 正在首页寻觅 [Renew] 续期按钮...');
    // 匹配页面上包含 "Renew" 文本的按钮（适应你截图中的红色 Renew -> 按钮）
    const renewBtn = page.locator('button:has-text("Renew"), a:has-text("Renew")').first();
    
    if (await renewBtn.isVisible({ timeout: 10000 })) {
      await renewBtn.click();
      console.log('🎉 【成功】已精准点击首页的 Renew 按钮！');
      
      const ipStatus = isUsingProxy ? '节点代理模式' : 'GitHub 直连模式 (触发降级或未配置)';
      await sendTG(`🎉 <b>Freemchost 自动续期成功</b>\n\n<b>状态:</b> 脚本已成功适应新版 UI 并点击续期按钮。\n<b>网络:</b> ${ipStatus}\n<b>时间:</b> ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
      
      await page.waitForTimeout(5000);
    } else {
      console.log('⚠️ 首页未找到 Renew 按钮，可能已被续期，或者还未到期。');
      await sendTG(`⚠️ <b>Freemchost 续期跳过</b>\n\n<b>状态:</b> /app 面板上未找到 Renew 按钮，可能时间未到或已续期。`);
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
    
    await sendTG(`🚨 <b>Freemchost 自动续期失败</b>\n\n<b>错误详情:</b> <code>${error.message.substring(0, 150)}...</code>\n<b>排查:</b> 脚本已异常退出，请前往 GitHub Actions 页面下载案发现场截图！`);
    
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
      console.log('🏁 浏览器已关闭，任务结束。');
    }
  }
})();
