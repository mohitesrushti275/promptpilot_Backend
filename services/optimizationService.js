import { generateHash, getContentSummaryFromCache, setContentSummaryToCache } from './cacheService.js';
import { anthropicMessageText } from './anthropicResponse.js';

/**
 * Summarizes large content for context-only AI processing.
 */
export async function summarizeContent(client, content, platformType = 'anthropic') {
  if (!content || content.trim().length < 200) return content;

  const contentHash = generateHash(content);
  const cached = getContentSummaryFromCache(contentHash);
  if (cached) {
    console.log('[OptimizationService] Using cached content summary.');
    return cached;
  }

  console.log('[OptimizationService] Summarizing large content source...');
  
  const systemPrompt = "You are an expert content analyzer. Create a comprehensive, technical design brief from the following text. Capture all key entities, value propositions, features, and specific data points in detail. Focus on providing every technical detail needed to build a UI around this content.";
  
  let summary = '';
  if (platformType === 'openai') {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini", // Use faster/cheaper model for summarization
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Please provide a detailed technical summary of this content for a UI designer:\n\n${content}` }
      ],
      max_tokens: 4096,
    });
    summary = completion.choices[0].message.content;
  } else {
    const completion = await client.messages.create({
      model: 'claude-3-haiku-20240307', // Use faster/cheaper model for summarization
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Please provide a detailed technical summary of this content for a UI designer:\n\n${content}` }]
    });
    summary = anthropicMessageText(completion);
  }

  setContentSummaryToCache(contentHash, summary);
  return summary;
}

/**
 * Cleans and optimizes the payload for the final prompt generation.
 */
export function optimizePayload(data) {
  // Remove binary data or large base64 strings if present in the main context
  // but ensure we keep the necessary metadata.
  const optimized = {
    businessName: data.businessName,
    primaryColor: data.primaryColor,
    secondaryColor: data.secondaryColor,
    headingFont: data.headingFont,
    bodyFont: data.bodyFont,
    websiteLayout: data.websiteLayout,
    themeMode: data.themeMode,
    sections: data.sections || [],
    sectionOrder: data.sectionOrder || [],
    referenceUrl: data.referenceUrl,
    // Add multiple references style summaries if available
    multipleReferences: (Array.isArray(data.multipleAnalyses) ? data.multipleAnalyses : []).map(ref => ({
      url: ref.url,
      style: ref.style,
      layout: ref.layout,
      description: ref.description,
      human_readable_prompt: ref.human_readable_prompt
    })),
    // Add custom sections notes
    clientResourcesSections: (Array.isArray(data.clientResourcesSections) ? data.clientResourcesSections : []).map(sec => ({
      type: sec.type,
      description: sec.description,
      style: sec.style,
      layout: sec.layout,
      human_readable_prompt: sec.human_readable_prompt
    }))
  };


  return optimized;
}
