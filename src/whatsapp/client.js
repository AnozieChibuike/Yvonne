import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { config, isAllowedSender } from '../config/env.js';

const OUTGOING_MESSAGE_TTL_MS = 60_000;

function normalizeJid(jid) {
  if (!jid) return null;
  const [identifier, server] = jid.split('@');
  if (!identifier || !server) return null;
  return `${identifier.split(':')[0].replace(/\D/g, '')}@${server.toLowerCase()}`;
}

export function isAuthorizedSelfChat(sock, msg) {
  const remoteJid = msg.key.remoteJid;
  if (!remoteJid || remoteJid.includes('@g.us') || !isAllowedSender(remoteJid)) return false;

  const remoteUser = normalizeJid(remoteJid);
  const ownJids = [sock.user?.id, sock.user?.jid, sock.user?.lid]
    .map(normalizeJid)
    .filter(Boolean);
  return ownJids.includes(remoteUser);
}

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
  const outgoingMessageIds = new Map();
  const sendMessage = sock.sendMessage.bind(sock);
  sock.sendMessage = async (...args) => {
    const sentMessage = await sendMessage(...args);
    if (sentMessage?.key?.id) {
      const now = Date.now();
      for (const [id, expiresAt] of outgoingMessageIds) {
        if (expiresAt <= now) outgoingMessageIds.delete(id);
      }
      outgoingMessageIds.set(sentMessage.key.id, now + OUTGOING_MESSAGE_TTL_MS);
    }
    return sentMessage;
  };
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
      if (!msg.message || msg.key.remoteJid === 'status@broadcast') {
        continue;
      }

      if (msg.key.fromMe) {
        if (outgoingMessageIds.has(msg.key.id)) {
          outgoingMessageIds.delete(msg.key.id);
          continue;
        }
        if (!isAuthorizedSelfChat(sock, msg)) continue;

        await new Promise(resolve => setTimeout(resolve, 100));
        if (outgoingMessageIds.has(msg.key.id)) {
          outgoingMessageIds.delete(msg.key.id);
          continue;
        }
        console.log('Received an authorized self-chat message; forwarding it to Yvonne.');
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
