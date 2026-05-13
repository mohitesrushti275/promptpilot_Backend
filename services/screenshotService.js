export async function captureScreenshot(url) {
  const { chromium } = await import('playwright');
  console.log(`[Screenshot Service] Starting capture for ${url}`);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 }
    });
    const page = await context.newPage();

    // Set a reasonable timeout so we don't hang if a site is slow
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });

    console.log(`[Screenshot Service] Page loaded, initiating scroll for lazy loading`);

    // Auto-scroll to trigger lazy loading images
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 200;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          // Stop if we reach bottom or scroll too much (e.g., infinite scroll)
          if (totalHeight >= scrollHeight || totalHeight > 10000) {
            clearInterval(timer);
            resolve();
          }
        }, 50);
      });
    });

    // Give lazy loaded elements a moment to populate
    await new Promise(r => setTimeout(r, 1500));

    // Scroll back to top
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
