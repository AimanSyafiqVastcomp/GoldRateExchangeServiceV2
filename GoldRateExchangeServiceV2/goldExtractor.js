const puppeteer = require('puppeteer');
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteerExtra.use(StealthPlugin());
const fs = require('fs');
const path = require('path');

// Define error types for better error reporting - moved to top of file
const ERROR_TYPES = {
    NAVIGATION: 'NAVIGATION_ERROR',
    TABLE_NOT_FOUND: 'TABLE_NOT_FOUND',
    DATA_STRUCTURE: 'DATA_STRUCTURE_ERROR',
    EXTRACTION: 'EXTRACTION_ERROR',
    NETWORK: 'NETWORK_ERROR',
    UNKNOWN: 'UNKNOWN_ERROR'
};

// Helper function to report structured errors
function reportError(type, message, details = {}) {
    const errorObj = {
        errorType: type,
        message: message,
        timestamp: new Date().toISOString(),
        details: details
    };

    // Output structured error as JSON - this will be captured by C#
    console.error(`ERROR_JSON: ${JSON.stringify(errorObj)}`);
}

const navigationTimeoutMs = process.argv[4] ? parseInt(process.argv[4]) : 30000;
const waitAfterNavigationMs = process.argv[5] ? parseInt(process.argv[5]) : 5000;

async function extractData(site, url) {
    // Special case for downloading HTML file
    if (site === 'mkspamp_download') {
        try {
            // In this case, url parameter is actually the file path to save the HTML
            const filePath = url;  // Rename for clarity
            const siteUrl = process.argv[3]; // The website URL is the third argument

            // Extract the directory path from the file path
            const dirPath = path.dirname(filePath);

            // Create directory if it doesn't exist
            if (!fs.existsSync(dirPath)) {
                try {
                    fs.mkdirSync(dirPath, { recursive: true });
                    console.error(`Created directory: ${dirPath}`);
                } catch (mkdirError) {
                    console.error(`Error creating directory: ${mkdirError.message}`);
                    throw mkdirError;
                }
            }

            // Use the stealth browser to download the page
            await downloadMKSPampPage(siteUrl, filePath);
            console.log(JSON.stringify({ success: true, filePath: filePath }));
            return;
        } catch (error) {
            reportError(ERROR_TYPES.NAVIGATION,
                `Failed to download MKSPamp page: ${error.message}`);
            console.log(JSON.stringify({ success: false, error: error.message }));
            return;
        }
    }

    // Special case for MKSPamp file extraction
    if (site === 'mkspamp_file') {
        try {
            await extractMKSPampFromFile(url);
        } catch (error) {
            console.error(`Fatal error extracting from file: ${error.message}`);
            process.exit(1);
        }
        return;
    }

    // Normal extraction for websites
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
        const page = await browser.newPage();

        // Set a realistic user agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

        // Set extra HTTP headers
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
        });

        // Set timeout using the parameter
        await page.setDefaultNavigationTimeout(navigationTimeoutMs);

        // Go to website and handle navigation errors
        try {
            console.error(`Navigating to ${url} with timeout ${navigationTimeoutMs}ms`);
            await page.goto(url, { waitUntil: 'networkidle2' });
        } catch (navError) {
            reportError(ERROR_TYPES.NAVIGATION,
                `Failed to load ${url}`,
                { originalError: navError.message });
            throw navError;
        }

        // Wait for content
        console.error(`Waiting ${waitAfterNavigationMs}ms for dynamic content`);
        await page.waitForTimeout(waitAfterNavigationMs);

        let result;

        if (site === 'tttbullion') {
            result = await extractTTTBullion(page);
        } else if (site === 'msgold') {
            result = await extractMSGold(page);
        } else if (site === 'mkspamp') {
            result = await extractMKSPamp(page);
        } else {
            reportError(ERROR_TYPES.UNKNOWN, `Unknown site: ${site}`);
            throw new Error(`Unknown site: ${site}`);
        }

        // Output as JSON to stdout
        console.log(JSON.stringify(result));

    } catch (error) {
        // Only report general error if not already reported
        if (!error.message.includes('ERROR_JSON')) {
            reportError(ERROR_TYPES.UNKNOWN, `General error: ${error.message}`);
        }
    } finally {
        await browser.close();
    }
}

// Download the MKSPamp page HTML and save it to the specified file path
async function downloadMKSPampPage(siteUrl, filePath) {
    console.error(`Downloading MKSPamp page from ${siteUrl} to ${filePath}`);

    // First make sure the directory exists
    try {
        const dirPath = path.dirname(filePath);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
            console.error(`Created directory: ${dirPath}`);
        }
    } catch (dirError) {
        console.error(`Error creating directory: ${dirError.message}`);
        throw dirError;
    }

    // Use puppeteer-extra with stealth plugin to avoid detection
    const browser = await puppeteerExtra.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });

    try {
        const page = await browser.newPage();

        // Set a realistic user agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

        // Set extra HTTP headers
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        });

        // Set timeout using the parameter
        await page.setDefaultNavigationTimeout(navigationTimeoutMs);

        console.error(`Navigating to ${siteUrl}`);
        await page.goto(siteUrl, { waitUntil: 'networkidle2' });

        // Wait additional time to ensure all content is loaded
        console.error(`Waiting ${waitAfterNavigationMs}ms for dynamic content`);
        await page.waitForTimeout(waitAfterNavigationMs);

        // Save a screenshot for debugging (optional)
        const screenshotPath = path.join(path.dirname(filePath), 'mkspamp_screenshot.png');
        await page.screenshot({ path: screenshotPath });
        console.error(`Saved screenshot to ${screenshotPath}`);

        // Get the full HTML content
        const htmlContent = await page.content();

        // Save the HTML content to the file
        fs.writeFileSync(filePath, htmlContent);
        console.error(`HTML content saved to ${filePath}`);

        return true;
    } catch (error) {
        console.error(`Error downloading MKSPamp page: ${error.message}`);
        throw error;
    } finally {
        await browser.close();
    }
}

// Extract data from TTTBullion
async function extractTTTBullion(page) {
    const results = [];

    try {
        // Find all tables on the page
        const tables = await page.$$('table');
        console.error(`Found ${tables.length} tables`);

        if (tables.length === 0) {
            reportError(ERROR_TYPES.TABLE_NOT_FOUND,
                'No tables found on the page',
                { url: await page.url() });
            throw new Error('No tables found on TTTBullion page');
        }

        let foundGoldTable = false;

        for (const table of tables) {
            // Check if this table has gold rates
            const tableText = await page.evaluate(el => el.textContent, table);

            if (tableText.includes('Gold') && !tableText.includes('Silver')) {
                console.error('Found Gold table');
                foundGoldTable = true;

                // Get all rows
                const rows = await table.$$('tr');

                if (rows.length <= 1) {
                    reportError(ERROR_TYPES.DATA_STRUCTURE,
                        'Gold table found but contains insufficient rows',
                        { rowCount: rows.length });
                    continue;
                }

                // Skip header row
                for (let i = 1; i < rows.length; i++) {
                    try {
                        const cells = await rows[i].$$('td');

                        if (cells.length < 3) {
                            console.error(`Row ${i} has insufficient cells: ${cells.length}`);
                            continue;
                        }

                        const detail = await page.evaluate(el => el.textContent.trim(), cells[0]);
                        const weBuyText = await page.evaluate(el => el.textContent.trim(), cells[1]);
                        const weSellText = await page.evaluate(el => el.textContent.trim(), cells[2]);

                        console.error(`Row data: ${detail}, ${weBuyText}, ${weSellText}`);

                        // Extract numeric values using regex
                        const weBuyMatch = weBuyText.match(/[\d,\.]+/);
                        const weSellMatch = weSellText.match(/[\d,\.]+/);

                        if (weBuyMatch && weSellMatch) {
                            const weBuy = parseFloat(weBuyMatch[0].replace(/,/g, ''));
                            const weSell = parseFloat(weSellMatch[0].replace(/,/g, ''));

                            results.push({
                                DetailName: detail,
                                WeBuy: weBuy,
                                WeSell: weSell
                            });

                            console.error(`Extracted: ${detail}, ${weBuy}, ${weSell}`);
                        } else {
                            console.error(`Failed to extract numeric values from: ${weBuyText}, ${weSellText}`);
                        }
                    } catch (rowError) {
                        console.error(`Error processing row ${i}: ${rowError.message}`);
                    }
                }

                // If we found data, stop processing tables
                if (results.length > 0) {
                    break;
                }
            }
        }

        if (!foundGoldTable) {
            reportError(ERROR_TYPES.TABLE_NOT_FOUND,
                'Gold table not found on the page',
                { tableCount: tables.length });
            throw new Error('Gold table not found on TTTBullion page');
        }

        if (results.length === 0) {
            reportError(ERROR_TYPES.EXTRACTION,
                'Failed to extract any gold rates',
                { foundGoldTable: foundGoldTable });
            throw new Error('Failed to extract any gold rates from TTTBullion');
        }

        return results;
    } catch (error) {
        // If the error hasn't been reported in a structured way, report it
        if (!error.message.includes('ERROR_JSON')) {
            reportError(ERROR_TYPES.UNKNOWN,
                `Error in TTTBullion extraction: ${error.message}`);
        }
        throw error;
    }
}


// Extract data from MSGold
async function extractMSGold(page) {
    const ourRates = [];
    const customerSell = [];

    try {
        // Find all tables on the page
        const tables = await page.$$('table');
        console.error(`Found ${tables.length} tables`);

        if (tables.length === 0) {
            reportError(ERROR_TYPES.TABLE_NOT_FOUND,
                'No tables found on the MSGold page',
                { url: await page.url() });
            throw new Error('No tables found on MSGold page');
        }

        let foundOurRatesTable = false;
        let foundCustomerSellTable = false;

        for (const table of tables) {
            // Check table content
            const tableText = await page.evaluate(el => el.textContent, table);

            // Process OurRates table
            if (tableText.includes('WE BUY') && tableText.includes('WE SELL')) {
                console.error('Found OurRates table');
                foundOurRatesTable = true;

                // Get all rows
                const rows = await table.$$('tr');

                if (rows.length <= 1) {
                    reportError(ERROR_TYPES.DATA_STRUCTURE,
                        'OurRates table found but contains insufficient rows',
                        { rowCount: rows.length });
                    continue;
                }

                for (const row of rows) {
                    try {
                        const cells = await row.$$('td');

                        if (cells.length < 3) {
                            continue;
                        }

                        const detail = await page.evaluate(el => el.textContent.trim(), cells[0]);

                        // Skip header rows
                        if (detail.includes('DETAILS') || detail.includes('WE BUY') || !detail) {
                            continue;
                        }

                        const weBuyText = await page.evaluate(el => el.textContent.trim(), cells[1]);
                        const weSellText = await page.evaluate(el => el.textContent.trim(), cells[2]);

                        console.error(`OurRates data: ${detail}, ${weBuyText}, ${weSellText}`);

                        // Extract numeric values using regex
                        const weBuyMatch = weBuyText.match(/[\d,\.]+/);
                        const weSellMatch = weSellText.match(/[\d,\.]+/);

                        if (weBuyMatch && weSellMatch) {
                            const weBuy = parseFloat(weBuyMatch[0].replace(/,/g, ''));
                            const weSell = parseFloat(weSellMatch[0].replace(/,/g, ''));

                            // Normalize detail name
                            let normalizedDetail = detail;
                            if (detail.includes('USD') && detail.includes('oz')) {
                                normalizedDetail = '999.9 Gold USD / Oz';
                            } else if (detail.includes('MYR') && detail.includes('kg')) {
                                normalizedDetail = '999.9 Gold MYR / KG';
                            } else if (detail.includes('MYR') && detail.includes('tael')) {
                                normalizedDetail = '999.9 Gold MYR / Tael';
                            } else if (detail.includes('MYR') && detail.includes('g')) {
                                normalizedDetail = '999.9 Gold MYR / Gram';
                            } else if (detail.includes('USD') && detail.includes('MYR')) {
                                normalizedDetail = 'USD / MYR';
                            }

                            ourRates.push({
                                DetailName: normalizedDetail,
                                WeBuy: weBuy,
                                WeSell: weSell
                            });

                            console.error(`Extracted OurRates: ${normalizedDetail}, ${weBuy}, ${weSell}`);
                        } else {
                            console.error(`Failed to extract numeric values from: ${weBuyText}, ${weSellText}`);
                        }
                    } catch (rowError) {
                        console.error(`Error processing OurRates row: ${rowError.message}`);
                    }
                }
            }
            // Process CustomerSell table
            else if (tableText.includes('WE BUY') && !tableText.includes('WE SELL')) {
                console.error('Found CustomerSell table');
                foundCustomerSellTable = true;

                // Get all rows
                const rows = await table.$$('tr');

                if (rows.length <= 1) {
                    reportError(ERROR_TYPES.DATA_STRUCTURE,
                        'CustomerSell table found but contains insufficient rows',
                        { rowCount: rows.length });
                    continue;
                }

                for (const row of rows) {
                    try {
                        const cells = await row.$$('td');

                        if (cells.length < 2) {
                            continue;
                        }

                        const detail = await page.evaluate(el => el.textContent.trim(), cells[0]);

                        // Skip header rows
                        if (detail.includes('DETAILS') || detail.includes('WE BUY') || !detail) {
                            continue;
                        }

                        const weBuyText = await page.evaluate(el => el.textContent.trim(), cells[1]);

                        console.error(`CustomerSell data: ${detail}, ${weBuyText}`);

                        // Extract numeric values using regex
                        const weBuyMatch = weBuyText.match(/[\d,\.]+/);

                        if (weBuyMatch) {
                            const weBuy = parseFloat(weBuyMatch[0].replace(/,/g, ''));

                            // Extract purity
                            let purity = '';
                            if (detail.includes('999.9')) {
                                purity = '999.9';
                            } else if (detail.includes('999')) {
                                purity = '999';
                            } else if (detail.includes('916')) {
                                purity = '916';
                            } else if (detail.includes('835')) {
                                purity = '835';
                            } else if (detail.includes('750')) {
                                purity = '750';
                            } else if (detail.includes('375')) {
                                purity = '375';
                            }

                            if (purity) {
                                const normalizedDetail = `${purity} MYR / Gram`;

                                customerSell.push({
                                    DetailName: normalizedDetail,
                                    WeBuy: weBuy
                                });

                                console.error(`Extracted CustomerSell: ${normalizedDetail}, ${weBuy}`);
                            } else {
                                console.error(`Could not determine purity from: ${detail}`);
                            }
                        } else {
                            console.error(`Failed to extract numeric value from: ${weBuyText}`);
                        }
                    } catch (rowError) {
                        console.error(`Error processing CustomerSell row: ${rowError.message}`);
                    }
                }
            }
        }

        // Check if we found the expected tables
        if (!foundOurRatesTable && !foundCustomerSellTable) {
            reportError(ERROR_TYPES.TABLE_NOT_FOUND,
                'Neither OurRates nor CustomerSell tables found',
                { tableCount: tables.length });
            throw new Error('Required tables not found on MSGold page');
        }

        // Check if we extracted any data
        if (ourRates.length === 0 && customerSell.length === 0) {
            reportError(ERROR_TYPES.EXTRACTION,
                'Failed to extract any gold rates from either table',
                {
                    foundOurRatesTable: foundOurRatesTable,
                    foundCustomerSellTable: foundCustomerSellTable
                });
            throw new Error('Failed to extract any gold rates from MSGold');
        }

        return { OurRates: ourRates, CustomerSell: customerSell };
    } catch (error) {
        // If the error hasn't been reported in a structured way, report it
        if (!error.message.includes('ERROR_JSON')) {
            reportError(ERROR_TYPES.UNKNOWN,
                `Error in MSGold extraction: ${error.message}`);
        }
        throw error;
    }
}

async function extractMKSPamp(page) {
    const results = [];

    try {
        // Find all tables on the page
        const tables = await page.$$('table');
        console.error(`Found ${tables.length} tables`);

        if (tables.length === 0) {
            reportError(ERROR_TYPES.TABLE_NOT_FOUND,
                'No tables found on the MKSPamp page',
                { url: await page.url() });
            throw new Error('No tables found on MKSPamp page');
        }

        let foundGoldTable = false;

        for (const table of tables) {
            // Check table content 
            const tableText = await page.evaluate(el => el.textContent, table);

            // Look for table with buy/sell columns
            if (tableText.includes('WE BUY') && tableText.includes('WE SELL')) {
                console.error('Found MKSPamp gold rates table');
                foundGoldTable = true;

                // Get all rows
                const rows = await table.$$('tr');

                if (rows.length <= 1) {
                    reportError(ERROR_TYPES.DATA_STRUCTURE,
                        'Gold table found but contains insufficient rows',
                        { rowCount: rows.length });
                    continue;
                }

                // Skip header row
                for (let i = 1; i < rows.length; i++) {
                    try {
                        const cells = await rows[i].$$('td');

                        if (cells.length < 3) {
                            console.error(`Row ${i} has insufficient cells: ${cells.length}`);
                            continue;
                        }

                        // Get the detail name from the first cell
                        const detail = await page.evaluate(el => el.textContent.trim(), cells[0]);
                        const weBuyText = await page.evaluate(el => el.textContent.trim(), cells[1]);
                        const weSellText = await page.evaluate(el => el.textContent.trim(), cells[2]);

                        console.error(`Row data: ${detail}, ${weBuyText}, ${weSellText}`);

                        // Extract numeric values using regex
                        const weBuyMatch = weBuyText.match(/[\d\s,.]+/);

                        // Special handling for sell value (could be "-")
                        let weSell = null;
                        const weSellMatch = weSellText.match(/[\d\s,.]+/);

                        if (weBuyMatch) {
                            // Clean up the values (remove spaces, convert to numbers)
                            const weBuy = parseFloat(weBuyMatch[0].replace(/\s+/g, '').replace(/,/g, ''));

                            if (weSellMatch && weSellText !== "-") {
                                weSell = parseFloat(weSellMatch[0].replace(/\s+/g, '').replace(/,/g, ''));
                            }

                            results.push({
                                DetailName: detail,
                                WeBuy: weBuy,
                                WeSell: weSell
                            });

                            console.error(`Extracted: ${detail}, ${weBuy}, ${weSell || 'N/A'}`);
                        } else {
                            console.error(`Failed to extract numeric values from: ${weBuyText}, ${weSellText}`);
                        }
                    } catch (rowError) {
                        console.error(`Error processing row ${i}: ${rowError.message}`);
                    }
                }

                // If we found data, stop processing tables
                if (results.length > 0) {
                    break;
                }
            }
        }

        if (!foundGoldTable) {
            reportError(ERROR_TYPES.TABLE_NOT_FOUND,
                'Gold rates table not found on the page',
                { tableCount: tables.length });
            throw new Error('Gold rates table not found on MKSPamp page');
        }

        if (results.length === 0) {
            reportError(ERROR_TYPES.EXTRACTION,
                'Failed to extract any gold rates',
                { foundGoldTable: foundGoldTable });
            throw new Error('Failed to extract any gold rates from MKSPamp');
        }

        return results;
    } catch (error) {
        // If the error hasn't been reported in a structured way, report it
        if (!error.message.includes('ERROR_JSON')) {
            reportError(ERROR_TYPES.UNKNOWN,
                `Error in MKSPamp extraction: ${error.message}`);
        }
        throw error;
    }
}

async function extractMKSPampFromFile(filePath) {
    const results = [];
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        // Read the local HTML file
        const fs = require('fs');
        let htmlContent;

        try {
            htmlContent = fs.readFileSync(filePath, 'utf8');
            console.error(`Successfully read HTML file from ${filePath}`);
        } catch (fileError) {
            reportError(ERROR_TYPES.NAVIGATION,
                `Failed to read local HTML file: ${filePath}`,
                { originalError: fileError.message });
            throw fileError;
        }

        // Create a new page to load the HTML content
        const page = await browser.newPage();
        await page.setContent(htmlContent);
        console.error("Loaded HTML content into virtual page");

        // Now extract the data using DOM manipulation with Puppeteer
        const tableData = await page.evaluate(() => {
            const results = [];

            // Find the gold rates table
            const tables = document.querySelectorAll('table');

            if (tables.length === 0) {
                return { error: 'No tables found in HTML file' };
            }

            // Look for the table with the headers "WE BUY" and "WE SELL"
            let goldTable = null;

            for (const table of tables) {
                const headerText = table.textContent;
                if (headerText.includes('WE BUY') && headerText.includes('WE SELL')) {
                    goldTable = table;
                    break;
                }
            }

            if (!goldTable) {
                return { error: 'Gold rates table not found in HTML file' };
            }

            // Extract data from rows
            const rows = goldTable.querySelectorAll('tbody tr');

            for (const row of rows) {
                const cells = row.querySelectorAll('td');

                if (cells.length >= 3) {
                    // Get the detail name from the first cell
                    const detailCell = cells[0].querySelector('[id*="itemDescriptionLang"], [id*="displayBid"]');
                    let detailName = detailCell ? detailCell.textContent.trim() : cells[0].textContent.trim();

                    // Handle special cases with nested elements
                    if (detailName.includes('GOLD OZ')) {
                        detailName = 'GOLD OZ';
                    } else if (detailName.includes('SILVER OZ')) {
                        detailName = 'SILVER OZ';
                    }

                    // Get buy and sell values
                    const buyCell = cells[1].querySelector('[id*="displayBid"]');
                    const sellCell = cells[2].querySelector('[id*="displayOffer"]');

                    let buyText = buyCell ? buyCell.textContent.trim() : cells[1].textContent.trim();
                    let sellText = sellCell ? sellCell.textContent.trim() : cells[2].textContent.trim();

                    // Extract numeric values
                    const buyMatch = buyText.match(/[\d\s,.]+/);
                    const sellMatch = sellText.match(/[\d\s,.]+/);

                    if (buyMatch) {
                        // Clean up the values (remove spaces, convert to numbers)
                        const weBuy = parseFloat(buyMatch[0].replace(/\s+/g, '').replace(/,/g, ''));

                        // Handle the case where sell value is "-" (missing)
                        let weSell = null;
                        if (sellMatch && sellText !== "-") {
                            weSell = parseFloat(sellMatch[0].replace(/\s+/g, '').replace(/,/g, ''));
                        }

                        results.push({
                            DetailName: detailName,
                            WeBuy: weBuy,
                            WeSell: weSell
                        });
                    }
                }
            }

            return results;
        });

        if (tableData.error) {
            reportError(ERROR_TYPES.EXTRACTION,
                tableData.error,
                { filePath: filePath });
            throw new Error(tableData.error);
        }

        // Process the extracted data
        for (const item of tableData) {
            results.push(item);
            console.error(`Extracted from file: ${item.DetailName}, Buy: ${item.WeBuy}, Sell: ${item.WeSell || 'N/A'}`);
        }

        if (results.length === 0) {
            reportError(ERROR_TYPES.EXTRACTION,
                'No gold rates found in HTML file',
                { filePath: filePath });
            throw new Error('Failed to extract any gold rates from MKSPamp HTML file');
        }

        // Output the result as JSON to stdout
        console.log(JSON.stringify(results));

        return results;
    } catch (error) {
        // If the error hasn't been reported in a structured way, report it
        if (!error.message.includes('ERROR_JSON')) {
            reportError(ERROR_TYPES.UNKNOWN,
                `Error in MKSPamp file extraction: ${error.message}`);
        }
        throw error;
    } finally {
        await browser.close();
    }
}

// Check command line argument
if (process.argv.length < 4) {
    console.error('Usage: node script.js [tttbullion|msgold|mkspamp|mkspamp_file|mkspamp_download] [url/filepath]');
    process.exit(1);
}

const site = process.argv[2].toLowerCase();
const url = process.argv[3];

// Run the extraction
extractData(site, url).catch(error => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
});