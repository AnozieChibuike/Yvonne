import { google } from 'googleapis';
import fs from 'node:fs/promises';
import { config } from '../config/env.js';

const SCOPES = ['https://www.googleapis.com/auth/tasks'];

/**
 * Creates and configures an OAuth2 client
 * @returns {import('googleapis').Auth.OAuth2Client}
 */
export function createOAuth2Client() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

/**
 * Generates authorization URL for Google OAuth consent screen
 * @param {import('googleapis').Auth.OAuth2Client} oAuth2Client 
 * @returns {string}
 */
export function getAuthUrl(oAuth2Client) {
  return oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });
}

/**
 * Exchanges authorization code for tokens and saves to token.json
 * @param {import('googleapis').Auth.OAuth2Client} oAuth2Client 
 * @param {string} code 
 * @returns {Promise<object>}
 */
export function asyncExchangeCodeForToken(oAuth2Client, code) {
  return new Promise((resolve, reject) => {
    oAuth2Client.getToken(code, async (err, tokens) => {
      if (err) {
        return reject(new Error(`Error retrieving access token: ${err.message}`));
      }
      oAuth2Client.setCredentials(tokens);
      try {
        await fs.writeFile(config.google.tokenPath, JSON.stringify(tokens, null, 2));
        console.log('✅ Token stored to', config.google.tokenPath);
        resolve(tokens);
      } catch (fileErr) {
        reject(new Error(`Failed to save token to file: ${fileErr.message}`));
      }
    });
  });
}

/**
 * Loads stored tokens and returns an authenticated OAuth2 client
 * @returns {Promise<import('googleapis').Auth.OAuth2Client|null>}
 */
export async function getAuthenticatedClient() {
  const oAuth2Client = createOAuth2Client();

  try {
    const tokenData = await fs.readFile(config.google.tokenPath, 'utf8');
    const tokens = JSON.parse(tokenData);
    oAuth2Client.setCredentials(tokens);

    // Save tokens on update (auto refresh)
    oAuth2Client.on('tokens', async (newTokens) => {
      try {
        const currentTokens = JSON.parse(await fs.readFile(config.google.tokenPath, 'utf8').catch(() => '{}'));
        const updatedTokens = { ...currentTokens, ...newTokens };
        await fs.writeFile(config.google.tokenPath, JSON.stringify(updatedTokens, null, 2));
        console.log('🔄 Refreshed and updated Google OAuth tokens.');
      } catch (err) {
        console.error('Failed to update refreshed tokens:', err.message);
      }
    });

    return oAuth2Client;
  } catch (err) {
    return null;
  }
}
