/**
 * Service to generate a Figma-ready design specification from the Master UI Prompt and Manifest.
 */

import { getAnthropicModel, anthropicMessageText } from './anthropicResponse.js';

export async function generateFigmaSpec(client, designContext, platformType = 'anthropic') {
  console.log(`[FigmaDesignService] Generating Figma Component Specification with ${platformType}...`);

  // ... (FIGMA_SPEC_SYSTEM_PROMPT remains same)
  const FIGMA_SPEC_SYSTEM_PROMPT = `You are a Figma Component Architect. 
Your goal is to translate a detailed Master UI Prompt into a structured JSON design specification that a Figma plugin can use to build an editable layout.

### OUTPUT FORMAT:
Return ONLY a valid JSON object with this structure:
{
  "theme": {
    "mode": "Dark | Light",
    "primary": "hex",
    "secondary": "hex",
    "typography": { "heading": "font name", "body": "font name" }
  },
  "canvas": { "width": 1440, "padding": 80 },
  "sections": [
    {
      "name": "Section Name",
      "layout": "VERTICAL | HORIZONTAL | GRID",
      "backgroundColor": "hex",
      "elements": [
        { "type": "TEXT", "content": "verbatim text", "role": "H1 | H2 | BODY | LABEL", "fontSize": number, "fontWeight": "string" },
        { "type": "BUTTON", "label": "text", "style": "PRIMARY | SECONDARY" },
        { "type": "IMAGE", "placeholder": "description of image", "aspectRatio": "string" }
      ]
    }
  ]
}

### RULES:
1. VERBATIM CONTENT: Use the text provided in the Master Prompt word-for-word.
2. TECHNICAL: Define layout logic (vertical vs horizontal stacking).
3. ATOMIC: Break down each section into its constituent elements.
4. NO MARKDOWN: Return only the JSON object.`;

  const {
    businessName,
    primaryColor,
    secondaryColor,
    headingFont,
    bodyFont,
    websiteLayout,
    themeMode,
    generatedPrompt, // The Master UI Prompt
    structuredPrompt // The base AI analysis
  } = designContext;

  const userMessage = `Convert this Master UI Prompt into a Figma Plugin JSON specification.

BUSINESS: ${businessName}
BRAND: ${primaryColor}, ${secondaryColor}
LAYOUT: ${websiteLayout}
THEME: ${themeMode}

MASTER PROMPT:
${generatedPrompt}
`;

  try {
    let jsonStr = '';
    if (platformType === 'openai') {
      const completion = await client.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: FIGMA_SPEC_SYSTEM_PROMPT },
          { role: "user", content: userMessage }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" }
      });
      jsonStr = completion.choices[0].message.content.trim();
    } else {
      const completion = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        temperature: 0.1,
        system: FIGMA_SPEC_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }]
      });
      jsonStr = anthropicMessageText(completion);
    }
    
    // Clean JSON
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const lastBrace = jsonStr.lastIndexOf('}');
    if (lastBrace !== -1) jsonStr = jsonStr.slice(0, lastBrace + 1);

    return JSON.parse(jsonStr);
  } catch (err) {
    console.error('[FigmaDesignService] Error:', err);
    // Fallback to a simplified structure if AI fails
    return {
      error: 'Failed to generate granular spec',
      theme: { mode: themeMode, primary: primaryColor },
      sections: (structuredPrompt.sections_detected || []).map(s => ({ name: s, elements: [] }))
    };
  }
}
