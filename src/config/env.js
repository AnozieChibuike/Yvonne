import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

export function normalizePhoneNumber(phone) {
  return phone.replace(/\D/g, '');
}

const rawAllowed = process.env.ALLOWED_NUMBERS || '';
const allowedNumbers = rawAllowed
  .split(',')
  .map(num => normalizePhoneNumber(num.trim()))
  .filter(Boolean);

export const config = {
  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    transcriptionModel: process.env.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo'
  },
  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback',
    tokenPath: path.resolve(process.cwd(), 'token.json')
  },
  whatsapp: {
    authDir: path.resolve(process.cwd(), 'auth_info_baileys'),
    allowedNumbers
  },
  checkins: {
    timezone: process.env.CHECKIN_TIMEZONE || 'Africa/Lagos',
    morning: process.env.CHECKIN_MORNING || '07:00',
    daytime: process.env.CHECKIN_DAYTIME || '13:00',
    evening: process.env.CHECKIN_EVENING || '21:00'
  },
  logLevel: process.env.LOG_LEVEL || 'info'
};

export function isAllowedSender(jid) {
  if (!jid || config.whatsapp.allowedNumbers.length === 0) return false;
  const senderNumber = jid.split('@')[0].split(':')[0].replace(/\D/g, '');
  return config.whatsapp.allowedNumbers.includes(senderNumber);
}

export function validateAssistantConfig() {
  const missing = [];
  if (!config.groq.apiKey) missing.push('GROQ_API_KEY');
  if (!config.supabase.url) missing.push('SUPABASE_URL');
  if (!config.supabase.serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    return false;
  }

  if (config.whatsapp.allowedNumbers.length !== 1) {
    console.error('ALLOWED_NUMBERS must contain exactly one WhatsApp number.');
    return false;
  }

  try {
    new Intl.DateTimeFormat('en', { timeZone: config.checkins.timezone });
  } catch {
    console.error(`Invalid CHECKIN_TIMEZONE: ${config.checkins.timezone}`);
    return false;
  }

  for (const [name, time] of Object.entries({
    CHECKIN_MORNING: config.checkins.morning,
    CHECKIN_DAYTIME: config.checkins.daytime,
    CHECKIN_EVENING: config.checkins.evening
  })) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      console.error(`Invalid ${name}; expected a 24-hour time such as 07:00.`);
      return false;
    }
  }

  return true;
}

export function validateGoogleConfig() {
  const missing = [];
  if (!config.google.clientId) missing.push('GOOGLE_CLIENT_ID');
  if (!config.google.clientSecret) missing.push('GOOGLE_CLIENT_SECRET');

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    return false;
  }
  return true;
}
