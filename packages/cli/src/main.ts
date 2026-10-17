import { Command } from 'commander';
import {
  CLI_VERSION,
  connectCommand,
  disconnectCommand,
  startCommand,
  statusCommand,
} from './commands.js';
import { errorMessage } from './log.js';

const program = new Command();
program
  .name('agent')
  .description('Connect this computer to your workspace and run agents on Claude Code')
  .version(CLI_VERSION);

program
  .command('connect')
  .description('Pair this computer using a code from the web app')
  .requiredOption('--server <url>', 'API origin, e.g. http://localhost:3000')
  .requiredOption('--code <code>', 'Pairing code (ABCD-EFGH)')
  .option('--name <name>', 'Computer name (default: hostname)')
  .option('--start', 'Start the daemon right after pairing')
  .action(async (opts: { server: string; code: string; name?: string; start?: boolean }) => {
    await connectCommand(opts);
    if (opts.start) process.exitCode = await startCommand();
    else console.log('Start the daemon with: agent start');
  });

program
  .command('start')
  .description('Run the daemon (heartbeat, claim and run assignments)')
  .action(async () => {
    process.exitCode = await startCommand();
  });

program
  .command('status')
  .description('Show connection details and check the gateway and Claude login')
  .action(async () => {
    process.exitCode = await statusCommand();
  });

program
  .command('disconnect')
  .description('Delete the local config')
  .action(async () => {
    await disconnectCommand();
  });

program.parseAsync().catch((err) => {
  console.error(`Error: ${errorMessage(err)}`);
  process.exit(1);
});
