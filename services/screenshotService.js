export async function captureScreenshot(url) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('Screenshot unavailable: Playwright is not installed on this server.');
  }

  console.log(`[Screenshot Service] Starting capture for ${url}`);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 }
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: 'load', timeout: 30000 });

    console.log(`[Screenshot Service] Page loaded, initiating scroll for lazy loading`);

    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 200;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight || totalHeight > 10000) {
            clearInterval(timer);
            resolve();
          }
        }, 50);
      });
    });

    await new Promise(r => setTimeout(r, 1500));
    await page.evaluate(() => window.scrollTo(0, 0));

    console.log(`[Screenshot Service] Scroll complete, capturing full page screenshot`);

    const buffer = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 85 });
    console.log(`[Screenshot Service] Screenshot captured successfully! Size: ${(buffer.length / 1024).toFixed(1)}KB`);

    await browser.close();
    return buffer.toString('base64');
  } catch (error) {
    await browser.close();
    console.error(`[Screenshot Service Error] Failed to capture ${url}`, error);
    throw error;
  }
}
