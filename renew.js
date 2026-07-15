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
    await page.locator('button:has-text("Sign in")').click();
    
    console.log('⏳ 等待登录跳转...');
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
    console.log('✅ 登录成功！');

    console.log('📂 正在直达服务器详情页...');
    await page.goto(process.env.SERVER_PAGE_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // 🛡️ 终极防线 1：强力物理净化 DOM
    // 不管什么时候弹出、弹出什么，直接从网页 HTML 里把所有“弹窗、遮罩、对话框、广告”元素连根拔起
    console.log('🛠️ 正在注入强力净化脚本，物理粉碎一切潜在的流氓弹窗与遮罩...');
    await page.evaluate(() => {
      const purge = () => {
        const selectors = [
          'div[class*="modal" i]', 
          'div[class*="dialog" i]', 
          'div[class*="overlay" i]', 
          'div[class*="popup" i]',
          '.fixed.inset-0', // Tailwind 遮罩层常用类名
          'iframe'          // 有时候是第三方广告/弹窗 iframe
        ];
        selectors.forEach(selector => {
          document.querySelectorAll(selector).forEach(el => {
            el.remove(); // 直接从 HTML 中删除该元素
          });
        });
        // 恢复可能被弹窗锁死的滚动条
        document.body.style.setProperty('overflow', 'auto', 'important');
        document.documentElement.style.setProperty('overflow', 'auto', 'important');
      };
      
      // 立刻执行一次
      purge();
      
      // 每隔 500ms 自动巡检并清理一次，持续清理 10 秒，防止动态延迟加载的弹窗
      const intervalId = setInterval(purge, 500);
      setTimeout(() => clearInterval(intervalId), 10000);
    });

    console.log('🗂️ 正在切换到 [Manage] 标签页...');
    const manageTab = page.getByText('Manage', { exact: true });
    
    // 🛡️ 终极防线 2：改用 attached 状态等待（只要元素在 DOM 树中即可，不管它有没有被遮挡）
    await manageTab.waitFor({ state: 'attached', timeout: 15000 });
    // 使用 dispatchEvent 触发原生的 JS 点击，彻底穿透遮盖！
    await manageTab.dispatchEvent('click');
    console.log('✅ 已成功穿透遮罩，点击了 [Manage] 标签！');

    // 给页面 3 秒时间加载 Manage 选项卡内容
    await page.waitForTimeout(3000);

    console.log('🔍 正在寻觅红色的 [Renew now] 按钮...');
    const renewBtn = page.locator('button:has-text("Renew now")').last();
    
    // 检查按钮是否存在
    const count = await renewBtn.count();
    
    if (count > 0) {
      // 同样使用穿透点击，确保点击成功
      await renewBtn.dispatchEvent('click');
      console.log('🎉 【成功】已强行穿透并点击续期按钮！');
      
      // 调用 TG 发送成功通知！
      await sendTG(`🎉 <b>Freemchost 自动续期成功</b>\n\n<b>状态:</b> GitHub 机器人已成功登录并点击续期按钮。\n<b>时间:</b> ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
      
      await page.waitForTimeout(5000);
    } else {
      console.log('⚠️ 未找到续期按钮，可能已被续期，或者当前不满足续期条件。');
      // 调用 TG 发送跳过通知
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
    
    // 调用 TG 发送失败报警！
    await sendTG(`🚨 <b>Freemchost 自动续期失败</b>\n\n<b>错误详情:</b> <code>${error.message.substring(0, 150)}...</code>\n<b>排查:</b> 脚本已异常退出，请前往 GitHub Actions 页面下载现场截图！`);
    
    process.exit(1);
  } finally {
    await browser.close();
    console.log('🏁 浏览器已关闭，任务结束。');
  }
})();
