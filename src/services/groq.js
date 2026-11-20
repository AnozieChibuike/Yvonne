import Groq, { toFile } from 'groq-sdk';
import { config } from '../config/env.js';

export function createGroqClient() {
  return new Groq({ apiKey: config.groq.apiKey });
}

export async function transcribeVoiceNote(groq, audioBuffer, contentType = 'audio/ogg') {
  const file = await toFile(audioBuffer, 'voice-note.ogg', { type: contentType });
  const transcription = await groq.audio.transcriptions.create({
    file,
    model: config.groq.transcriptionModel,
    response_format: 'json'
  });
  const text = transcription.text?.trim();
  if (!text) throw new Error('Groq returned an empty voice transcription.');
  return text;
}
