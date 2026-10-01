export default function handler(_request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.status(200).json({
    ok: true,
    model: 'gpt-realtime-2.1',
    apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
    accessCodeConfigured: Boolean(process.env.POC_ACCESS_CODE)
  });
}
