#!/usr/bin/env node
/**
 * One-time local OAuth helper — run this once to get a Gmail refresh token.
 *
 * Usage:
 *   cd scripts && npm install
 *   GMAIL_CLIENT_ID=xxx GMAIL_CLIENT_SECRET=xxx node get-gmail-token.js
 *
 * Then copy the printed refresh token into your GitHub repo secret GMAIL_REFRESH_TOKEN.
 */

import { google } from 'googleapis';
import * as readline from 'readline';

const CLIENT_ID     = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REDIRECT_URI  = 'urn:ietf:wg:oauth:2.0:oob'; // desktop app / copy-paste flow

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Error: GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET must be set.');
  console.error('Example:');
  console.error('  GMAIL_CLIENT_ID=xxx GMAIL_CLIENT_SECRET=xxx node get-gmail-token.js');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt:      'consent', // forces a new refresh_token even if previously authorized
  scope:       ['https://www.googleapis.com/auth/gmail.readonly'],
});

console.log('\n1. Open this URL in your browser:\n');
console.log('   ' + authUrl);
console.log('\n2. Authorize the app and copy the code shown.\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('3. Paste the authorization code here: ', async (code) => {
  rl.close();
  try {
    const { tokens } = await oauth2Client.getToken(code.trim());
    console.log('\n✓ Success! Add this as a GitHub secret named GMAIL_REFRESH_TOKEN:\n');
    console.log('   ' + tokens.refresh_token);
    console.log('\nAlso keep these values (already in your secrets):');
    console.log('   GMAIL_CLIENT_ID     =', CLIENT_ID);
    console.log('   GMAIL_CLIENT_SECRET =', CLIENT_SECRET);
  } catch (err) {
    console.error('\n✗ Failed to exchange code:', err.message);
    process.exit(1);
  }
});
