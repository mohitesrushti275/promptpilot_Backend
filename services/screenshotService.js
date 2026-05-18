import { chromium } from 'playwright';

export async function captureScreenshot(url) {
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

export async function extractWebsiteMetadataAndScreenshot(url) {
  console.log(`[Screenshot Service] Starting combined extraction & capture for: ${url}`);
  const browser = await chromium.launch({ headless: true });
  
  let screenshotBase64 = null;
  let extractedText = '';
  let contentSuccess = false;
  let screenshotSuccess = false;

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 }
    });
    const page = await context.newPage();
    
    // Set a reasonable timeout so we don't hang if a site is slow
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    
    // 1. Content Extraction
    try {
      console.log(`[Screenshot Service] Extracting website content elements from DOM...`);
      const pageData = await page.evaluate(() => {
        const title = document.title || '';
        
        const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content') || 
                         document.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';

        const headings = {};
        ['h1', 'h2', 'h3'].forEach(tag => {
          headings[tag] = Array.from(document.querySelectorAll(tag))
            .slice(0, 5)
            .map(el => el.innerText.trim())
            .filter(Boolean);
        });

        const sections = Array.from(document.querySelectorAll('section, header, footer, nav, aside'))
          .slice(0, 10)
          .map(el => {
            const tag = el.tagName.toLowerCase();
            const id = el.id ? `#${el.id}` : '';
            const classes = el.className ? `.${Array.from(el.classList).join('.')}` : '';
            return `${tag}${id}${classes}`.trim();
          })
          .filter(Boolean);

        const buttonsAndLinks = Array.from(document.querySelectorAll('button, a'))
          .slice(0, 15)
          .map(el => el.innerText.trim())
          .filter(text => text.length > 2 && text.length < 40);

        const grids = document.querySelectorAll('[class*="grid"], [style*="grid"]').length;
        const flexes = document.querySelectorAll('[class*="flex"], [style*="flex"]').length;
        const hasSidebar = !!document.querySelector('aside, .sidebar, #sidebar');
        const layoutClues = {
          gridsCount: grids,
          flexesCount: flexes,
          hasSidebar
        };

        let visibleText = document.body.innerText || '';
        visibleText = visibleText
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 3000);

        return {
          title,
          metaDesc,
          headings,
          sections,
          buttonsAndLinks,
          layoutClues,
          visibleText
        };
      });

      extractedText = `Title: ${pageData.title}
Meta Description: ${pageData.metaDesc}
Headings:
- H1: ${pageData.headings.h1?.join(', ') || 'None'}
- H2: ${pageData.headings.h2?.join(', ') || 'None'}
- H3: ${pageData.headings.h3?.join(', ') || 'None'}
Semantic Sections/Containers: ${pageData.sections?.join(', ') || 'None'}
Key Interactive Links & Buttons: ${pageData.buttonsAndLinks?.join(' | ') || 'None'}
Layout Architecture Clues: Grids (${pageData.layoutClues.gridsCount}), Flex containers (${pageData.layoutClues.flexesCount}), Has Sidebar (${pageData.layoutClues.hasSidebar ? 'Yes' : 'No'})
Main Text Excerpt:
${pageData.visibleText}`;

      contentSuccess = true;
      console.log(`[Screenshot Service] Successfully extracted content from ${url}`);
    } catch (extractErr) {
      console.error(`[Screenshot Service] Content extraction failed for ${url}:`, extractErr.message);
    }

    // 2. Screenshot Capture
    try {
      console.log(`[Screenshot Service] Initiating scroll for lazy loading`);
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

      console.log(`[Screenshot Service] Capturing full page screenshot`);
      const buffer = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 85 });
      screenshotBase64 = buffer.toString('base64');
      screenshotSuccess = true;
      console.log(`[Screenshot Service] Screenshot captured successfully! Size: ${(buffer.length / 1024).toFixed(1)}KB`);
    } catch (screenshotErr) {
      console.error(`[Screenshot Service] Screenshot capture failed for ${url}:`, screenshotErr.message);
    }

    await browser.close();
    return {
      screenshotBase64,
      extractedText,
      contentSuccess,
      screenshotSuccess
    };
  } catch (error) {
    await browser.close();
    console.error(`[Screenshot Service Error] Failed to process ${url}`, error);
    return {
      screenshotBase64: null,
      extractedText: '',
      contentSuccess: false,
      screenshotSuccess: false
    };
  }
}

