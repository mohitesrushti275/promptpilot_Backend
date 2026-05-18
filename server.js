import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)), override: true });
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import sharp from 'sharp';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

import { captureScreenshot, extractWebsiteMetadataAndScreenshot } from './services/screenshotService.js';
import { optimizeScreenshot, analyzeUI_Image } from './services/imageToPromptService.js';
import { determineSections } from './services/sectionDetectionService.js';
import { saveManifest, getManifest } from './services/designManifestService.js';
import { refinePrompt } from './services/promptRefinementService.js';
import { transformToDeveloperSpec } from './services/transformerService.js';
import { extractTextFromBuffer } from './services/textExtractionService.js';
import { generateFigmaSpec } from './services/figmaDesignService.js';
import {
  generateHash,
  getPromptFromCache,
  setPromptToCache,
  getAnalysisFromCache,
  setAnalysisToCache
} from './services/cacheService.js';
import { summarizeContent, optimizePayload } from './services/optimizationService.js';
import { getAnthropicModel, anthropicMessageText } from './services/anthropicResponse.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

// ── Persistence Layer ────────────────────────────────────────────────────────
const DATA_FILE = path.join(__dirname, 'data.json');

function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return { components: [], figmaExports: [] };
    }
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!parsed.figmaExports) parsed.figmaExports = [];
    return parsed;
  } catch (err) {
    console.error('[DB] Error reading data:', err);
    return { components: [], figmaExports: [] };
  }
}

function writeData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[DB] Error writing data:', err);
  }
}

// ── API Clients ─────────────────────────────────────────────────────────────
const anthropicKey = (process.env.ANTHROPIC_API_KEY || '').trim();
if (!anthropicKey) {
  console.error('[FATAL] ANTHROPIC_API_KEY is missing.');
}

const openAIKey = (process.env.OPENAI_API_KEY || '').trim();
if (!openAIKey) {
  console.warn('[WARN] OPENAI_API_KEY is missing. OpenAI features will be unavailable.');
}

// Security-safe diagnostic logging
console.log(`[AUTH] Anthropic Key Loaded | Length: ${anthropicKey.length}`);
console.log(`[AUTH] OpenAI Key Loaded | Length: ${openAIKey.length}`);

let anthropicSingleton = null;
let anthropicCachedKey = '';

/** Lazily build Anthropic client so env injected after startup still works on first request. */
function getAnthropicInstance() {
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) return null;
  if (!anthropicSingleton || key !== anthropicCachedKey) {
    anthropicSingleton = new Anthropic({ apiKey: key });
    anthropicCachedKey = key;
  }
  return anthropicSingleton;
}

const openai = openAIKey ? new OpenAI({ apiKey: openAIKey }) : null;

// ── Middleware ───────────────────────────────────────────────────────────────
// ── Middleware ───────────────────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'https://ai-project-nu-three.vercel.app',
  'https://app.promptpilot.sharehq.org',
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    const isDev = (process.env.NODE_ENV || 'development') !== 'production';
    if (isDev) {
      try {
        const url = new URL(origin);
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
          return callback(null, true);
        }
      } catch {
        // If origin is malformed, fall through to allowlist check.
      }
    }
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Serve uploaded images
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));



// ── AI Helper ──────────────────────────────────────────────────────────────
function getAIClient(platformKey) {
  const normalizedKey = (platformKey || 'Anthropic').trim();
  if (normalizedKey === 'Open AI') {
    if (!openai) throw new Error('OpenAI client not initialized. Please check your OPENAI_API_KEY in .env');
    return { client: openai, type: 'openai' };
  }
  // Default to Anthropic
  const anthropicClient = getAnthropicInstance();
  if (!anthropicClient) {
    throw new Error('Anthropic client not initialized. Please check your ANTHROPIC_API_KEY in .env');
  }
  return { client: anthropicClient, type: 'anthropic' };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── COMPONENT CRUD ───────────────────────────────────────────────────────────
app.get('/api/components', (req, res) => {
  const data = readData();
  res.json(data.components);
});

app.post('/api/components', (req, res) => {
  const { name, count } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const data = readData();
  const newComponent = {
    id: Date.now().toString(),
    name,
    count: count || 0,
    subsections: []
  };
  data.components.push(newComponent);
  writeData(data);
  res.json(newComponent);
});

app.put('/api/components/:id', (req, res) => {
  const { id } = req.params;
  const { name, count } = req.body;
  const data = readData();
  const index = data.components.findIndex(c => c.id === id);
  if (index === -1) return res.status(404).json({ error: 'Component not found' });

  const oldName = data.components[index].name;
  const newName = name || oldName;

  data.components[index] = {
    ...data.components[index],
    name: newName,
    count: count !== undefined ? count : data.components[index].count
  };

  // Propagate name change to subsections
  if (newName !== oldName) {
    data.components[index].subsections.forEach(s => {
      s.category = newName;
    });
  }

  writeData(data);
  res.json(data.components[index]);
});

app.delete('/api/components/:id', (req, res) => {
  const { id } = req.params;
  const data = readData();
  data.components = data.components.filter(c => c.id !== id);
  writeData(data);
  res.json({ success: true });
});

// ── SUBSECTION CRUD ──────────────────────────────────────────────────────────
app.get('/api/components/:id/subsections', (req, res) => {
  const { id } = req.params;
  const data = readData();
  const comp = data.components.find(c => c.id === id);
  if (!comp) return res.status(404).json({ error: 'Component not found' });
  res.json(comp.subsections);
});

app.get('/api/subsections/:id', (req, res) => {
  const { id } = req.params;
  const data = readData();
  for (let comp of data.components) {
    const section = comp.subsections.find(s => s.id === id);
    if (section) return res.json(section);
  }
  res.status(404).json({ error: 'Subsection not found' });
});

/** Helper to save uploaded file buffer to disk */
const saveUploadedFile = (file) => {
  if (!file) return '';
  const ext = path.extname(file.originalname) || '.webp';
  const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`;
  const filePath = path.join(__dirname, 'uploads', fileName);
  fs.writeFileSync(filePath, file.buffer);
  return `/uploads/${fileName}`;
};

app.post('/api/components/:id/subsections', upload.single('image'), (req, res) => {
  const { id } = req.params;
  const { title, prompt, code, figmaUrl } = req.body;
  let image = req.body.image || ''; // Could be an existing URL string

  if (req.file) {
    image = saveUploadedFile(req.file);
  }

  const data = readData();
  const index = data.components.findIndex(c => c.id === id);
  if (index === -1) return res.status(404).json({ error: 'Component not found' });

  const newSection = {
    id: Date.now().toString(),
    title: title || '',
    prompt: prompt || '',
    code: code || '',
    image: image || '',
    figmaUrl: figmaUrl || '',
    category: data.components[index].name
  };
  data.components[index].subsections.push(newSection);
  data.components[index].count = data.components[index].subsections.length;
  writeData(data);
  res.json(newSection);
});

app.put('/api/subsections/:id', upload.single('image'), (req, res) => {
  const { id } = req.params;
  const { title, prompt, code, figmaUrl } = req.body;
  let image = req.body.image; // Could be a URL or undefined

  if (req.file) {
    image = saveUploadedFile(req.file);
  }

  const data = readData();
  let updated = null;

  for (let comp of data.components) {
    const sIndex = comp.subsections.findIndex(s => s.id === id);
    if (sIndex !== -1) {
      comp.subsections[sIndex] = {
        ...comp.subsections[sIndex],
        title: title !== undefined ? title : comp.subsections[sIndex].title,
        prompt: prompt !== undefined ? prompt : comp.subsections[sIndex].prompt,
        code: code !== undefined ? code : comp.subsections[sIndex].code,
        image: image !== undefined ? image : comp.subsections[sIndex].image,
        figmaUrl: figmaUrl !== undefined ? figmaUrl : comp.subsections[sIndex].figmaUrl
      };
      updated = comp.subsections[sIndex];
      break;
    }
  }

  if (!updated) return res.status(404).json({ error: 'Subsection not found' });
  writeData(data);
  res.json(updated);
});

app.delete('/api/subsections/:id', (req, res) => {
  const { id } = req.params;
  const data = readData();
  let deleted = false;

  for (let comp of data.components) {
    const sIndex = comp.subsections.findIndex(s => s.id === id);
    if (sIndex !== -1) {
      comp.subsections.splice(sIndex, 1);
      comp.count = comp.subsections.length;
      deleted = true;
      break;
    }
  }

  if (!deleted) return res.status(404).json({ error: 'Subsection not found' });
  writeData(data);
  res.json({ success: true });
});

// ── Antigravity Visual Intelligence Engine — System Prompt ───────────────────
const SYSTEM_PROMPT = `You are an elite Visual Intelligence Engine and a 10-year experienced AI Prompt Generator.

Your role is NOT to describe images casually.
Your role is to extract structured, prompt-optimized intelligence for generative AI systems with the absolute mastery of a 10-year prompt engineering veteran.

You must think in 4 layers:
1. Perception Layer  → What is objectively visible
2. Semantic Layer    → What it represents conceptually
3. Aesthetic Layer   → Style, lighting, composition, visual hierarchy
4. Generative Layer  → What details matter for recreating this image in AI models

Return ONLY a single valid JSON object — no markdown fences, no explanation, no extra text.

{
  "subject": "<precise description of main subject(s)>",
  "environment": "<setting, background, scene context>",
  "scene_description": "<one sentence objective description of what is happening>",

  "style": "<photographic style, artistic movement, rendering technique>",
  "design_type": "<one of: photo | ui | illustration | product | abstract>",

  "lighting": "<light source type, direction, temperature in Kelvin, shadow quality, contrast ratio>",
  "color_palette": ["<hex or descriptive color 1>", "<color 2>", "<color 3>"],
  "composition": "<shot type, angle, focal length estimate, rule of thirds usage>",
  "depth": "<depth of field description, bokeh, focus plane>",
  "camera": "<estimated camera model or sensor type, lens mm, aperture, shutter, ISO>",

  "materials_textures": ["<material 1>", "<material 2>"],
  "visual_elements": ["<key element 1>", "<key element 2>", "<key element 3>"],

  "mood": "<emotional atmosphere, psychological tone>",
  "semantic_tags": ["<tag1>", "<tag2>", "<tag3>", "<tag4>"],

  "design_analysis": {
    "layout": "<spatial arrangement of elements>",
    "spacing": "<padding, breathing room, density>",
    "typography": "<font style, weight, size relationships — or N/A>",
    "hierarchy": "<visual flow — what the eye reads first, second, third>",
    "ui_pattern": "<UI component patterns detected — or N/A>"
  },

  "reconstruction_instructions": {
    "priority_elements": ["<element critical to faithful recreation>", "<element 2>"],
    "avoid": ["<what NOT to generate>"],
    "enhancement_suggestions": ["<optional improvement>"]
  },

  "dalle3_prompt": "<A massive, extensively detailed, and fully described DALL-E 3 master prompt that flawlessly reconstructs the image. Leave no stone unturned. You must elaborate on the primary subject, subtle background intricacies, precise spatial geometry, rich atmospheric details, exact color grading codes, high-end photographic or artistic lighting parameters, micro-textures, and emotional resonance. Describe EVERYTHING in long, flowing, highly descriptive paragraphs. This prompt MUST be longer than 1200 characters in length. Format as a single continuous string. DO NOT use literal newlines, use \\n for line breaks.>"
}

RULES:
- Be precise, not poetic
- No generic phrases like "beautiful image"
- Always include camera + lighting logic
- If UI detected → prioritize layout, spacing, hierarchy
- If photo → prioritize realism, lens, lighting physics
- YOU MUST ANALYZE THE FULL IMAGE. Check the foreground, midground, and deep background.
- If unclear → make best logical inference`;

// ── POST /api/analyze ────────────────────────────────────────────────────────
app.post('/api/analyze', (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      console.error('[Multer Error]', err.message);
      return res.status(500).json({ error: 'File upload failed: ' + err.message });
    }
    next();
  });
}, async (req, res) => {
  const t0 = Date.now();

  try {
    // ── Layer 1: Validate input ──────────────────────────────────────────────
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided.' });
    }

    console.log(`[Layer 1 ✓] Received file: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)} KB)`);

    // ── Layer 2: Image processing (Sharp) ────────────────────────────────────
    console.log('[Layer 2]  Processing image with Sharp...');
    const processedBuffer = await sharp(req.file.buffer)
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();

    const base64Image = processedBuffer.toString('base64');
    console.log(`[Layer 2 ✓] Optimized: ${req.file.size} → ${processedBuffer.length} bytes`);

    // ── Layer 3: Visual Intelligence Engine (Anthropic) ───────────
    console.log('[Layer 3]  Running Antigravity Visual Intelligence Engine (Claude 3.5 Sonnet)...');

    const { client: anthropicClient } = getAIClient('Anthropic');
    if (typeof anthropicClient?.messages?.create !== 'function') {
      throw new Error(
        'Anthropic SDK client is unusable (missing messages API). Reinstall @anthropic-ai/sdk or check Node resolution.'
      );
    }
    const completion = await anthropicClient.messages.create({
      model: getAnthropicModel(),
      max_tokens: 8192,
      temperature: 0.2,
      system: SYSTEM_PROMPT + '\n\nCRITICAL: Your response must be a single valid JSON object ONLY. No preamble, no explanation, no markdown, no trailing text. Start your response with { and end with }.',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Run a deep, comprehensive 4-layer analysis on this ENTIRE image. Scan from foreground to background. Extract every distinct visual detail, subject, and environmental context with unyielding precision. Your output must contain the exact structured intelligence required to generate a flawless, identical 1:1 replica of this image.'
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: base64Image,
              }
            }
          ]
        }
      ]
    });

    console.log(`[Layer 3 ✓] Intelligence Engine responded via Anthropic`);
    const rawContent = anthropicMessageText(completion);
    const tokensUsed = (completion.usage?.input_tokens || 0) + (completion.usage?.output_tokens || 0);

    console.log('[Layer 4]  Raw response preview:', rawContent.slice(0, 200));

    // Multi-strategy JSON extraction: handles markdown fences, leading text, etc.
    let jsonStr = rawContent;

    // Strategy 1: Strip markdown code fences
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

    // Strategy 3: Ensure JSON is not truncated — find the last closing brace
    const lastBrace = jsonStr.lastIndexOf('}');
    if (lastBrace !== -1 && lastBrace < jsonStr.length - 1) {
      jsonStr = jsonStr.slice(0, lastBrace + 1);
    }

    // Strategy 2: If still not starting with {, extract the first {...} block
    if (!jsonStr.startsWith('{')) {
      const match = rawContent.match(/\{[\s\S]*\}/);
      if (match) {
        jsonStr = match[0];
      }
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error('[Layer 4 ✗] JSON parse failed. Raw response:\n', rawContent.slice(0, 600));
      return res.status(500).json({ error: 'AI returned malformed JSON. Please try again.' });
    }

    if (!parsed.dalle3_prompt) {
      console.error('[Layer 4 ✗] Missing dalle3_prompt in intelligence output');
      return res.status(500).json({ error: 'Intelligence Engine did not return a prompt. Please try again.' });
    }

    console.log(`[Layer 4 ✓] Intelligence extracted. Design type: ${parsed.design_type}`);

    // ── Layer 5: Return ──────────────────────────────────────────────────────
    const latency = Date.now() - t0;
    console.log(`[Pipeline ✓] Complete in ${latency}ms`);

    return res.status(200).json({
      metadata: {
        originalBytes: req.file.size,
        optimizedBytes: processedBuffer.length,
        latencyMs: latency,
        tokensUsed: tokensUsed,
      },
      intelligence: {
        subject: parsed.subject,
        environment: parsed.environment,
        style: parsed.style,
        design_type: parsed.design_type,
        lighting: parsed.lighting,
        color_palette: parsed.color_palette,
        composition: parsed.composition,
        depth: parsed.depth,
        camera: parsed.camera,
        mood: parsed.mood,
        semantic_tags: parsed.semantic_tags,
        materials_textures: parsed.materials_textures,
        visual_elements: parsed.visual_elements,
        design_analysis: parsed.design_analysis,
        reconstruction_instructions: parsed.reconstruction_instructions,
      },
      prompts: { 'DALL-E 3': parsed.dalle3_prompt },
    });

  } catch (error) {
    console.error('[Pipeline ✗] Fatal error:', error?.message || error);
    if (error?.stack) console.error('[Pipeline ✗] Stack:', error.stack);

    // Friendly error messages
    if (error?.status === 401) {
      return res.status(401).json({ error: `Invalid API key. Please check your .env file.` });
    }
    if (error?.status === 403) {
      return res.status(403).json({ error: `Access Denied (403). Your key may not have access.` });
    }
    if (error?.status === 429) return res.status(429).json({ error: 'Rate limit or quota hit. Please check your billing status.' });
    if (error?.status >= 400 && error?.status < 500) return res.status(error.status).json({ error: `API error: ${error.message}` });

    return res.status(500).json({ error: 'Pipeline failed: ' + (error?.message || 'Unknown error') });
  }
});

app.post('/api/generate-manifest', async (req, res) => {
  try {
    const {
      businessName, primaryColor, secondaryColor, headingFont, bodyFont,
      websiteLayout, sectionType, referenceUrls, contentSource, sectionOrder,
      themeMode, platformKey
    } = req.body;

    const { client, type: platformType } = getAIClient(platformKey);

    console.log(`[Manifest] Generating architecture for ${businessName || 'A Modern Business'} in ${themeMode} mode using ${platformType}...`);

    const referencesText = referenceUrls && referenceUrls.length > 0
      ? `\nReference Websites for Design Inspiration: ${referenceUrls.join(', ')}`
      : '';

    const contentContext = contentSource ? `\n\n### ATTACHED CONTENT SOURCE (USE VERBATIM):\n${contentSource}\n\n` : '';

    let promptResult = '';
    if (platformType === 'openai') {
      const completion = await client.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are an elite Digital Architect and AI Prompt Engineer. Your task is to generate a comprehensive 'Website Generation Master Prompt'.\n\nGoal: Create a technical Master Prompt that includes a direct reference to the source material.\n\nCRITICAL INSTRUCTIONS:\n1. REFERENCE THE ATTACHMENT: Your technical instructions should explicitly tell the downstream AI to look at the '### ATTACHED CONTENT REFERENCE' section at the end of the prompt for specific copy and data.\n2. SECTION ARCHITECTURE: Map the User's selected Section Order to the design tokens provided (colors, fonts).\n3. CONTENT APPENDING: At the absolute end of your response, after your technical instructions, provide a divider '---' followed by a section titled '### ATTACHED CONTENT REFERENCE'. Inside this section, you MUST INCLUDE the core data and relevant text from the user's uploaded document. Do not omit this section.\n4. INTEGRITY: Ensure the technical instructions and the attached reference are delivered as a single, unified text package.\n5. THEME ADHERENCE: Strictly follow the user's requested Visual Theme mode (Dark or Light)." },
          { role: "user", content: `Generate a technical, inspiration-rich Master Prompt (approx 500-800 words) that describes how to build this specific website based on the following:\n\nBusiness Name: ${businessName || 'A Modern Business'}\nWebsite Category: ${websiteLayout}\nVisual Theme: ${themeMode} Mode\nDetailed Section Order: ${sectionOrder || sectionType}\nBrand Palette: Primary (${primaryColor}), Secondary (${secondaryColor})\nTypography: Headings (${headingFont}), Body (${bodyFont})${referencesText}${contentContext}\n\nREQUIREMENTS:\n1. Technical architectural instructions for a developer AI.\n2. Ensure the design system (backgrounds, text contrast, component variants) strictly reflects the **${themeMode} Mode** request.\n3. At the very end of your response, after a divider line '---', append a section titled '### ATTACHED CONTENT REFERENCE' containing the filtered, relevant data from the source material.\n4. The instructions MUST explicitly tell the developer to look at the '### ATTACHED CONTENT REFERENCE' section for all specific copy.` }
        ],
        temperature: 0.7,
        max_tokens: 4096
      });
      promptResult = completion.choices[0].message.content;
    } else {
      const completion = await client.messages.create({
        model: getAnthropicModel(),
        max_tokens: 8192,
        temperature: 0.7,
        system: `You are an elite Digital Architect and AI Prompt Engineer. Your task is to generate a comprehensive "Website Generation Master Prompt".
        
  Goal: Create a technical Master Prompt that includes a direct reference to the source material.
  
  CRITICAL INSTRUCTIONS:
  1. REFERENCE THE ATTACHMENT: Your technical instructions should explicitly tell the downstream AI to look at the "### ATTACHED CONTENT REFERENCE" section at the end of the prompt for specific copy and data.
  2. SECTION ARCHITECTURE: Map the User's selected Section Order to the design tokens provided (colors, fonts).
  3. CONTENT APPENDING: At the absolute end of your response, after your technical instructions, provide a divider '---' followed by a section titled '### ATTACHED CONTENT REFERENCE'. Inside this section, you MUST INCLUDE the core data and relevant text from the user's uploaded document. Do not omit this section.
  4. INTEGRITY: Ensure the technical instructions and the attached reference are delivered as a single, unified text package.
  5. THEME ADHERENCE: Strictly follow the user's requested Visual Theme mode (Dark or Light).`,
        messages: [
          {
            role: 'user',
            content: `Generate a technical, inspiration-rich Master Prompt (approx 500-800 words) that describes how to build this specific website based on the following:
            
  Business Name: ${businessName || 'A Modern Business'}
  Website Category: ${websiteLayout}
  Visual Theme: ${themeMode} Mode
  Detailed Section Order: ${sectionOrder || sectionType}
  Brand Palette: Primary (${primaryColor}), Secondary (${secondaryColor})
  Typography: Headings (${headingFont}), Body (${bodyFont})${referencesText}${contentContext}
  
  REQUIREMENTS:
  1. Technical architectural instructions for a developer AI.
  2. Ensure the design system (backgrounds, text contrast, component variants) strictly reflects the **${themeMode} Mode** request.
  3. At the very end of your response, after a divider line '---', append a section titled '### ATTACHED CONTENT REFERENCE' containing the filtered, relevant data from the source material.
  4. The instructions MUST explicitly tell the developer to look at the '### ATTACHED CONTENT REFERENCE' section for all specific copy.`
          }
        ]
      });
      promptResult = anthropicMessageText(completion);
    }

    res.json({
      prompt: promptResult.trim(),
      sourceMaterial: contentSource || ''
    });
  } catch (error) {
    console.error('[Manifest ✗] Error generating prompt:', error?.message || error);
    res.status(500).json({ error: error?.message || 'Failed to generate prompt' });
  }
});

app.post('/api/design-manifest/reference-to-prompt', async (req, res) => {
  try {
    const {
      referenceUrl, sections, businessName, primaryColor, secondaryColor,
      headingFont, bodyFont, websiteLayout, themeMode, sectionOrder, platformKey
    } = req.body;

    const { client, type: platformType } = getAIClient(platformKey);

    if (!referenceUrl) {
      return res.status(400).json({ success: false, error: 'referenceUrl is required' });
    }

    console.log(`[Flow] Starting reference-to-prompt for ${referenceUrl}`);

    // Construct User Context for AI Blending
    const userContext = `
Business Name: ${businessName || 'A Modern Business'}
Primary Color: ${primaryColor || 'N/A'}
Secondary Color: ${secondaryColor || 'N/A'}
Heading Font: ${headingFont || 'N/A'}
Body Font: ${bodyFont || 'N/A'}
Website Layout/Category: ${websiteLayout || 'N/A'}
Theme Mode: ${themeMode || 'Dark'}
`.trim();

    // 1. Capture Screenshot
    let screenshotBase64;
    try {
      screenshotBase64 = await captureScreenshot(referenceUrl);
    } catch (err) {
      return res.status(502).json({ success: false, error: 'Screenshot failed: Site blocked, invalid URL, or timeout.' });
    }

    // 2. Optimize Screenshot
    const optimizedBase64 = await optimizeScreenshot(screenshotBase64);

    // 3. Analyze with Anthropic
    let aiAnalysis;
    try {
      aiAnalysis = await analyzeUI_Image(client, optimizedBase64, userContext, platformType);
    } catch (err) {
      return res.status(502).json({ success: false, error: 'AI Analysis failed: Malformed JSON or processing error.' });
    }

    // 4. Determine Sections
    const finalSections = determineSections(sections, aiAnalysis.sections_detected);

    // 5. Package output
    const structuredPrompt = {
      style: aiAnalysis.style,
      layout: aiAnalysis.layout,
      themeMode: themeMode || 'Dark',
      sections: finalSections,
      sectionOrder: sectionOrder || finalSections,
      colors: aiAnalysis.colors,
      typography: aiAnalysis.typography,
      uiPatterns: aiAnalysis.uiPatterns,
      spacing: aiAnalysis.spacing || "Standard optimized whitespace",
      visualHierarchy: aiAnalysis.visualHierarchy || "Clear top-down progression",
      sourceReference: referenceUrl
    };

    const finalScreenshotUrl = `data:image/jpeg;base64,${optimizedBase64}`;
    const finalPrompt = aiAnalysis.human_readable_prompt || "No human readable prompt output detected. Refer to the JSON schema layout.";

    // 6. Store result in Design Manifest
    const saved = saveManifest({
      referenceUrl,
      screenshotUrl: finalScreenshotUrl,
      prompt: finalPrompt,
      structuredPrompt,
      sections: finalSections,
      businessName,
      websiteLayout,
      themeMode,
      sectionOrder: sectionOrder || finalSections
    });

    res.json({
      success: true,
      manifestId: saved.id,
      referenceUrl,
      screenshotUrl: finalScreenshotUrl,
      prompt: finalPrompt,
      structuredPrompt
    });

  } catch (error) {
    console.error('[Flow ✗] Error processing reference URL:', error?.message || error);
    res.status(500).json({ success: false, error: error?.message || 'Failed to process reference URL' });
  }
});

app.post('/api/design-manifest/generate-from-reference', (req, res, next) => {
  upload.any()(req, res, (err) => {
    if (err) {
      console.error('[Multer Error]', err.message);
      return res.status(500).json({ error: 'File upload failed: ' + err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const {
      referenceUrl, activeTab, manifestId, businessName, websiteLayout,
      themeMode, primaryColor, secondaryColor,
      headingFont, bodyFont, platformKey
    } = req.body;

    const { client, type: platformType } = getAIClient(platformKey);

    // Generate a unique hash for the entire request to check for cached results
    const requestHash = generateHash({ ...req.body, activeTab });
    const cachedPrompt = getPromptFromCache(requestHash);
    if (cachedPrompt) {
      console.log('[Optimization] Returning cached prompt for identical request.');
      // We need to return the full response object, so we still need some metadata
      // but the core prompt is cached.
      return res.json(cachedPrompt);
    }

    // Fix: Robust JSON parsing for references and sections
    const referenceWebsites = req.body.referenceWebsites ? (typeof req.body.referenceWebsites === 'string' ? JSON.parse(req.body.referenceWebsites) : req.body.referenceWebsites) : [];
    const clientResourcesSections = req.body.clientResourcesSections ? (typeof req.body.clientResourcesSections === 'string' ? JSON.parse(req.body.clientResourcesSections) : req.body.clientResourcesSections) : [];
    const sectionsInput = req.body.sections ? (typeof req.body.sections === 'string' ? JSON.parse(req.body.sections) : req.body.sections) : [];
    const sectionOrderInput = req.body.sectionOrder ? (typeof req.body.sectionOrder === 'string' ? JSON.parse(req.body.sectionOrder) : req.body.sectionOrder) : [];

    // Fix: Correctly extract contentSource from either body text OR an uploaded file
    let contentSource = req.body.contentSource || '';

    // Check for uploaded content files
    if (req.files && req.files.length > 0) {
      const contentFile = req.files.find(f => f.fieldname === 'contentFile' || f.fieldname === 'file');
      if (contentFile) {
        console.log(`[Extraction] Found uploaded content file: ${contentFile.originalname}`);
        try {
          const extractedText = await extractTextFromBuffer(contentFile.buffer, contentFile.originalname);
          if (extractedText) {
            contentSource = extractedText;
            console.log(`[Extraction ✓] Extracted ${contentSource.length} characters from ${contentFile.originalname}`);
          }
        } catch (err) {
          console.error(`[Extraction ✗] Failed to extract from ${contentFile.originalname}:`, err.message);
        }
      }

      // Map section images to their respective sections
      clientResourcesSections.forEach((sec, idx) => {
        const fieldName = `sectionImage_${idx}`;
        const imageFile = req.files.find(f => f.fieldname === fieldName);
        if (imageFile) {
          sec.imagePath = saveUploadedFile(imageFile);
          sec.imageBuffer = imageFile.buffer; // Keep buffer for AI analysis
        }
      });
    }

    // Optimization: Summarize content once if it's large
    const contentSummary = await summarizeContent(client, contentSource, platformType);

    console.log(`[Refinement] Final Content Source Length: ${contentSource.length} characters`);

    console.log(`[Unified Flow] Starting full generation for ${referenceUrl || (referenceWebsites && referenceWebsites.length ? referenceWebsites.length + ' websites' : 'Manual Manifest')}`);

    let screenshotBase64 = null;
    let optimizedBase64 = null;
    let aiAnalysis = {
      style: "Modern",
      layout: websiteLayout || "Landing Page",
      colors: [primaryColor, secondaryColor].filter(Boolean),
      typography: { heading: headingFont, body: bodyFont },
      sections_detected: []
    };

    let allAnalyses = [];

    if (activeTab === 'Clients Resources') {
      if (referenceWebsites && referenceWebsites.length > 0) {
        console.log(`[Unified Flow] Processing ${referenceWebsites.length} multiple reference websites for Clients Resources`);

        for (const ref of referenceWebsites) {
          console.log(`[Unified Flow] Analyzing URL: ${ref.url}`);

          // Optimization: Check analysis cache
          const analysisHash = generateHash({ url: ref.url, businessName, themeMode });
          const cachedAnalysis = getAnalysisFromCache(analysisHash);

          if (cachedAnalysis) {
            console.log(`[Optimization] Using cached analysis for ${ref.url}`);
            // Attach analysis results to reference
            ref.style = cachedAnalysis.style;
            ref.layout = cachedAnalysis.layout;
            ref.human_readable_prompt = cachedAnalysis.human_readable_prompt;
            ref.extractedText = cachedAnalysis.extractedText;

            allAnalyses.push({ 
              ...cachedAnalysis, 
              ...ref, 
              screenshotUrl: cachedAnalysis.screenshotBase64 ? `data:image/jpeg;base64,${cachedAnalysis.screenshotBase64}` : null 
            });
            if (!optimizedBase64) optimizedBase64 = cachedAnalysis.screenshotBase64;
            continue;
          }

          console.log(`[URL Processor] Starting combined extraction & capture for: ${ref.url}`);
          try {
            const result = await extractWebsiteMetadataAndScreenshot(ref.url);
            
            // Structured backend logs showing processing status
            if (result.contentSuccess) {
              console.log(`[URL Processor ✓] Content extraction SUCCESS for ${ref.url}`);
            } else {
              console.warn(`[URL Processor ✗] Content extraction FAILED for ${ref.url}`);
            }

            if (result.screenshotSuccess) {
              console.log(`[URL Processor ✓] Screenshot capture SUCCESS for ${ref.url}`);
            } else {
              console.error(`[URL Processor ✗] Screenshot capture FAILED for ${ref.url}`);
            }

            let oBase64 = null;
            if (result.screenshotBase64) {
              oBase64 = await optimizeScreenshot(result.screenshotBase64);
            }

            const userContext = `
Business Name: ${businessName || 'A Modern Business'}
Primary Color: ${primaryColor || 'N/A'}
Secondary Color: ${secondaryColor || 'N/A'}
Heading Font: ${headingFont || 'N/A'}
Body Font: ${bodyFont || 'N/A'}
Website Layout/Category: ${websiteLayout || 'N/A'}
Theme Mode: ${themeMode || 'Dark'}
ATTENTION CLAUDE: This specific reference website should be used primarily for:
Description provided by user: "${ref.description}"
Please extract design intelligence ONLY relevant to this description.`.trim();

            let analysis = {
              style: 'Modern Minimalist',
              layout: websiteLayout || 'Landing Page',
              colors: [primaryColor, secondaryColor].filter(Boolean),
              typography: { heading: headingFont, body: bodyFont },
              sections_detected: [],
              human_readable_prompt: 'Screenshot analysis failed or was unavailable.'
            };

            if (oBase64) {
              try {
                analysis = await analyzeUI_Image(client, oBase64, userContext, platformType);
              } catch (analysisErr) {
                console.error(`[URL Processor ✗] AI screenshot visual analysis failed for ${ref.url}:`, analysisErr.message);
              }
            }

            // Combine both results and store in the cache
            setAnalysisToCache(analysisHash, { 
              ...analysis, 
              screenshotBase64: oBase64,
              extractedText: result.extractedText
            });

            // Attach analysis results to reference
            ref.style = analysis.style;
            ref.layout = analysis.layout;
            ref.human_readable_prompt = analysis.human_readable_prompt;
            ref.extractedText = result.extractedText;

            allAnalyses.push({ 
              ...analysis, 
              ...ref, 
              screenshotUrl: oBase64 ? `data:image/jpeg;base64,${oBase64}` : null 
            });
            
            if (oBase64 && !optimizedBase64) {
              optimizedBase64 = oBase64;
            }

          } catch (err) {
            console.error(`[Unified Flow ✗] Failed processing ${ref.url}:`, err);
          }
        }
      }

      if (clientResourcesSections && clientResourcesSections.length > 0) {
        console.log(`[Unified Flow] Processing ${clientResourcesSections.length} custom sections`);
        for (const sec of clientResourcesSections) {
          const imageBase64 = sec.imageBuffer ? sec.imageBuffer.toString('base64') : sec.imageBase64;

          if (imageBase64) {
            try {
              const userContext = `
Business Name: ${businessName || 'A Modern Business'}
Section Type: ${sec.type || 'Custom Section'}
Theme Mode: ${themeMode || 'Dark'}
ATTENTION CLAUDE: This image is specifically for the "${sec.type}" section.
User Description: "${sec.description || 'N/A'}"
Please extract design intelligence ONLY relevant to this section and description.`.trim();

              const analysis = await analyzeUI_Image(client, imageBase64, userContext, platformType);
              // Attach analysis results to section
              sec.style = analysis.style;
              sec.layout = analysis.layout;
              sec.human_readable_prompt = analysis.human_readable_prompt;

              allAnalyses.push({ ...analysis, sectionType: sec.type, description: sec.description, source: 'Custom Section Image' });
              if (!optimizedBase64) optimizedBase64 = imageBase64;

              // Clean up buffer after use to keep memory usage low
              delete sec.imageBuffer;
            } catch (err) {
              console.error(`[Unified Flow ✗] Failed processing section image for ${sec.type}:`, err);
            }
          } else if (sec.description && sec.description.trim() !== '') {
            allAnalyses.push({
              sectionType: sec.type,
              description: sec.description,
              source: 'Custom Section Note',
              style: 'Driven by note',
              layout: 'Driven by note'
            });
          }
        }
      }


      if (allAnalyses.length > 0) {
        aiAnalysis = { ...aiAnalysis, ...allAnalyses[0] };
        aiAnalysis.multipleAnalyses = allAnalyses;
      }

    } else if (referenceUrl) {
      // Optimization: Check analysis cache for single reference
      const analysisHash = generateHash({ url: referenceUrl, businessName, themeMode });
      const cachedAnalysis = getAnalysisFromCache(analysisHash);

      if (cachedAnalysis) {
        console.log(`[Optimization] Using cached analysis for ${referenceUrl}`);
        aiAnalysis = cachedAnalysis;
        optimizedBase64 = cachedAnalysis.screenshotBase64;
      } else {
        try {
          screenshotBase64 = await captureScreenshot(referenceUrl);
          optimizedBase64 = await optimizeScreenshot(screenshotBase64);

          const userContext = `
Business Name: ${businessName || 'A Modern Business'}
Primary Color: ${primaryColor || 'N/A'}
Secondary Color: ${secondaryColor || 'N/A'}
Heading Font: ${headingFont || 'N/A'}
Body Font: ${bodyFont || 'N/A'}
Website Layout/Category: ${websiteLayout || 'N/A'}
Theme Mode: ${themeMode || 'Dark'}
`.trim();

          aiAnalysis = await analyzeUI_Image(client, optimizedBase64, userContext, platformType);
          setAnalysisToCache(analysisHash, { ...aiAnalysis, screenshotBase64: optimizedBase64 });
        } catch (err) {
          return res.status(502).json({ success: false, error: 'Reference analysis failed: ' + err.message });
        }
      }
    }

    const finalSections = determineSections(sectionsInput, aiAnalysis.sections_detected);

    // Optimization: Clean and optimize the context payload
    const context = optimizePayload({
      ...req.body,
      referenceWebsites,
      clientResourcesSections,
      sections: finalSections,
      sectionOrder: sectionOrderInput && sectionOrderInput.length > 0 ? sectionOrderInput : finalSections,
      structuredPrompt: aiAnalysis,
      multipleAnalyses: aiAnalysis.multipleAnalyses,
      contentSource,
      contentSummary
    });

    const refinedPrompt = await refinePrompt(client, { ...context, contentSource, contentSummary }, platformType);

    const structuredPrompt = {
      style: aiAnalysis.style,
      layout: aiAnalysis.layout,
      themeMode: themeMode || 'Dark',
      sections: finalSections,
      orderedSections: sectionOrderInput && sectionOrderInput.length > 0 ? sectionOrderInput : finalSections,
      colors: aiAnalysis.colors,
      typography: aiAnalysis.typography,
      uiPatterns: aiAnalysis.uiPatterns,
      spacing: aiAnalysis.spacing || "Standard optimized whitespace",
      visualHierarchy: aiAnalysis.visualHierarchy || "Clear top-down progression",
      sourceReference: referenceUrl
    };

    const finalScreenshotUrl = optimizedBase64 ? `data:image/jpeg;base64,${optimizedBase64}` : null;

    const saved = saveManifest({
      id: manifestId,
      referenceUrl,
      screenshotUrl: finalScreenshotUrl,
      prompt: refinedPrompt,
      structuredPrompt,
      sections: finalSections,
      sectionOrder: sectionOrderInput && sectionOrderInput.length > 0 ? sectionOrderInput : finalSections,
      businessName,
      websiteLayout,
      themeMode,
      analysisMetadata: {
        timestamp: new Date().toISOString(),
        engine: platformType === 'openai' ? 'gpt-4o' : getAnthropicModel()
      }
    });

    const responseData = {
      success: true,
      manifestId: saved.id,
      referenceUrl,
      screenshotUrl: finalScreenshotUrl,
      screenshotUrls: aiAnalysis.multipleAnalyses ? aiAnalysis.multipleAnalyses.map(a => a.screenshotUrl).filter(Boolean) : (finalScreenshotUrl ? [finalScreenshotUrl] : []),
      prompt: refinedPrompt,
      structuredPrompt
    };

    // Store in prompt cache
    setPromptToCache(requestHash, responseData);

    res.json(responseData);

  } catch (error) {
    console.error('[Unified Flow ✗] Error:', error?.message || error);
    res.status(500).json({ success: false, error: error?.message || 'Failed to generate from reference' });
  }
});


app.post('/api/design-manifest/transform', (req, res) => {
  try {
    const { structuredPrompt } = req.body;
    if (!structuredPrompt) {
      return res.status(400).json({ success: false, error: 'structuredPrompt is required for transformation.' });
    }
    const devSpec = transformToDeveloperSpec(structuredPrompt);
    res.json({ success: true, devSpec });
  } catch (err) {
    console.error('[Transform ✗] Error:', err);
    res.status(500).json({ success: false, error: 'Transformation failed: ' + err.message });
  }
});

// ── Figma Integration ───────────────────────────────────────────────────────
app.post('/api/figma-export', async (req, res) => {
  try {
    const { manifest, structuredPrompt, generatedPrompt, activeTab } = req.body;
    if (!manifest) {
      return res.status(400).json({ success: false, error: 'Manifest data is required' });
    }

    const { client, type: platformType } = getAIClient(manifest.platformKey);
    let figmaSpec = null;
    if (activeTab === 'Clients Resources') {
      figmaSpec = await generateFigmaSpec(client, {
        businessName: manifest.businessName,
        primaryColor: manifest.primaryColor,
        secondaryColor: manifest.secondaryColor,
        headingFont: manifest.headingFont,
        bodyFont: manifest.bodyFont,
        websiteLayout: manifest.websiteLayout,
        themeMode: manifest.themeMode,
        generatedPrompt,
        structuredPrompt
      });
    }

    const designId = Date.now().toString() + Math.random().toString(36).substring(7);

    const data = readData();
    data.figmaExports.push({
      id: designId,
      timestamp: new Date().toISOString(),
      designData: {
        manifest,
        structuredPrompt,
        generatedPrompt,
        figmaSpec
      }
    });
    writeData(data);

    res.json({ success: true, designId });
  } catch (err) {
    console.error('[Figma Export ✗] Error:', err);
    res.status(500).json({ success: false, error: 'Failed to export to Figma: ' + err.message });
  }
});

app.get('/api/figma-export/:id', (req, res) => {
  try {
    const { id } = req.params;
    const data = readData();
    const exportData = data.figmaExports.find(e => e.id === id);

    if (!exportData) {
      return res.status(404).json({ success: false, error: 'Design not found' });
    }

    res.json({ success: true, designData: exportData.designData });
  } catch (err) {
    console.error('[Figma Export Fetch ✗] Error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch design data: ' + err.message });
  }
});

app.get('/api/figma-export/latest/item', (req, res) => {
  try {
    const data = readData();
    if (!data.figmaExports || data.figmaExports.length === 0) {
      return res.status(404).json({ success: false, error: 'No designs exported yet' });
    }
    const latest = data.figmaExports[data.figmaExports.length - 1];
    res.json({ success: true, designData: latest.designData, id: latest.id });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch latest design' });
  }
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => console.log(`🚀 Backend running at http://localhost:${port}`));
}

export default app;

