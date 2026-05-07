import { GoogleGenerativeAI } from '@google/generative-ai';

class GeminiService {
  constructor() {
    this.model = null;
    if (process.env.GEMINI_API_KEY) {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      this.model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    }
  }

  async generateReply(email, settings = {}, customInstructions = '') {
    if (!this.model) throw new Error('Gemini API key not configured');
    const { user_name, user_role, user_company, reply_tone, reply_signature } = settings;

    const prompt = `You are an AI email assistant composing a reply on behalf of ${user_name || 'the user'}${user_role ? `, who is a ${user_role}` : ''}${user_company ? ` at ${user_company}` : ''}.

INSTRUCTIONS:
- Write a ${reply_tone || 'professional'} reply to the email below
- Be helpful, concise, and contextually appropriate
- Do NOT include the subject line in your reply
- End with "${reply_signature || 'Best regards'},\n${user_name || 'User'}"
- Output ONLY the reply text, no meta-commentary
${customInstructions ? `- Additional: ${customInstructions}` : ''}

ORIGINAL EMAIL:
From: ${email.from_name || email.from?.name} <${email.from_email || email.from?.email}>
Subject: ${email.subject}
Date: ${email.received_at || email.receivedAt}

${email.body_text || email.bodyText || email.snippet}

YOUR REPLY:`;

    const result = await this.model.generateContent(prompt);
    return result.response.text().trim();
  }

  async categorizeEmail(email) {
    if (!this.model) throw new Error('Gemini API key not configured');
    const prompt = `Categorize this email into ONE of: support, inquiry, personal, newsletter, notification, spam, other.

From: ${email.from_name || email.from?.name} <${email.from_email || email.from?.email}>
Subject: ${email.subject}
Body: ${(email.body_text || email.bodyText || email.snippet || '').substring(0, 500)}

Respond with ONLY the category name, nothing else.`;

    const result = await this.model.generateContent(prompt);
    return result.response.text().trim().toLowerCase();
  }
}

export const geminiService = new GeminiService();
