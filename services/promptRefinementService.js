/**
 * Service to refine a base design analysis into a final Master UI Prompt.
 */

import { getAnthropicModel, anthropicMessageText } from './anthropicResponse.js';

/**
 * Helper to check if the generated prompt preserves the core of the input content.
 * We check if the start, middle, and end of the content are present to detect summarization/truncation.
 */
function validateContentFidelity(inputContent, generatedPrompt) {
  if (!inputContent || inputContent.trim().length < 50) return true;
  
  const cleanInput = inputContent.trim().toLowerCase().replace(/\s+/g, ' ');
  const cleanOutput = generatedPrompt.trim().toLowerCase().replace(/\s+/g, ' ');

  // Sampling 3 points for a robust check
  const startMarker = cleanInput.substring(0, 40);
  const midMarker = cleanInput.substring(Math.floor(cleanInput.length / 2), Math.floor(cleanInput.length / 2) + 40);
  const endMarker = cleanInput.substring(cleanInput.length - 40);

  const hasStart = cleanOutput.includes(startMarker);
  const hasMid = cleanOutput.includes(midMarker);
  const hasEnd = cleanOutput.includes(endMarker);

  if (!hasStart || !hasMid || !hasEnd) {
    console.warn(`[Refinement Check] Failed markers: Start=${hasStart}, Mid=${hasMid}, End=${hasEnd}`);
    console.warn(`[Refinement Check] Output Length: ${generatedPrompt.length} vs Input Length: ${inputContent.length}`);
  }

  return hasStart && hasMid && hasEnd;
}

export async function refinePrompt(client, manifestContext, platformType = 'anthropic') {
  console.log(`[PromptRefinementService] Refining Master UI Prompt with ${platformType}...`);

  const {
    businessName,
    primaryColor,
    secondaryColor,
    headingFont,
    bodyFont,
    websiteLayout,
    sections,
    sectionOrder,
    themeMode,
    structuredPrompt, // from AI analysis
    referenceUrl,
    multipleReferences,
    clientResourcesSections,
    contentSource,
    contentSummary
  } = manifestContext;

  const refinementSystemPrompt = `You are a Senior Design Director and Expert UI Prompt Engineer.
Your goal is to generate a concise, complete, and STATIC Master UI Prompt.

### MANDATORY OUTPUT STRUCTURE:
Your response must follow this EXACT Markdown structure:

# Homepage Design Prompt

## Project Overview
- Business Name: [Name]
- Website Layout: [Layout]
- Theme Mode: [Theme] Mode
- Brand Colors: Primary ([Color]), Secondary ([Color])
- Fonts: Heading ([Font]), Body ([Font])
- Overall Goal: [Brief summary of the design intent]

## Reference Direction
- For each reference URL provided, list its specific notes and design direction.
- Combine the visual style, layout patterns, and aesthetic cues from all references into a single cohesive direction.

## Content Source
- Specify if "UPLOADED CONTENT" (from the [VERBATIM CONTENT REPOSITORY]) should be used or if "REALISTIC DUMMY CONTENT" should be generated.

## Sections
For EVERY section added by the user:
1. Section Name & Type
2. Combined Design Notes: Merge the specific section notes with relevant reference website notes intelligently.
3. Content Direction: What specific text/data from the content source belongs here.
4. Visual Direction: Layout, hierarchy, and component style.

## Static Design Rules
- Use the reference website’s look and feel.
- Use provided brand colors and fonts.
- Keep layout consistent across all sections.
- NO ANIMATIONS: Do not include page load animations, scroll animations, motion effects, transition systems, stagger animations, moving elements, animated skeletons, animated loaders, or micro-interactions.
- NO HOVER EFFECTS: Do not include button hover states, card hover states, image hover effects, link hover effects, hover shadows, hover transitions, or any interaction-based styling. The design must be 100% STATIC.
- NO FILLER: Do not generate design system token maps, typography scale tables, spacing systems, or over-detailed CSS specifications.

## Final Output
- Create a complete static homepage specification using all provided inputs.

### ZERO-TOLERANCE RULES:
1. NO TRUNCATION: You must include EVERY section provided in the input. Do not omit any detail, section name, or note.
2. NO ANIMATIONS: The word "animation", "motion", "transition", or "interactivity" should not appear in a way that suggests moving elements.
3. NO HOVER EFFECTS: Explicitly avoid any "on hover" or "hover state" instructions.
4. BE CONCISE: Use direct, high-impact technical language. Avoid boilerplate filler.`;

  let multipleReferencesText = '';
  if (multipleReferences && multipleReferences.length > 0) {
    multipleReferencesText = '\nREFERENCE WEBSITES & NOTES:\n';
    multipleReferences.forEach((ref, index) => {
      multipleReferencesText += `--- Reference ${index + 1}: ${ref.url} ---\nNote: "${ref.description || 'Follow this style'}"\nDetected Style: ${ref.style || 'N/A'}\nImage Analysis: ${ref.human_readable_prompt || 'N/A'}\n`;
    });
  }

  let customSectionsText = '';
  if (clientResourcesSections && clientResourcesSections.length > 0) {
    customSectionsText = '\nSECTIONS TO INCLUDE (WITH SPECIFIC NOTES):\n';
    clientResourcesSections.forEach((sec, idx) => {
      customSectionsText += `Section ${idx + 1}: ${sec.type}\n- Note: "${sec.description || 'N/A'}"\n- Image Analysis Intelligence: ${sec.human_readable_prompt || 'Follow global style'}\n`;
    });
  }


  const userMessage = `Generate the Master UI Prompt based on these inputs:

BUSINESS: ${businessName || 'N/A'}
LAYOUT: ${websiteLayout || 'N/A'}
THEME: ${themeMode || 'Dark'}
COLORS: Primary (${primaryColor}), Secondary (${secondaryColor})
FONTS: Heading (${headingFont}), Body (${bodyFont})

${customSectionsText}
${multipleReferencesText}

CONTENT SUMMARY (USE FOR MERGING SECTION NOTES):
${contentSummary || 'No specific content provided. Use realistic professional dummy copy.'}

INSTRUCTIONS:
1. Merge section notes, reference notes, and uploaded content intelligence intelligently.
2. Ensure ALL sections listed above are present in the output. DO NOT TRUNCATE.
3. Maintain a strictly STATIC design focus—NO ANIMATIONS, NO HOVER EFFECTS.
4. Follow the MANDATORY OUTPUT STRUCTURE exactly.`;

  let finalPrompt = '';
  
  if (platformType === 'openai') {
    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: refinementSystemPrompt },
        { role: "user", content: userMessage }
      ],
      temperature: 0.3,
      max_tokens: 4096,
    });
    finalPrompt = completion.choices[0].message.content.trim();
  } else {
    const completion = await client.messages.create({
      model: getAnthropicModel(),
      max_tokens: 8192,
      temperature: 0.3,
      system: refinementSystemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    });
    finalPrompt = anthropicMessageText(completion);
  }

  if (contentSource && contentSource.trim().length > 0) {
    finalPrompt += `\n\n---
[VERBATIM CONTENT REPOSITORY]
${contentSource}
---
*Note: Use the verbatim text from this repository for all specific section copy.*`;
  }

  return finalPrompt;
}

