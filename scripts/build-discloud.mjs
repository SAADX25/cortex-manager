import { pathToFileURL } from 'node:url';
import { buildDiscloud } from '../src/deployment-package.mjs';
export { buildDiscloud } from '../src/deployment-package.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { zip, report } = buildDiscloud();
    console.log('Ready: ' + zip);
    console.log('Size: ' + (report.bytes / 1024 / 1024).toFixed(2) + ' MB');
    console.log(
      'Sources: ' +
        report.feeds.length +
        ' | Welcome servers: ' +
        report.welcome.length +
        ' | Ticket servers: ' +
        report.tickets.length,
    );
    console.log('Discloud app: ' + report.appId);
    console.log('Discloud environment: ' + report.requiredEnvironment.join(', '));
    console.log('No tokens included. Not uploaded. Preserve hosted data/ when updating.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
