using System;
using System.ServiceProcess;
using System.Reflection;

namespace GoldRatesExtractor
{
    static class Program
    {
        /// <summary>
        /// The main entry point for the application.
        /// </summary>
        static void Main(string[] args)
        {
            // If running with -console argument, run as console application
            if (args.Length > 0 && args[0].ToLower() == "-console")
            {
                Console.WriteLine("Starting Gold Rates Extractor in console mode...");

                try
                {
                    // Create service instance
                    using (var service = new GoldRatesService())
                    {
                        // Call OnStart directly using reflection
                        typeof(ServiceBase).GetMethod("OnStart",
                                BindingFlags.Instance | BindingFlags.NonPublic)
                            .Invoke(service, new object[] { args });

                        Console.WriteLine("Service started. Press any key to stop the service...");
                        Console.ReadKey();

                        // Call OnStop directly using reflection
                        typeof(ServiceBase).GetMethod("OnStop",
                                BindingFlags.Instance | BindingFlags.NonPublic)
                            .Invoke(service, null);

                        Console.WriteLine("Service stopped.");
                    }
                }
                catch (Exception ex)
                {
                    Console.ForegroundColor = ConsoleColor.Red;
                    Console.WriteLine($"Error: {ex.Message}");
                    Console.WriteLine(ex.StackTrace);
                    Console.ResetColor();
                }

                Console.WriteLine("Press any key to exit...");
                Console.ReadKey();
            }
            else
            {
                // Running as a Windows Service
                ServiceBase[] ServicesToRun;
                ServicesToRun = new ServiceBase[]
                {
                    new GoldRatesService()
                };
                ServiceBase.Run(ServicesToRun);
            }
        }
    }
}