using System.ComponentModel;
using System.Configuration.Install;
using System.ServiceProcess;

namespace GoldRatesExtractor
{
    [RunInstaller(true)]
    public partial class GoldRatesServiceInstaller : System.Configuration.Install.Installer
    {
        public GoldRatesServiceInstaller()
        {
            InitializeComponent(); 
        }

        private void serviceInstaller_AfterInstall(object sender, InstallEventArgs e)
        {

        }

        private void serviceProcessInstaller_AfterInstall(object sender, InstallEventArgs e)
        {

        }
    }
}