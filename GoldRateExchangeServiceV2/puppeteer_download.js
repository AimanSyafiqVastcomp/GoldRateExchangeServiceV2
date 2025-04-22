const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Get command line arguments
const url = process.argv[2];
const outputFilePath = process.argv[3];

// Ensure directory exists
const dirPath = path.dirname(outputFilePath);
if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.error(`Created directory: ${dirPath}`);
}

async function downloadPage() {
    console.error(`Downloading page from ${url} with puppeteer`);

    // Launch browser
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });

    try {
        // Open new page
        const page = await browser.newPage();

        // Set viewport
        await page.setViewport({ width: 1366, height: 768 });

        // Set user agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

        // Set extra HTTP headers
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        });

        // Navigate to page
        console.error(`Navigating to ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // Wait extra time for any dynamic content
        console.error('Waiting for content to load...');
        await page.waitForTimeout(5000);

        // Check if we can find the tables we're looking for
        const tablesCheck = await page.evaluate(() => {
            const tables = document.querySelectorAll('table');
            let foundGoldTable = false;

            for (const table of tables) {
                if (table.textContent.includes('WE BUY') && table.textContent.includes('WE SELL')) {
                    foundGoldTable = true;
                    break;
                }
            }

            return {
                tableCount: tables.length,
                foundGoldTable: foundGoldTable
            };
        });

        console.error(`Found ${tablesCheck.tableCount} tables on the page`);
        console.error(`Gold rates table found: ${tablesCheck.foundGoldTable ? 'Yes' : 'No'}`);

        // Get the page content
        const html = await page.content();

        // Save HTML to file
        fs.writeFileSync(outputFilePath, html);
        console.error(`HTML content saved to ${outputFilePath}`);

        // Return success
        console.log(JSON.stringify({
            success: true,
            filePath: outputFilePath,
            tableCount: tablesCheck.tableCount,
            foundGoldTable: tablesCheck.foundGoldTable
        }));

    } catch (error) {
        console.error(`Error downloading page: ${error.message}`);
        console.log(JSON.stringify({ success: false, error: error.message }));
    } finally {
        await browser.close();
    }
}

// Run the download function
downloadPage().catch(error => {
    console.error(`Fatal error: ${error.message}`);
    console.log(JSON.stringify({ success: false, error: error.message }));
    process.exit(1);
});