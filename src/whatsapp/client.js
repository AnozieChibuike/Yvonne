import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { config } from '../config/env.js';

/**
 * Initializes and starts the Baileys WhatsApp client socket
 * @param {Function} onMessageCallback 
 */
export async function startWhatsAppClient(onMessageCallback, onSocketCreated = () => {}) {
  const { state, saveCreds } = await useMultiFileAuthState(config.whatsapp.authDir);
  const { version } = await fetchLatestBaileysVersion();

  const logger = pino({ level: config.logLevel === 'debug' ? 'debug' : 'silent' });

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false
  });
  onSocketCreated(sock);

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n======================================================');
      console.log('📱 SCAN THIS QR CODE WITH YOUR WHATSAPP PHONE APP');
      console.log('Open WhatsApp -> Linked Devices -> Link a Device');
      console.log('======================================================\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      console.log('\n✅ WhatsApp connection established successfully!');
      console.log('Bot is active and awaiting commands...\n');
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`⚠️ Connection closed. Status code: ${statusCode}. Reconnecting: ${shouldReconnect}`);

      if (shouldReconnect) {
        setTimeout(() => startWhatsAppClient(onMessageCallback, onSocketCreated), 3000);
      } else {
        console.error('❌ Logged out from WhatsApp. Delete auth_info_baileys/ and restart to re-pair.');
      }
    }
  });

  sock.ev.on('messages.upsert', async (event) => {
    if (event.type !== 'notify') return;

    for (const msg of event.messages) {
      // Ignore status updates, protocol messages, or messages from self
      if (!msg.message || msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') {
        continue;
      }

      try {
        await onMessageCallback(sock, msg);
      } catch (err) {
        console.error('Error handling WhatsApp message:', err);
      }
    }
  });

  return sock;
}
