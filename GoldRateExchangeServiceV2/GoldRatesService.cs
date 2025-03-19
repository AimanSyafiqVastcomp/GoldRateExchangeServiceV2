using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Data;
using System.Data.SqlClient;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Timers;
using System.Configuration;
using Newtonsoft.Json;
using System.Text;
using System.Linq;

namespace GoldRatesExtractor
{

    public partial class GoldRatesService : ServiceBase
    {
        private string connectionString;
        private string currentCompanyName;
        private string logFilePath;
        private string errorLogFilePath;
        private Timer extractionTimer;
        private int websiteOption;
        private int extractionIntervalSeconds;
        private string nodeJsPath;
        private string scriptPath;
        private int initialDelayMilliseconds;
        private int navigationTimeoutMs = 30000;
        private int waitAfterNavigationMs = 5000; 
        private int scriptTimeoutMs = 60000;

        public GoldRatesService()
        {
            InitializeComponent();

            // Create log directory if it doesn't exist
            string logDirectory = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Logs");
            if (!Directory.Exists(logDirectory))
            {
                Directory.CreateDirectory(logDirectory);
            }

            // Set log file paths
            logFilePath = Path.Combine(logDirectory, $"GoldRates_Log_{DateTime.Now:yyyyMMdd}.log");
            errorLogFilePath = Path.Combine(logDirectory, $"GoldRates_Error_{DateTime.Now:yyyyMMdd}.log");

            // Add a divider in the log file to separate runs
            string divider = new string('-', 80);
            File.AppendAllText(logFilePath,
                Environment.NewLine +
                divider +
                Environment.NewLine +
                $"New service started at {DateTime.Now:yyyy-MM-dd HH:mm:ss}" +
                Environment.NewLine +
                divider +
                Environment.NewLine);

            // Add a divider in the error log file too
            File.AppendAllText(errorLogFilePath,
                Environment.NewLine +
                divider +
                Environment.NewLine +
                $"New service started at {DateTime.Now:yyyy-MM-dd HH:mm:ss}" +
                Environment.NewLine +
                divider +
                Environment.NewLine);

            // Set up Node.js paths
            scriptPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "goldExtractor.js");
        }



        protected override void OnStart(string[] args)
        {
            LogInfo("Service is starting...");

            try
            {
                LoadConfiguration();

                // for script execution
                FindNodeJs();

                // Make sure the script exists
                if (!File.Exists(scriptPath))
                {
                    LogError($"Script file not found at: {scriptPath}");
                    LogError("Please ensure goldExtractor.js is in the application directory.");
                    throw new FileNotFoundException($"Required script file not found: {scriptPath}");
                }

                // Check and install dependencies
                if (!CheckAndInstallDependencies())
                {
                    LogError("Failed to install required dependencies. Service may not function correctly.");
                }

                // Setup timer for periodic extraction
                SetupTimer();

                // Apply the initial delay before first extraction
                LogInfo($"Applying initial delay of {initialDelayMilliseconds}ms before first extraction...");

                // Using Task.Delay for asynchronous delay and then running the extraction
                Task.Run(async () =>
                {
                    await Task.Delay(initialDelayMilliseconds);
                    LogInfo($"Initial delay completed. Starting first extraction...");
                    await ExtractGoldRatesAsync();
                });
            }
            catch (Exception ex)
            {
                LogError($"Error in OnStart: {ex.Message}");
                LogError($"Stack trace: {ex.StackTrace}");
            }
        }

        private void FindNodeJs()
        {
            // First try to get Node.js path from app config
            nodeJsPath = ConfigurationManager.AppSettings["NodeJsPath"];
            if (!string.IsNullOrEmpty(nodeJsPath) && File.Exists(nodeJsPath))
            {
                LogInfo($"Using Node.js from config: {nodeJsPath}");
                return;
            }

            // Look in common locations
            string[] possiblePaths = new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"),
                @"C:\Program Files\nodejs\node.exe",
                @"C:\Program Files (x86)\nodejs\node.exe"
            };

            foreach (string path in possiblePaths)
            {
                if (File.Exists(path))
                {
                    LogInfo($"Found Node.js at: {path}");
                    nodeJsPath = path;
                    return;
                }
            }

            // Try to find Node.js in the PATH
            try
            {
                var process = new Process
                {
                    StartInfo = new ProcessStartInfo
                    {
                        FileName = "where",
                        Arguments = "node",
                        UseShellExecute = false,
                        RedirectStandardOutput = true,
                        CreateNoWindow = true
                    }
                };

                process.Start();
                string output = process.StandardOutput.ReadToEnd();
                process.WaitForExit();

                if (!string.IsNullOrEmpty(output))
                {
                    string path = output.Trim().Split('\n')[0];
                    if (File.Exists(path))
                    {
                        LogInfo($"Found Node.js in PATH at: {path}");
                        nodeJsPath = path;
                        return;
                    }
                }
            }
            catch (Exception ex)
            {
                LogError($"Error checking for Node.js in PATH: {ex.Message}");
            }

            LogError("Node.js not found. Please install Node.js or specify its path in app.config.");
            nodeJsPath = null;
        }

        private void SetupTimer()
        {
            extractionTimer = new Timer();
            extractionTimer.Interval = extractionIntervalSeconds * 1000; // Convert seconds to milliseconds
            extractionTimer.Elapsed += async (sender, e) =>
            {
                extractionTimer.Enabled = false; // Disable timer while running extraction
                try
                {
                    await ExtractGoldRatesAsync();
                }
                catch (Exception ex)
                {
                    LogError($"Error during extraction: {ex.Message}");
                }
                finally
                {
                    if (extractionTimer != null)
                        extractionTimer.Enabled = true; // Re-enable timer after extraction completes
                }
            };

            extractionTimer.Start();
            LogInfo($"Timer started. Will extract gold rates every {extractionIntervalSeconds} minutes.");
        }

        protected override void OnStop()
        {
            LogInfo("Service is stopping...");

            try
            {
                // Stop the timer
                if (extractionTimer != null)
                {
                    extractionTimer.Stop();
                    extractionTimer.Dispose();
                    extractionTimer = null;
                }

                LogInfo("Service stopped successfully.");
            }
            catch (Exception ex)
            {
                LogError($"Error in OnStop: {ex.Message}");
            }
        }

        protected override void OnPause()
        {
            LogInfo("Service is pausing...");
            if (extractionTimer != null)
            {
                extractionTimer.Stop();
                LogInfo("Timer paused.");
            }
        }

        protected override void OnContinue()
        {
            LogInfo("Service is resuming...");
            if (extractionTimer != null)
            {
                extractionTimer.Start();
                LogInfo("Timer resumed.");
            }
        }

        private void LoadConfiguration()
        {
            try
            {
                // Load connection string from app.config
                connectionString = ConfigurationManager.AppSettings["ConnectionString"];

                // Get the website option from app.config
                string websiteOptionStr = ConfigurationManager.AppSettings["WebsiteOption"];
                if (!int.TryParse(websiteOptionStr, out websiteOption))
                {
                    // Default to option 1 if parsing fails
                    websiteOption = 1;
                    LogInfo("WebsiteOption not specified or invalid in app.config. Defaulting to 1 (TTTBullion)");
                }
                else
                {
                    LogInfo($"Using WebsiteOption {websiteOption} from app.config");
                }

                // Get the extraction interval from app.config (in minutes)
                string intervalStr = ConfigurationManager.AppSettings["ExtractionIntervalSeconds"];
                if (!int.TryParse(intervalStr, out extractionIntervalSeconds) || extractionIntervalSeconds <= 0)
                {
                    // Default to 60 minutes if parsing fails or value is invalid
                    extractionIntervalSeconds = 60;
                    LogInfo("ExtractionIntervalSeconds not specified or invalid in app.config. Defaulting to 60 minutes");
                }
                else
                {
                    LogInfo($"Using extraction interval of {extractionIntervalSeconds} minutes from app.config");
                }

                // Get the initial delay setting (in milliseconds)
                string delayStr = ConfigurationManager.AppSettings["InitialDelayMilliseconds"];
                if (!int.TryParse(delayStr, out initialDelayMilliseconds) || initialDelayMilliseconds < 0)
                {
                    // Default to 500ms if parsing fails or value is invalid
                    initialDelayMilliseconds = 500;
                    LogInfo("InitialDelayMilliseconds not specified or invalid in app.config. Defaulting to 500ms");
                }
                else
                {
                    LogInfo($"Using initial delay of {initialDelayMilliseconds}ms from app.config");
                }

                // Load web timeout settings
                string navigationTimeoutStr = ConfigurationManager.AppSettings["NavigationTimeoutMs"];
                if (!int.TryParse(navigationTimeoutStr, out navigationTimeoutMs) || navigationTimeoutMs <= 0)
                {
                    navigationTimeoutMs = 30000; // Default to 30 seconds if not specified or invalid
                    LogInfo("NavigationTimeoutMs not specified or invalid in app.config. Defaulting to 30000ms");
                }
                else
                {
                    LogInfo($"Using navigation timeout of {navigationTimeoutMs}ms from app.config");
                }

                string waitAfterNavigationStr = ConfigurationManager.AppSettings["WaitAfterNavigationMs"];
                if (!int.TryParse(waitAfterNavigationStr, out waitAfterNavigationMs) || waitAfterNavigationMs <= 0)
                {
                    waitAfterNavigationMs = 5000; // Default to 5 seconds if not specified or invalid
                    LogInfo("WaitAfterNavigationMs not specified or invalid in app.config. Defaulting to 5000ms");
                }
                else
                {
                    LogInfo($"Using post-navigation wait of {waitAfterNavigationMs}ms from app.config");
                }

                string scriptTimeoutStr = ConfigurationManager.AppSettings["ScriptTimeoutMs"];
                if (!int.TryParse(scriptTimeoutStr, out scriptTimeoutMs) || scriptTimeoutMs <= 0)
                {
                    scriptTimeoutMs = 60000; // Default to 60 seconds if not specified or invalid
                    LogInfo("ScriptTimeoutMs not specified or invalid in app.config. Defaulting to 60000ms");
                }
                else
                {
                    LogInfo($"Using script timeout of {scriptTimeoutMs}ms from app.config");
                }

                LogInfo("Configuration loaded successfully");
            }
            catch (Exception ex)
            {
                LogError($"Error loading configuration: {ex.Message}");
                throw; // Re-throw to handle at higher level
            }
        }

        private bool CheckAndInstallDependencies()
        {
            try
            {
                LogInfo("Checking Node.js dependencies...");

                string scriptDirectory = Path.GetDirectoryName(scriptPath);
                string nodeModulesPath = Path.Combine(scriptDirectory, "node_modules");
                string puppeteerPath = Path.Combine(nodeModulesPath, "puppeteer");

                // Check if node_modules and puppeteer exist
                if (!Directory.Exists(nodeModulesPath) || !Directory.Exists(puppeteerPath))
                {
                    LogInfo("Node.js dependencies not found. Installing now...");

                    // Create package.json if it doesn't exist
                    string packageJsonPath = Path.Combine(scriptDirectory, "package.json");
                    if (!File.Exists(packageJsonPath))
                    {
                        string packageJsonContent = @"{
  ""name"": ""gold-rates-extractor"",
  ""version"": ""1.0.0"",
  ""description"": ""Extracts gold rates from websites"",
  ""main"": ""goldExtractor.js"",
  ""dependencies"": {
    ""puppeteer"": ""^19.7.5""
  }
}";
                        File.WriteAllText(packageJsonPath, packageJsonContent);
                        LogInfo($"Created package.json at: {packageJsonPath}");
                    }

                    // Find npm executable
                    string npmPath = FindNpmExecutable();

                    if (string.IsNullOrEmpty(npmPath))
                    {
                        LogError("Cannot find npm executable. Please install Node.js properly.");
                        return false;
                    }

                    LogInfo($"Using npm from: {npmPath}");

                    // Create a custom batch file to run npm install
                    string batchPath = Path.Combine(scriptDirectory, "run-npm-install.bat");
                    string batchContent = $@"@echo off
cd ""{scriptDirectory}""
""{npmPath}"" install
echo npm install completed with exit code %ERRORLEVEL%
exit %ERRORLEVEL%";

                    File.WriteAllText(batchPath, batchContent);
                    LogInfo($"Created npm installation batch file at: {batchPath}");

                    // Run the batch file
                    using (var process = new Process())
                    {
                        process.StartInfo.FileName = batchPath;
                        process.StartInfo.UseShellExecute = false;
                        process.StartInfo.RedirectStandardOutput = true;
                        process.StartInfo.RedirectStandardError = true;
                        process.StartInfo.CreateNoWindow = true;

                        var output = new StringBuilder();
                        var error = new StringBuilder();

                        process.OutputDataReceived += (sender, e) => {
                            if (!string.IsNullOrEmpty(e.Data))
                            {
                                output.AppendLine(e.Data);
                                LogInfo($"npm output: {e.Data}");
                            }
                        };

                        process.ErrorDataReceived += (sender, e) => {
                            if (!string.IsNullOrEmpty(e.Data))
                            {
                                error.AppendLine(e.Data);
                                LogInfo($"npm error: {e.Data}");
                            }
                        };

                        LogInfo("Running npm install via batch file...");

                        try
                        {
                            process.Start();
                            process.BeginOutputReadLine();
                            process.BeginErrorReadLine();

                            if (!process.WaitForExit(300000)) // 5 minute timeout
                            {
                                LogError("Dependency installation timed out after 5 minutes");
                                process.Kill();
                                return false;
                            }

                            if (process.ExitCode == 0)
                            {
                                LogInfo("Dependencies installed successfully");
                                return true;
                            }
                            else
                            {
                                LogError($"Dependency installation failed with exit code: {process.ExitCode}");
                                LogError($"Error output: {error.ToString()}");
                                return false;
                            }
                        }
                        catch (Exception ex)
                        {
                            LogError($"Error running npm install batch file: {ex.Message}");
                            return false;
                        }
                    }
                }
                else
                {
                    LogInfo("Node.js dependencies are already installed");
                    return true;
                }
            }
            catch (Exception ex)
            {
                LogError($"Error checking dependencies: {ex.Message}");
                return false;
            }
        }

        private string FindNpmExecutable()
        {
            try
            {
                // Option 1: Try to find npm in the same directory as node.exe
                if (!string.IsNullOrEmpty(nodeJsPath) && File.Exists(nodeJsPath))
                {
                    string nodeDir = Path.GetDirectoryName(nodeJsPath);
                    string npmPath = Path.Combine(nodeDir, "npm.cmd");

                    if (File.Exists(npmPath))
                    {
                        LogInfo($"Found npm.cmd in Node.js directory: {npmPath}");
                        return npmPath;
                    }

                    // Also check for npm.bat
                    npmPath = Path.Combine(nodeDir, "npm.bat");
                    if (File.Exists(npmPath))
                    {
                        LogInfo($"Found npm.bat in Node.js directory: {npmPath}");
                        return npmPath;
                    }

                    // Also check for npm (no extension)
                    npmPath = Path.Combine(nodeDir, "npm");
                    if (File.Exists(npmPath))
                    {
                        LogInfo($"Found npm in Node.js directory: {npmPath}");
                        return npmPath;
                    }
                }

                // Option 2: Look in common npm locations
                string[] commonNpmLocations = new[]
                {
            @"C:\Program Files\nodejs\npm.cmd",
            @"C:\Program Files\nodejs\npm.bat",
            @"C:\Program Files\nodejs\npm",
            @"C:\Program Files (x86)\nodejs\npm.cmd",
            @"C:\Program Files (x86)\nodejs\npm.bat",
            @"C:\Program Files (x86)\nodejs\npm"
        };

                foreach (string location in commonNpmLocations)
                {
                    if (File.Exists(location))
                    {
                        LogInfo($"Found npm at common location: {location}");
                        return location;
                    }
                }

                // Option 3: Try to query npm location using where command
                try
                {
                    LogInfo("Attempting to locate npm using 'where' command...");

                    using (var process = new Process())
                    {
                        process.StartInfo.FileName = "where";
                        process.StartInfo.Arguments = "npm";
                        process.StartInfo.UseShellExecute = false;
                        process.StartInfo.RedirectStandardOutput = true;
                        process.StartInfo.CreateNoWindow = true;

                        process.Start();
                        string output = process.StandardOutput.ReadToEnd().Trim();
                        process.WaitForExit();

                        if (!string.IsNullOrEmpty(output) && process.ExitCode == 0)
                        {
                            // Take the first line which should be the npm path
                            string npmPath = output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();

                            if (!string.IsNullOrEmpty(npmPath) && File.Exists(npmPath))
                            {
                                LogInfo($"Found npm using 'where' command: {npmPath}");
                                return npmPath;
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    LogError($"Error trying to locate npm with 'where' command: {ex.Message}");
                }

                // Option 4: Fallback to just using "npm" and rely on PATH environment variable
                LogInfo("Could not find npm executable path, falling back to using 'npm' command directly...");
                return "npm";
            }
            catch (Exception ex)
            {
                LogError($"Error searching for npm: {ex.Message}");
                return null;
            }
        }


        private async Task ExtractGoldRatesAsync()
        {
            LogInfo("Starting gold rates extraction process");

            try
            {
                // Make sure we have Node.js
                if (string.IsNullOrEmpty(nodeJsPath) || !File.Exists(nodeJsPath))
                {
                    LogError("Node.js not found. Cannot proceed with extraction.");
                    return;
                }

                // Make sure the script exists
                if (!File.Exists(scriptPath))
                {
                    LogError($"Script file not found at {scriptPath}.");
                    return;
                }

                // Determine which website to use based on configuration
                string url;

                if (websiteOption == 1)
                {
                    url = ConfigurationManager.AppSettings["UrlOption1"];
                    currentCompanyName = ConfigurationManager.AppSettings["CompanyName1"];
                    LogInfo($"Using Option 1: {currentCompanyName} at {url}");

                    // Extract data from TTTBullion
                    DataTable extractedData = await ExtractTTTBullionDataAsync(url);

                    if (extractedData.Rows.Count > 0)
                    {
                        await SaveTTTBullionDataAsync(extractedData);
                        LogInfo($"Successfully extracted and saved data from {currentCompanyName}");
                    }
                    else
                    {
                        LogError($"Failed to extract data from {currentCompanyName}");
                    }
                }
                else
                {
                    url = ConfigurationManager.AppSettings["UrlOption2"];
                    currentCompanyName = ConfigurationManager.AppSettings["CompanyName2"];
                    LogInfo($"Using Option 2: {currentCompanyName} at {url}");

                    // Extract data from MSGold
                    var (ourRatesData, customerSellData) = await ExtractMSGoldDataAsync(url);

                    if (ourRatesData.Rows.Count > 0 || customerSellData.Rows.Count > 0)
                    {
                        await SaveMSGoldDataAsync(ourRatesData, customerSellData);
                        LogInfo($"Successfully extracted and saved data from {currentCompanyName}");
                    }
                    else
                    {
                        LogError($"Failed to extract data from {currentCompanyName}");
                    }
                }
            }
            catch (Exception ex)
            {
                LogError($"Critical error in extraction process: {ex.Message}");
                LogError($"Stack trace: {ex.StackTrace}");
            }
        }

        private void LogRecommendationBasedOnError(ScraperError error, int websiteOption)
        {
            string websiteName = websiteOption == 1 ? "TTTBullion" : "MSGold";
            string recommendationHeader = $"RECOMMENDATION FOR {websiteName}:";

            switch (error.ErrorType)
            {
                case "NAVIGATION_ERROR":
                    LogError($"{recommendationHeader} The website may be down or inaccessible. Please check if {websiteName} is operational.");
                    LogError($"{recommendationHeader} You may need to update the URL in the App.config file.");
                    LogError($"{recommendationHeader} Consider temporarily switching to website option {(websiteOption == 1 ? "2" : "1")} in App.config.");
                    break;

                case "TABLE_NOT_FOUND":
                    LogError($"{recommendationHeader} The website structure has likely changed. The gold rates table could not be found.");
                    LogError($"{recommendationHeader} The script in goldExtractor.js needs to be updated to match the new website structure.");
                    LogError($"{recommendationHeader} Update the script or switch to website option {(websiteOption == 1 ? "2" : "1")}.");
                    break;

                case "DATA_STRUCTURE_ERROR":
                    LogError($"{recommendationHeader} The website's data format has changed. The table was found but data couldn't be extracted.");
                    LogError($"{recommendationHeader} Update the extraction logic in goldExtractor.js to match the new structure.");
                    break;

                case "EXTRACTION_ERROR":
                    LogError($"{recommendationHeader} Gold rates were not extractable from the website.");
                    LogError($"{recommendationHeader} The script may need adjustments to find the correct data elements.");
                    break;

                case "NETWORK_ERROR":
                    LogError($"{recommendationHeader} Network connection issues prevented accessing the website.");
                    LogError($"{recommendationHeader} Check internet connectivity and firewall settings.");
                    break;

                default:
                    LogError($"{recommendationHeader} An unknown error occurred while extracting data from {websiteName}.");
                    LogError($"{recommendationHeader} Check the goldExtractor.js script and consider switching to website option {(websiteOption == 1 ? "2" : "1")}.");
                    break;
            }

            // Log additional details if available
            if (error.Details != null && error.Details.Count > 0)
            {
                LogError($"{recommendationHeader} Additional error details: {JsonConvert.SerializeObject(error.Details)}");
            }
        }

        // Add a screenshot capture capability
        private string CaptureScreenshot(int websiteOption)
        {
            try
            {
                string scriptDir = Path.GetDirectoryName(scriptPath);
                string screenshotPath = Path.Combine(scriptDir, $"error_screenshot_{DateTime.Now:yyyyMMdd_HHmmss}.png");

                // Look for any screenshot that might have been saved by the script
                string debugScreenshot = Path.Combine(scriptDir, "debug_screenshot.png");

                if (File.Exists(debugScreenshot))
                {
                    // Copy it to a timestamped name for preservation
                    File.Copy(debugScreenshot, screenshotPath, true);
                    LogInfo($"Saved error screenshot to {screenshotPath}");
                    return screenshotPath;
                }

                return null;
            }
            catch (Exception ex)
            {
                LogError($"Failed to capture/save screenshot: {ex.Message}");
                return null;
            }
        }


        private async Task<DataTable> ExtractTTTBullionDataAsync(string url)
        {
            LogInfo("Beginning TTT Bullion data extraction using Node.js script");

            DataTable extractedData = new DataTable();
            extractedData.Columns.Add("DetailName", typeof(string));
            extractedData.Columns.Add("WeBuy", typeof(decimal));
            extractedData.Columns.Add("WeSell", typeof(decimal));

            try
            {
                // Launch Node.js process to run the script
                using (var process = new Process())
                {
                    process.StartInfo.FileName = nodeJsPath;
                    process.StartInfo.Arguments = $"\"{scriptPath}\" tttbullion \"{url}\" {navigationTimeoutMs} {waitAfterNavigationMs}";
                    process.StartInfo.UseShellExecute = false;
                    process.StartInfo.RedirectStandardOutput = true;
                    process.StartInfo.RedirectStandardError = true;
                    process.StartInfo.CreateNoWindow = true;
                    process.StartInfo.WorkingDirectory = Path.GetDirectoryName(scriptPath);

                    var outputData = new List<string>();
                    var errorData = new List<string>();
                    ScraperError structuredError = null;

                    process.OutputDataReceived += (sender, e) =>
                    {
                        if (!string.IsNullOrEmpty(e.Data))
                            outputData.Add(e.Data);
                    };

                    process.ErrorDataReceived += (sender, e) =>
                    {
                        if (!string.IsNullOrEmpty(e.Data))
                        {
                            errorData.Add(e.Data);

                            // Look for structured error messages from the script
                            if (e.Data.StartsWith("ERROR_JSON: "))
                            {
                                try
                                {
                                    string errorJson = e.Data.Substring("ERROR_JSON: ".Length);
                                    structuredError = JsonConvert.DeserializeObject<ScraperError>(errorJson);
                                    LogError($"Structured error from script: {structuredError.ErrorType} - {structuredError.Message}");
                                }
                                catch (Exception jsonEx)
                                {
                                    LogError($"Failed to parse error JSON: {jsonEx.Message}");
                                }
                            }
                        }
                    };

                    LogInfo($"Running Node.js script for TTT Bullion: {process.StartInfo.Arguments}");
                    LogInfo($"Working directory: {process.StartInfo.WorkingDirectory}");

                    process.Start();
                    process.BeginOutputReadLine();
                    process.BeginErrorReadLine();

                    // Wait for process to finish with a timeout
                    await Task.Run(() =>
                    {
                        if (!process.WaitForExit(60000)) // 60 second timeout
                        {
                            LogError("Node.js script took too long to execute. Killing process.");
                            try { process.Kill(); } catch { }
                        }
                    });

                    // Log any errors or debug info
                    if (errorData.Count > 0)
                    {
                        foreach (var error in errorData)
                        {
                            // Don't log the structured error JSON again
                            if (!error.StartsWith("ERROR_JSON: "))
                            {
                                LogInfo($"Script debug: {error}");
                            }
                        }
                    }

                    // Process the output
                    if (outputData.Count > 0)
                    {
                        string jsonOutput = string.Join("\n", outputData);
                        try
                        {
                            // Parse the JSON output
                            var goldRates = JsonConvert.DeserializeObject<List<GoldRate>>(jsonOutput);

                            if (goldRates != null && goldRates.Count > 0)
                            {
                                foreach (var rate in goldRates)
                                {
                                    extractedData.Rows.Add(rate.DetailName, rate.WeBuy, rate.WeSell);
                                    LogInfo($"Extracted from external script: {rate.DetailName}, Buy: {rate.WeBuy}, Sell: {rate.WeSell}");
                                }
                            }
                            else
                            {
                                LogError("No gold rates found in script output.");
                            }
                        }
                        catch (Exception ex)
                        {
                            LogError($"Error parsing script output: {ex.Message}");
                            LogError($"Script output: {jsonOutput}");
                        }
                    }
                    else
                    {
                        LogError("No output produced by Node.js script.");

                        // Log specific recommendations based on the error
                        if (structuredError != null)
                        {
                            LogRecommendationBasedOnError(structuredError, 1); // 1 is the website option for TTTBullion
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                LogError($"Error running external script: {ex.Message}");
            }

            return extractedData;
        }

        private async Task<(DataTable OurRates, DataTable CustomerSell)> ExtractMSGoldDataAsync(string url)
        {
            LogInfo("Beginning MS Gold data extraction using Node.js script");

            DataTable ourRatesData = new DataTable();
            ourRatesData.Columns.Add("DetailName", typeof(string));
            ourRatesData.Columns.Add("WeBuy", typeof(decimal));
            ourRatesData.Columns.Add("WeSell", typeof(decimal));
            ourRatesData.Columns.Add("Type", typeof(string));

            DataTable customerSellData = new DataTable();
            customerSellData.Columns.Add("DetailName", typeof(string));
            customerSellData.Columns.Add("WeBuy", typeof(decimal));
            customerSellData.Columns.Add("WeSell", typeof(decimal));
            customerSellData.Columns.Add("Type", typeof(string));

            try
            {
                // Launch Node.js process to run the script
                using (var process = new Process())
                {
                    process.StartInfo.FileName = nodeJsPath;
                    process.StartInfo.Arguments = $"\"{scriptPath}\" msgold \"{url}\" {navigationTimeoutMs} {waitAfterNavigationMs}";
                    process.StartInfo.UseShellExecute = false;
                    process.StartInfo.RedirectStandardOutput = true;
                    process.StartInfo.RedirectStandardError = true;
                    process.StartInfo.CreateNoWindow = true;

                    var outputData = new List<string>();
                    var errorData = new List<string>();

                    process.OutputDataReceived += (sender, e) =>
                    {
                        if (!string.IsNullOrEmpty(e.Data))
                            outputData.Add(e.Data);
                    };

                    process.ErrorDataReceived += (sender, e) =>
                    {
                        if (!string.IsNullOrEmpty(e.Data))
                            errorData.Add(e.Data);
                    };

                    LogInfo($"Running Node.js script for MS Gold: {process.StartInfo.Arguments}");

                    process.Start();
                    process.BeginOutputReadLine();
                    process.BeginErrorReadLine();

                    // Wait for process to finish with a timeout
                    await Task.Run(() =>
                    {
                        if (!process.WaitForExit(scriptTimeoutMs)) // 60 second timeout from variable
                        {
                            LogError("Node.js script took too long to execute. Killing process.");
                            try { process.Kill(); } catch { }
                        }
                    });

                    // Log any errors
                    if (errorData.Count > 0)
                    {
                        foreach (var error in errorData)
                        {
                            LogInfo($"Script debug: {error}");
                        }
                    }

                    // Process the output
                    if (outputData.Count > 0)
                    {
                        string jsonOutput = string.Join("\n", outputData);
                        try
                        {
                            // Parse the JSON output - for MSGold we expect a different format
                            var msGoldData = JsonConvert.DeserializeObject<MSGoldData>(jsonOutput);

                            if (msGoldData != null)
                            {
                                if (msGoldData.OurRates != null && msGoldData.OurRates.Count > 0)
                                {
                                    foreach (var rate in msGoldData.OurRates)
                                    {
                                        ourRatesData.Rows.Add(rate.DetailName, rate.WeBuy, rate.WeSell, "OurRates");
                                        LogInfo($"Extracted OurRates from external script: {rate.DetailName}, Buy: {rate.WeBuy}, Sell: {rate.WeSell}");
                                    }
                                }

                                if (msGoldData.CustomerSell != null && msGoldData.CustomerSell.Count > 0)
                                {
                                    foreach (var rate in msGoldData.CustomerSell)
                                    {
                                        customerSellData.Rows.Add(rate.DetailName, rate.WeBuy, DBNull.Value, "CustomerSell");
                                        LogInfo($"Extracted CustomerSell from external script: {rate.DetailName}, Buy: {rate.WeBuy}");
                                    }
                                }

                                if ((msGoldData.OurRates == null || msGoldData.OurRates.Count == 0) &&
                                    (msGoldData.CustomerSell == null || msGoldData.CustomerSell.Count == 0))
                                {
                                    LogError("No gold rates found in script output.");
                                }
                            }
                            else
                            {
                                LogError("No gold rates found in script output.");
                            }
                        }
                        catch (Exception ex)
                        {
                            LogError($"Error parsing script output: {ex.Message}");
                            LogError($"Script output: {jsonOutput}");
                        }
                    }
                    else
                    {
                        LogError("No output produced by Node.js script.");
                    }
                }
            }
            catch (Exception ex)
            {
                LogError($"Error running external script: {ex.Message}");
            }

            return (ourRatesData, customerSellData);
        }


        private async Task SaveTTTBullionDataAsync(DataTable data)
        {
            LogInfo("Saving TTT Bullion data to database...");

            try
            {
                using (SqlConnection connection = new SqlConnection(connectionString))
                {
                    await connection.OpenAsync();
                    LogInfo("Connected to database.");

                    int rowsSaved = 0;

                    foreach (DataRow row in data.Rows)
                    {
                        string detailName = row["DetailName"].ToString();
                        decimal weBuy = (decimal)row["WeBuy"];
                        decimal? weSell = row["WeSell"] != DBNull.Value ? (decimal?)row["WeSell"] : null;

                        // Use the stored procedure instead of direct SQL
                        using (SqlCommand command = new SqlCommand("sp_goldRates_upsert", connection))
                        {
                            command.CommandType = CommandType.StoredProcedure;

                            // Add parameters to call the stored procedure
                            command.Parameters.AddWithValue("@CompanyName", currentCompanyName);
                            command.Parameters.AddWithValue("@TableType", "OurRates"); // Always OurRates for gold rates
                            command.Parameters.AddWithValue("@DetailName", detailName);
                            command.Parameters.AddWithValue("@WeBuy", weBuy);
                            command.Parameters.AddWithValue("@WeSell", weSell.HasValue ? (object)weSell.Value : DBNull.Value);

                            await command.ExecuteNonQueryAsync();
                            rowsSaved++;
                            LogInfo($"Updated/Saved gold rate for {detailName}");
                        }
                    }

                    LogInfo($"Successfully saved {rowsSaved} gold rates records for TTT Bullion.");
                }
            }
            catch (Exception ex)
            {
                LogError($"Database error: {ex.Message}");
                throw;
            }
        }

        private async Task SaveMSGoldDataAsync(DataTable ourRatesData, DataTable customerSellData)
        {
            LogInfo("Saving MS Gold data to database...");

            try
            {
                using (SqlConnection connection = new SqlConnection(connectionString))
                {
                    await connection.OpenAsync();
                    LogInfo("Connected to database.");

                    // Save OurRates data
                    int ourRatesSaved = 0;
                    foreach (DataRow row in ourRatesData.Rows)
                    {
                        string detailName = row["DetailName"].ToString();
                        decimal weBuy = (decimal)row["WeBuy"];
                        decimal? weSell = row["WeSell"] != DBNull.Value ? (decimal?)row["WeSell"] : null;

                        // Use the stored procedure instead of direct SQL
                        using (SqlCommand command = new SqlCommand("sp_goldRates_upsert", connection))
                        {
                            command.CommandType = CommandType.StoredProcedure;

                            // Add parameters
                            command.Parameters.AddWithValue("@CompanyName", currentCompanyName);
                            command.Parameters.AddWithValue("@TableType", "OurRates");
                            command.Parameters.AddWithValue("@DetailName", detailName);
                            command.Parameters.AddWithValue("@WeBuy", weBuy);
                            command.Parameters.AddWithValue("@WeSell", weSell.HasValue ? (object)weSell.Value : DBNull.Value);

                            await command.ExecuteNonQueryAsync();
                            ourRatesSaved++;
                            LogInfo($"Updated/Saved OurRates data for {detailName}");
                        }
                    }

                    // Save CustomerSell data
                    int customerSellSaved = 0;
                    foreach (DataRow row in customerSellData.Rows)
                    {
                        string detailName = row["DetailName"].ToString();
                        decimal weBuy = (decimal)row["WeBuy"];

                        // Use the stored procedure instead of direct SQL
                        using (SqlCommand command = new SqlCommand("sp_goldRates_upsert", connection))
                        {
                            command.CommandType = CommandType.StoredProcedure;

                            // Add parameters
                            command.Parameters.AddWithValue("@CompanyName", currentCompanyName);
                            command.Parameters.AddWithValue("@TableType", "CustomerSell");
                            command.Parameters.AddWithValue("@DetailName", detailName);
                            command.Parameters.AddWithValue("@WeBuy", weBuy);
                            command.Parameters.AddWithValue("@WeSell", DBNull.Value); // CustomerSell doesn't have WeSell values

                            await command.ExecuteNonQueryAsync();
                            customerSellSaved++;
                            LogInfo($"Updated/Saved CustomerSell data for {detailName}");
                        }
                    }

                    LogInfo($"Successfully saved {ourRatesSaved} OurRates records and {customerSellSaved} CustomerSell records for MS Gold.");
                }
            }
            catch (Exception ex)
            {
                LogError($"Database error: {ex.Message}");
                throw;
            }
        }

        private void LogInfo(string message)
        {
            try
            {
                string logMessage = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} - {message}";

                // Ensure we append to the file, not overwrite it
                File.AppendAllText(logFilePath, logMessage + Environment.NewLine);
            }
            catch (Exception ex)
            {
                // Try to log to Event Log if file logging fails
                try
                {
                    if (!EventLog.SourceExists("GoldRatesExtractor"))
                    {
                        EventLog.CreateEventSource("GoldRatesExtractor", "Application");
                    }
                    EventLog.WriteEntry("GoldRatesExtractor",
                        $"Failed to write to log file: {ex.Message}. Original message: {message}",
                        EventLogEntryType.Warning);
                }
                catch
                {
                   
                }
            }
        }

        private void LogError(string errorMessage)
        {
            try
            {
                string logMessage = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} - ERROR: {errorMessage}";

                // Ensure we append to the error file, not overwrite it
                File.AppendAllText(errorLogFilePath, logMessage + Environment.NewLine);

                // Also log to the regular log file
                LogInfo($"ERROR: {errorMessage}");

                // Log to Event Log as well for critical errors
                try
                {
                    if (!EventLog.SourceExists("GoldRatesExtractor"))
                    {
                        EventLog.CreateEventSource("GoldRatesExtractor", "Application");
                    }
                    EventLog.WriteEntry("GoldRatesExtractor", errorMessage, EventLogEntryType.Error);
                }
                catch
                {
                    
                }
            }
            catch (Exception ex)
            {
                // Try to log to Event Log if file logging fails
                try
                {
                    if (!EventLog.SourceExists("GoldRatesExtractor"))
                    {
                        EventLog.CreateEventSource("GoldRatesExtractor", "Application");
                    }
                    EventLog.WriteEntry("GoldRatesExtractor",
                        $"Failed to write to error log file: {ex.Message}. Original error: {errorMessage}",
                        EventLogEntryType.Error);
                }
                catch
                {
                    
                }
            }
        }
    }

    //Error Handling
    public class ScraperError
    {
        public string ErrorType { get; set; }
        public string Message { get; set; }
        public string Timestamp { get; set; }
        public Dictionary<string, object> Details { get; set; }
    }

    // Data models for JSON deserialization
    public class GoldRate
    {
        public string DetailName { get; set; }
        public decimal WeBuy { get; set; }
        public decimal WeSell { get; set; }
    }

    public class MSGoldData
    {
        public List<GoldRate> OurRates { get; set; }
        public List<CustomerSellRate> CustomerSell { get; set; }
    }

    public class CustomerSellRate
    {
        public string DetailName { get; set; }
        public decimal WeBuy { get; set; }
    }
}