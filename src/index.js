import { createClient } from '@supabase/supabase-js';
import { config, validateAssistantConfig, validateGoogleConfig } from './config/env.js';
import { createYvonneToolRegistry } from './assistant/tools.js';
import { YvonneAssistant } from './assistant/yvonne.js';
import { YvonneDataService } from './services/yvonneData.js';
import { getAuthenticatedClient } from './services/googleAuth.js';
import { GoogleTasksService } from './services/googleTasks.js';
import { getDefaultCheckinSettings, startCheckinScheduler } from './services/checkinScheduler.js';
import { createGroqClient, transcribeVoiceNote } from './services/groq.js';
import { handleIncomingMessage } from './whatsapp/handler.js';
import { startWhatsAppClient } from './whatsapp/client.js';

async function createGoogleTasksService() {
  const hasGoogleConfig = config.google.clientId || config.google.clientSecret;
  if (!hasGoogleConfig) return null;
  if (!validateGoogleConfig()) {
    console.warn('Google Tasks is disabled until both OAuth variables are configured.');
    return null;
  }

  const authClient = await getAuthenticatedClient();
  if (!authClient) {
    console.warn('Google Tasks is disabled because no valid token.json was found. Run `npm run auth` to enable it.');
    return null;
  }
  return new GoogleTasksService(authClient);
}

async function main() {
  console.log('Starting Yvonne on WhatsApp...');
  if (!validateAssistantConfig()) {
    throw new Error('Yvonne configuration is incomplete.');
  }

  const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const dataService = new YvonneDataService(supabase);
  const googleTasks = await createGoogleTasksService();
  const groq = createGroqClient();
  const toolRegistry = createYvonneToolRegistry({ dataService, googleTasks });
  const assistant = new YvonneAssistant(groq, toolRegistry, config.groq.model, dataService);
  const defaultCheckins = getDefaultCheckinSettings();

  for (const userJid of config.whatsapp.allowedJids) {
    await dataService.ensureUserProfile(userJid);
    await dataService.ensureDefaultCheckins(userJid, defaultCheckins);
  }

  let currentSocket = null;
  await startWhatsAppClient(
    (sock, msg) => handleIncomingMessage(sock, msg, {
      assistant,
      dataService,
      googleTasks,
      transcribeVoiceNote: (audio, contentType) => transcribeVoiceNote(groq, audio, contentType)
    }),
    sock => {
      currentSocket = sock;
    }
  );
  startCheckinScheduler({
    allowedJids: config.whatsapp.allowedJids,
    dataService,
    getSocket: () => currentSocket
  });
  console.log(`Yvonne is ready. Check-ins use ${config.checkins.timezone}.`);
}

main().catch(error => {
  console.error('Fatal error starting Yvonne:', error);
  process.exitCode = 1;
});
