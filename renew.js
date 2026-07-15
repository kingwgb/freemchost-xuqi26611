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

// 🕵️ 安全清理弹窗函数（外科手术式精准点击）
async function dismissPopups(page) {
  console.log('🕵️ 开始检测并清理屏幕上的连环拦截弹窗...');
  // 循环 3 次，对付连环弹出的不同弹窗
  for (let i = 0; i < 3; i++) {
    try {
      // 定位包含 "Maybe later" 的按钮，不强制精确匹配，兼容性更好
      const maybeLaterBtn = page.getByText('Maybe later').first();
      // 每次最多等 2.5 秒，看看有没有弹窗冒头
      await maybeLaterBtn.waitFor({ state: 'visible', timeout: 2500 });
      
      console.log(`👋 发现第 ${i + 1} 个弹窗，正在点击 "Maybe later" 关闭...`);
      await maybeLaterBtn.click();
      
      // 等待弹窗动画彻底消失
      await maybeLaterBtn.waitFor({ state: 'hidden', timeout: 2000 });
      await page.waitForTimeout(500); 
    } catch (e) {
      // 如果超时没发现 "Maybe later"，说明当前没有弹窗，安全退出循环
      break;
    }
  }
  console.log('✅ 弹窗清理完毕，环境安全！');
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

    console.log('🗂️ 正在切换到 [Manage] 标签页...');
    const manageTab = page.getByText('Manage').first();
    
    // 1. 先等待 Manage 标签在 DOM 中挂载完成（即使被弹窗挡住也会成功）
    await manageTab.waitFor({ state: 'attached', timeout: 15000 });

    // 2. 此时页面已加载，立刻执行精准弹窗清理
    await dismissPopups(page);

    // 3. 清理干净后，安全点击 Manage 标签
    await manageTab.click({ timeout: 10000 });
    console.log('✅ 已成功点击 [Manage] 标签！');

    await page.waitForTimeout(2000);

    console.log('🔍 正在寻觅红色的 [Renew now] 按钮...');
    const renewBtn = page.locator('button:has-text("Renew now")').last();
    
    await renewBtn.waitFor({ state: 'visible', timeout: 10000 });
    
    if (await renewBtn.isVisible()) {
      await renewBtn.click();
      console.log('🎉 【成功】已精准点击续期按钮！');
      
      // 调用 TG 发送成功通知！
      await sendTG(`🎉 <b>Freemchost 自动续期成功</b>\n\n<b>状态:</b> GitHub 机器人已成功登录并点击续期按钮。\n<b>时间:</b> ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
      
      await page.waitForTimeout(5000);
    } else {
      console.log('⚠️ 未找到续期按钮，可能已被续期，或者页面结构有变。');
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
