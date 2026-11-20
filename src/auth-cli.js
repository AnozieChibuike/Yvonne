import readline from 'node:readline';
import { validateGoogleConfig } from './config/env.js';
import { createOAuth2Client, getAuthUrl, asyncExchangeCodeForToken } from './services/googleAuth.js';

async function runAuthCLI() {
  console.log('\n======================================================');
  console.log('🔑 Google Tasks OAuth 2.0 Authorization Setup Wizard');
  console.log('======================================================\n');

  if (!validateGoogleConfig()) {
    process.exit(1);
  }

  const oAuth2Client = createOAuth2Client();
  const authUrl = getAuthUrl(oAuth2Client);

  console.log('1. Open the following URL in your web browser:\n');
  console.log(`   \x1b[36m${authUrl}\x1b[0m\n`);
  console.log('2. Log in to your Google Account and click "Allow" to grant Google Tasks permissions.');
  console.log('3. Copy the authorization code provided on the screen (or from the redirect URL code parameter).\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('👉 Enter the authorization code here: ', async (code) => {
    rl.close();
    const cleanCode = code.trim();

    if (!cleanCode) {
      console.error('❌ Authorization code cannot be empty.');
      process.exit(1);
    }

    try {
      console.log('\n⏳ Exchanging authorization code for tokens...');
      await asyncExchangeCodeForToken(oAuth2Client, cleanCode);
      console.log('\n🎉 Authorization successful! Google Tasks credentials saved to token.json.');
      console.log('You can now launch the bot using: npm start\n');
    } catch (err) {
      console.error('\n❌ Authorization failed:', err.message);
      process.exit(1);
    }
  });
}

runAuthCLI();
