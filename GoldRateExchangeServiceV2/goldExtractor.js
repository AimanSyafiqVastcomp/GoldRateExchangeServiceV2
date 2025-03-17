const puppeteer = require('puppeteer');

const navigationTimeoutMs = process.argv[4] ? parseInt(process.argv[4]) : 30000;
const waitAfterNavigationMs = process.argv[5] ? parseInt(process.argv[5]) : 5000;

async function extractData(site, url) {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();

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

// Check command line arguments
if (process.argv.length < 4) {
    console.error('Usage: node script.js [tttbullion|msgold] [url]');
    process.exit(1);
}

const site = process.argv[2].toLowerCase();
const url = process.argv[3];

// Run the extraction
extractData(site, url).catch(error => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
});

//Error handling
// Define error types for better error reporting
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