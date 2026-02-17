
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { AppState, SimulationMode, StoryNode, WikiEntry, WorldType, SimulationSession, WorldMeta, ToneType, CanonStrictness, PowerScaling, IntegrationMode, NarrativeEvent, TelltaleChoice, NarrativeStructure, TokenUsage, SceneState, CharacterRuntimeState, Consequence, DirectorMode, AdaptedEntity, WorldGenerationMode, TimelineEvent, HierarchyTier, SimulationType, RoleplayType, ScenarioHook } from "../types";

// Helper to get client (assumes process.env.API_KEY is available as per instructions)
const getAiClient = () => {
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

export interface DiscoveredEntity {
  name: string;
  category: WikiEntry['category'];
  description?: string;
}

export interface GenerationResult {
    content: string;
    suggestions?: string[];
    choices?: TelltaleChoice[];
    newKeyEvents: Partial<NarrativeEvent>[];
    updatedCharacterStates?: CharacterRuntimeState[];
    newConsequences?: Consequence[];
    usage?: TokenUsage;
}

// --- HELPER: Retry Logic for API Calls ---
// Handles 500/Status 0 network blips
async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let lastError;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastError = e;
      if (e.name === 'AbortError') throw e; // Don't retry aborts
      
      // Retry on network errors or server errors
      const msg = e.message || "";
      if (msg.includes('500') || msg.includes('503') || msg.includes('fetch failed') || msg.includes('status code: 0')) {
          console.warn(`API Attempt ${i+1} failed. Retrying...`, e);
          await new Promise(r => setTimeout(r, 1000 * (i + 1))); // Exponential backoff
          continue;
      }
      throw e; // Don't retry other errors (like 400 Bad Request)
    }
  }
  throw lastError;
}

// --- HELPER: History Pruning for Token Optimization ---
const pruneHistory = (history: any[], maxMessages = 12) => {
    if (history.length <= maxMessages) return history;
    // Always keep the first message (System/Briefing/Context)
    const first = history[0];
    // Keep the last N messages
    const recent = history.slice(-maxMessages);
    return [first, ...recent];
};

// --- HELPER: Alias Extraction ---
const getAliases = (entry: WikiEntry | AdaptedEntity): string[] => {
    const name = 'name' in entry ? entry.name : entry.adaptedName;
    const content = 'content' in entry ? entry.content : entry.description;

    const cleanName = name.replace(/['"]/g, '').toLowerCase();
    const aliases = [cleanName];
    
    // Split by spaces to get first/last names or parts
    const parts = cleanName.split(/[\s-]+/);
    if (parts.length > 1) {
        parts.forEach(p => {
            // Ignore common stop words and very short parts to avoid false positives (e.g. "The", "Of")
            if (p.length > 2 && !['the', 'and', 'of', 'von', 'van', 'de', 'dr', 'mr', 'mrs'].includes(p)) {
                aliases.push(p);
            }
        });
    }

    // Attempt to extract explicit species, nicknames, or aliases from content
    if (content) {
        // Species
        const speciesMatch = content.match(/Species:\s*([a-zA-Z0-9\s]+)/i);
        if (speciesMatch && speciesMatch[1]) {
            const s = speciesMatch[1].trim().toLowerCase();
            if (s !== 'human' && s !== 'unknown') aliases.push(s);
        }

        // Nicknames / Aliases patterns (Added Title support)
        const nickMatch = content.match(/(?:Nickname|Alias|Also known as|Title):\s*([a-zA-Z0-9,\s]+)/i);
        if (nickMatch && nickMatch[1]) {
            const nicks = nickMatch[1].split(',').map(n => n.trim().toLowerCase());
            nicks.forEach(n => {
                if(n && n.length > 2) aliases.push(n);
            });
        }
    }

    return Array.from(new Set(aliases));
};

// --- HELPER: Robust JSON Repair for Streaming Responses ---
const repairJson = (jsonStr: string): any => {
    try {
        return JSON.parse(jsonStr);
    } catch (e) {
        // Attempt simple repair for truncated JSON
        let repaired = jsonStr.trim();
        
        // 1. Check for unclosed string
        let quoteCount = 0;
        let isEscaped = false;
        for (let i = 0; i < repaired.length; i++) {
            if (repaired[i] === '\\' && !isEscaped) {
                isEscaped = true;
                continue;
            }
            if (repaired[i] === '"' && !isEscaped) {
                quoteCount++;
            }
            isEscaped = false;
        }
        
        if (quoteCount % 2 !== 0) {
            repaired += '"';
        }
        
        // 2. Balance braces/brackets
        const stack: string[] = [];
        let inString = false;
        isEscaped = false;
        
        for (let i = 0; i < repaired.length; i++) {
             if (repaired[i] === '\\' && !isEscaped) { isEscaped = true; continue; }
             if (repaired[i] === '"' && !isEscaped) { inString = !inString; isEscaped=false; continue; }
             isEscaped = false;
             if (inString) continue;
             
             if (repaired[i] === '{' || repaired[i] === '[') stack.push(repaired[i]);
             if (repaired[i] === '}' && stack.length > 0 && stack[stack.length-1] === '{') stack.pop();
             if (repaired[i] === ']' && stack.length > 0 && stack[stack.length-1] === '[') stack.pop();
        }
        
        while(stack.length > 0) {
            const c = stack.pop();
            if (c === '{') repaired += '}';
            if (c === '[') repaired += ']';
        }
        
        // If repair fails, parsing will throw again, which is handled by caller
        return JSON.parse(repaired);
    }
};

/**
 * Scans a Wiki URL (Main Page or Category Page) or performs a search to discover characters and lore.
 */
export const scanWikiUrl = async (
    input: string, 
    model: string, 
    focus: string, 
    signal: AbortSignal, 
    mode: 'link' | 'search' = 'link'
): Promise<{ fandom: string; entities: DiscoveredEntity[] }> => {
  
  const isSearch = mode === 'search';
  const systemPrompt = `
    You are an Advanced Wiki Scanner specialized in extracting structured data from Fandom/MediaWiki pages.
    
    **Task:**
    1. ${isSearch ? "Use Google Search to find the most comprehensive Fandom/Wiki page matching the user's query." : "Access the provided Wiki URL using Google Search."}
    2. Identify the **Name of the Fandom** accurately.
    3. Perform a thorough scan to extract a **COMPREHENSIVE** list of up to 25 of the most important and distinct entities.
    
    **Scanning Focus:** ${focus}
    (If focus is 'All', get a mix. If 'Character', get only characters. If 'Lore', get history/events. If 'Location', get places.)

    **Scanning Rules:**
    - If the URL is a "Category" or "List" page, extract the main items listed.
    - If the URL is a Main Page, follow primary navigation links (like 'Characters', 'Locations', 'Factions') to gather a list of the most important entities.
    - Prioritize completeness and relevance within the limit. Do not list minor or obscure items if major ones are available.
    - Accurately categorize each item: 'Character', 'World' (Locations), 'Lore' (History/Events), 'Species', 'Facility', 'Religion', 'Country'.
    
    **Output Format:**
    Return the result strictly in valid JSON format matching this schema:
    {
      "fandom": "Name of Fandom",
      "entities": [
        { 
          "name": "Entity Name", 
          "category": "Category", 
          "description": "Short description" 
        }
      ]
    }
  `;
  const ai = getAiClient();
  let response: GenerateContentResponse | undefined;
  
  const contentPrompt = isSearch 
    ? `Search for and scan a wiki about "${input}" with focus on ${focus}.`
    : `Scan this Wiki URL extensively with focus on ${focus}: ${input}`;

  try {
    response = await withRetry(async () => ai.models.generateContent({
      model,
      contents: contentPrompt,
      config: {
        systemInstruction: systemPrompt,
        tools: [{ googleSearch: {} }],
        // responseMimeType: "application/json", // Not compatible with tools
      }
    }));

    let jsonText = response.text || "{\"fandom\": \"Unknown\", \"entities\": []}";

    if (jsonText.startsWith("```json")) {
        jsonText = jsonText.substring(7);
        if (jsonText.endsWith("```")) {
            jsonText = jsonText.slice(0, -3);
        }
    }
    jsonText = jsonText.trim();

    return repairJson(jsonText);
  } catch (e: any) {
    if (e.name === 'AbortError') throw e;
    
    console.error("Wiki scan failed", e);
    if (e instanceof SyntaxError) {
        const rawText = response?.text;
        console.error("Failed to parse JSON response from Gemini:", rawText);
        throw new Error("Could not scan wiki. The AI returned an invalid data format, which may be due to the response being too long and getting cut off.");
    }
    
    throw new Error("Could not scan wiki. Please check the URL or try again later.");
  }
};

/**
 * FABRICATE ENTITY (For Original Fiction / IP Sim Mode)
 * Creates a brand new entity from scratch based on the world premise.
 */
export const fabricateEntity = async (
    prompt: string,
    category: WikiEntry['category'],
    genre: string,
    worldPremise: string,
    model: string,
    signal: AbortSignal
): Promise<{ content: string; name: string; fandom: string }> => {
    const systemPrompt = `
        You are an Advanced World-Building Engine (Genesis Module).
        
        **TASK:** Create a completely original, detailed database entry for a ${category}.
        
        **WORLD CONTEXT (THE BIBLE):**
        - **Genre:** ${genre}
        - **Premise:** ${worldPremise}
        
        **USER REQUEST:** "${prompt}"
        
        **GUIDELINES:**
        1. **Deep Integration:** The entity must fit perfectly into the established genre and premise. Use the specific terminology implied by the premise (e.g., if the world has "Aether", the character uses Aether, not generic magic).
        2. **Consistency:** Ensure the technology level, magic system, and social structure match the world.
        3. **Detailed Output:** Include sensory details, history, secrets, and relationships.
        
        **OUTPUT FORMAT:**
        Return a VALID JSON object matching the standard schema used for imports.
    `;

    const entrySchema = {
        type: Type.OBJECT,
        properties: {
            detectedName: { type: Type.STRING, description: "The name of the entity." },
            emoji: { type: Type.STRING, description: "A single emoji representing the entity." },
            metadata: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        key: { type: Type.STRING, description: "Label (e.g. Class, Origin)" },
                        value: { type: Type.STRING, description: "Value" }
                    }
                }
            },
            sections: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING, description: "Section header" },
                        content: { type: Type.STRING, description: "Paragraph content (Markdown)." }
                    }
                }
            }
        },
        required: ["detectedName", "emoji", "metadata", "sections"]
    };

    const ai = getAiClient();
    try {
        const response = await withRetry(async () => ai.models.generateContent({
            model,
            contents: `Fabricate: ${prompt}`,
            config: {
                systemInstruction: systemPrompt,
                responseMimeType: "application/json",
                responseSchema: entrySchema
            }
        }));

        const json = repairJson(response.text || "{}");
        const formattedContent = formatEntryToMarkdown(json);

        return {
            content: formattedContent || "Fabrication failed.",
            name: json.detectedName || "Unknown Entity",
            fandom: genre || "Original Fiction"
        };
    } catch (e: any) {
        if (e.name === 'AbortError') throw e;
        throw new Error("Failed to fabricate entity.");
    }
};

/**
 * REFACTORED: Analyze Wiki Content with Structured JSON Schema.
 * Uses strict schema validation to ensure high-quality headers and metadata extraction.
 */
export const analyzeWikiContent = async (
  input: string,
  category: WikiEntry['category'],
  model: string,
  signal: AbortSignal,
  mode: 'link' | 'text' | 'search' = 'link',
  modifiers?: string
): Promise<{ content: string; fandom?: string; name: string }> => {
  
  const isChar = category === 'Character';
  
  // 1. Construct System Prompt based on Category
  const systemPrompt = `
    You are an Advanced Multiverse Archivist.
    
    **TASK:** Analyze the input and generate a highly detailed, structured database entry for a ${category}.
    
    **CATEGORY GUIDANCE:**
    ${isChar ? 
      `- **FOCUS:** Personality (Psychological profile, fears, desires), Appearance (Sensory details), Abilities/Powers (Rules, limits), Backstory (Key trauma/events), and Relationships.
       - **METADATA:** Full Canon Name, Species, Age, Gender, Pronouns, Sexual Orientation, Fandom Origin, Affiliation.` :
      `- **FOCUS:** Visual Description (Atmosphere, sensory details), History/Lore, Significance to the world, Inhabitants/Factions, and Geography/Layout.
       - **METADATA:** Official Name, Type (City, Planet, Artifact, Event), Location/Region, Era, Fandom Origin.`
    }

    **USER MODIFIERS (CRITICAL OVERRIDES):**
    ${modifiers ? `The user has explicitly requested: "${modifiers}". \n   **RULE:** You MUST incorporate these changes. If the modifier contradicts canon (e.g. "Make them evil"), the modifier WINS. Rewrite the entry to reflect this new truth.` : "None. Stick strictly to canon information."}

    **OUTPUT FORMAT:**
    Return a VALID JSON object. Do not return Markdown text directly.
  `;

  // 2. Construct User Prompt
  let promptContext = "";
  let tools: any[] = [];
  
  if (mode === 'link') {
      promptContext = `Analyze the content at this URL: ${input}`;
      tools = [{ googleSearch: {} }];
  } else if (mode === 'search') {
      promptContext = `Search the web for "${input}" (Focus on ${category} details). Prioritize Fandom/Wikia/Miraheze sources.`;
      tools = [{ googleSearch: {} }];
  } else {
      promptContext = `Analyze this raw text: "${input}"`;
  }

  // 3. Define Schema
  const entrySchema = {
    type: Type.OBJECT,
    properties: {
        detectedName: { type: Type.STRING, description: "The official name of the entity." },
        detectedFandom: { type: Type.STRING, description: "The source material/universe." },
        emoji: { type: Type.STRING, description: "A single emoji representing the entity." },
        metadata: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    key: { type: Type.STRING, description: "Label (e.g. Species, Age)" },
                    value: { type: Type.STRING, description: "Value (e.g. Human, 25)" }
                }
            },
            description: "Key-value pairs for the top summary section."
        },
        sections: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    title: { type: Type.STRING, description: "Section header (e.g. Appearance, Personality)" },
                    content: { type: Type.STRING, description: "Detailed paragraph content in Markdown format." }
                }
            },
            description: "The main body content divided into logical sections."
        }
    },
    required: ["detectedName", "detectedFandom", "emoji", "metadata", "sections"]
  };

  const ai = getAiClient();
  
  try {
    const response = await withRetry(async () => ai.models.generateContent({
      model,
      contents: promptContext,
      config: {
        systemInstruction: systemPrompt,
        tools: tools,
        responseMimeType: "application/json",
        responseSchema: entrySchema
      }
    }));

    const json = repairJson(response.text || "{}");
    
    // 4. Format JSON to Markdown String (for legacy app compatibility and easy editing)
    const formattedContent = formatEntryToMarkdown(json);
    
    return {
        content: formattedContent || "No content generated.",
        fandom: json.detectedFandom,
        name: json.detectedName || input
    };

  } catch (error: any) {
    if (error.name === 'AbortError') throw error;
    console.error("Wiki extraction failed:", error);
    
    // Fallback for quota issues or severe model failures
    throw new Error("Failed to analyze wiki content. Please check your API key quota or try a different model.");
  }
};

/**
 * Helper to convert the structured JSON entry back into the App's standard Markdown format.
 */
function formatEntryToMarkdown(json: any): string {
    if (!json) return "";
    
    let md = "";
    
    // Header
    if (json.emoji) md += `${json.emoji} `;
    if (json.detectedName) md += `${json.detectedName}\n\n`;
    
    // Metadata Block
    if (json.metadata && Array.isArray(json.metadata)) {
        json.metadata.forEach((item: any) => {
            if (item.key && item.value) {
                md += `**${item.key}:** ${item.value}\n`;
            }
        });
    }
    
    md += "\n";
    
    // Sections
    if (json.sections && Array.isArray(json.sections)) {
        json.sections.forEach((sec: any) => {
            if (sec.title && sec.content) {
                md += `### ${sec.title}\n${sec.content}\n\n`;
            }
        });
    }
    
    return md.trim();
}

/**
 * Modifies an existing wiki entry name and content based on user prompts.
 */
export const modifyEntryWithAI = async (
    name: string,
    content: string,
    instructions: string,
    model: string,
    signal: AbortSignal
): Promise<{ name: string; content: string }> => {
    const systemPrompt = `
        You are a Lore Modification Engine.
        Your task is to rewrite a Wiki Entry based on user instructions.
        
        **Original Name:** ${name}
        **Original Content:**
        ${content}
        
        **USER INSTRUCTION:** "${instructions}"
        
        **OUTPUT:**
        Return a JSON object with the new Name and Content.
        
        **CRITICAL FORMATTING RULES:**
        1. The 'content' field MUST use Markdown formatting.
        2. Use **Bold** for headers/keys (e.g. **Appearance:**, **Personality:**).
        3. MANDATORY: Use double newlines (\\n\\n) to create distinct paragraphs between sections. 
        4. Use bullet points (*) for lists (Relationships, Likes/Dislikes).
        5. Do NOT output a single dense paragraph. The output must be structured and easy to read.
    `;

    const ai = getAiClient();
    try {
        const response = await withRetry(async () => ai.models.generateContent({
            model,
            contents: "Execute modification.",
            config: {
                systemInstruction: systemPrompt,
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        name: { type: Type.STRING },
                        content: { type: Type.STRING }
                    },
                    required: ["name", "content"]
                }
            }
        }));

        const parsed = repairJson(response.text || "{}");
        return {
            name: parsed.name || name,
            content: parsed.content || content
        };

    } catch (e: any) {
        if (e.name === 'AbortError') throw e;
        throw e;
    }
};

/**
 * Generates Scenario Hooks for Single-Fandom mode
 */
export const generateScenarioHooks = async (
    fandom: string,
    type: RoleplayType,
    era: string,
    model: string,
    signal: AbortSignal
): Promise<ScenarioHook[]> => {
    const ai = getAiClient();
    const systemPrompt = `
    You are a Fanfiction Scenario Generator.
    
    **Task:** Generate 4 distinct, compelling plot hooks for a single-fandom roleplay.
    
    **Configuration:**
    - Fandom: ${fandom}
    - Roleplay Type: ${type}
    - Era/Setting: ${era}
    
    **Output:**
    Return a JSON array of objects. Each object should have:
    - title: Catchy title.
    - premise: A one-sentence summary.
    - hook: A paragraph describing the starting situation, the conflict, and the player's immediate goal.
    `;

    try {
        const response = await withRetry(async () => ai.models.generateContent({
            model,
            contents: "Generate hooks.",
            config: {
                systemInstruction: systemPrompt,
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            title: { type: Type.STRING },
                            premise: { type: Type.STRING },
                            hook: { type: Type.STRING }
                        },
                        required: ["title", "premise", "hook"]
                    }
                }
            }
        }));
        
        return repairJson(response.text || "[]");
    } catch (e: any) {
        if (e.name === 'AbortError') throw e;
        throw e;
    }
};

export const generateWorldMeta = async (
  config: SimulationSession['config'],
  entries: WikiEntry[],
  signal: AbortSignal,
  onProgress?: (progress: number) => void,
  currentMeta?: WorldMeta,
  enhancementModifier?: string,
  mode: WorldGenerationMode = WorldGenerationMode.Rewrite,
  targetSection?: 'timeline' | 'hierarchy' | 'integration'
): Promise<WorldMeta> => {

  const isNative = config.integrationMode === IntegrationMode.Native;
  const integrationInstruction = isNative
    ? `**CRITICAL - NATIVE INTEGRATION**: The simulation takes place entirely in the **${config.hostFandom || 'Core'}** universe. 
       - There is NO multiverse, NO portals, NO nexus. 
       - Every entity from other fandoms MUST be completely reimagined as native inhabitants.
       - Example: If the host is "Medieval Fantasy" and the character is a "Space Marine", they become a "Heavy Armored Golem" or "Royal Guard" with magical plate armor. 
       - Histories must be merged into ONE timeline.`
    : `Integration Mode: ${config.integrationMode}. Characters may be displaced or visiting, but should fit the world logic according to: ${config.conflictResolution}`;

  // Mode Logic
  let modeInstruction = "";
  if (currentMeta && mode === WorldGenerationMode.MaintainAndFill) {
      modeInstruction = `
      **MODE: MAINTAIN AND FILL**
      1. RETAIN all existing timeline events, hierarchy positions, and adaptations provided in the CONTEXT.
      2. ONLY INSERT new entries to fill logical gaps or where data is missing.
      3. Do NOT rewrite existing descriptions unless they are empty or contradictory.
      `;
  } else if (currentMeta && mode === WorldGenerationMode.EnhanceOnly) {
      modeInstruction = `
      **MODE: ENHANCE ONLY**
      1. STRICTLY KEEP the existing structure (same number of timeline events, same hierarchy placements).
      2. REWRITE the 'description' fields to be more vivid, detailed, and lore-accurate based on the modifiers.
      3. Do NOT add new events or entities. Focus on quality of prose.
      `;
  } else {
      modeInstruction = `
      **MODE: REWRITE**
      1. Disregard previous generated logic (except what is hardcoded in WikiEntries). 
      2. Generate a fresh, cohesive world structure from scratch.
      `;
  }

  // Section Targeting
  let sectionInstruction = "";
  if (targetSection === 'timeline') {
      sectionInstruction = "**TARGET: TIMELINE.** Focus processing on creating a robust timeline. Return the existing Hierarchy and Adaptations EXACTLY as they are in the context.";
  } else if (targetSection === 'hierarchy') {
      sectionInstruction = "**TARGET: HIERARCHY.** Focus processing on power balancing. Return Timeline and Adaptations EXACTLY as they are.";
  } else if (targetSection === 'integration') {
      sectionInstruction = "**TARGET: INTEGRATION.** Focus on creating deep AdaptedEntity profiles. Return Timeline and Hierarchy EXACTLY as they are.";
  }

  // ORIGIAL FICTION MODE OVERRIDE
  let hostSettingPrompt = "";
  if (config.simulationType === SimulationType.OriginalFiction) {
      hostSettingPrompt = `
      **MODE: ORIGINAL FICTION GENESIS**
      - **Genre:** ${config.genre}
      - **World Premise (THE BIBLE):** ${config.worldPremise}
      - All entities must be perfectly integrated into this specific original world.
      - Ignore "Fandoms". Treat the 'Premise' as the only canon.
      `;
  } else {
      hostSettingPrompt = config.hostFandom ? `Primary Laws/Physics: **${config.hostFandom}**.` : "Fused World: All fandoms are merged equally.";
  }

  let prompt = `
    You are a Worldbuilding Engine and Integration Harmonizer.
    
    **Task:**
    1. Create/Update a cohesive Timeline and Power Hierarchy for a ${config.worldType} simulation.
    2. **ADAPT ENTITIES**: Generate/Update "Integration Manifest" for *every* provided WikiEntry to fit the world logic.

    **HOST WORLD / SETTING:**
    ${hostSettingPrompt}

    **INTEGRATION LOGIC (STRICT):**
    ${integrationInstruction}

    **Context/Lore:**
    ${entries.map(e => `[ID: ${e.id}] ${e.name} (${e.category}) - ${e.content.substring(0, 300)}...`).join('\n')}

    **World Rules (Absolute Truths):**
    ${config.modifiers || "None"}
    
    ${modeInstruction}
    ${sectionInstruction}
    
    **OUTPUT RULES:**
    1. **NO INTERNAL MONOLOGUE.** Output raw JSON only.
    2. **TIMELINE:** Max 15 key events. Sorted chronologically. 
       - **CRITICAL:** Descriptions must be meaningful sentences explaining the event, not just titles. Avoid extremely long paragraphs, but ensure clarity and depth (e.g., "The Fall of Beacon Academy: Cinder Fall instigates a massive Grimm invasion, destroying the school and scattering the huntsmen.").
       - Events must be grounded in the provided WikiEntries. **DO NOT hallucinate** relationships or major wars that contradict the source material unless 'Integration Mode' requires it.
    3. **HIERARCHY:** 5 tiers per category.
    4. **ADAPTATIONS:** You MUST return an 'entityAdaptationsList' array containing adaptations for ALL characters/species.
  `;

  if (currentMeta) {
      prompt += `
      **EXISTING DATA (CONTEXT):**
      ${JSON.stringify(currentMeta)}
      `;
  }

  if (enhancementModifier) {
      prompt += `\n\n**USER ENHANCEMENT INSTRUCTIONS:**\n${enhancementModifier}`;
  }

  const ai = getAiClient();
  try {
    if (onProgress) onProgress(30);
    
    const hierarchyTierSchema = {
        type: Type.OBJECT,
        properties: {
            tierName: { type: Type.STRING },
            entities: { 
                type: Type.ARRAY, 
                items: { 
                    type: Type.OBJECT, 
                    properties: {
                        name: { type: Type.STRING },
                        subtypes: { type: Type.ARRAY, items: { type: Type.STRING } }
                    } 
                } 
            }
        }
    };

    const response = await withRetry(async () => ai.models.generateContent({
      model: config.model,
      contents: "Generate World Meta",
      config: {
        systemInstruction: prompt,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            timeline: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  era: { type: Type.STRING },
                  year: { type: Type.STRING },
                  description: { type: Type.STRING },
                  sourceFandom: { type: Type.STRING }
                }
              }
            },
            hierarchy: {
              type: Type.OBJECT,
              properties: {
                 Power: { type: Type.ARRAY, items: hierarchyTierSchema },
                 Political: { type: Type.ARRAY, items: hierarchyTierSchema },
                 Social: { type: Type.ARRAY, items: hierarchyTierSchema },
                 Species: { type: Type.ARRAY, items: hierarchyTierSchema }
              }
            },
            // Use Array instead of Object for entity adaptations list to avoid strict schema issues
            entityAdaptationsList: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        entryId: { type: Type.STRING },
                        adaptedName: { type: Type.STRING },
                        role: { type: Type.STRING },
                        status: { type: Type.STRING },
                        whereabouts: { type: Type.STRING },
                        description: { type: Type.STRING, description: "Short bio adapted to the world logic." }
                    }
                }
            }
          }
        }
      }
    }));

    if (onProgress) onProgress(90);
    const parsed = repairJson(response.text || "{}");
    if (onProgress) onProgress(100);

    // Convert list back to record/map for frontend use
    const adaptationsRecord: Record<string, AdaptedEntity> = {};
    if (parsed.entityAdaptationsList && Array.isArray(parsed.entityAdaptationsList)) {
        parsed.entityAdaptationsList.forEach((ad: AdaptedEntity) => {
            if (ad.entryId) adaptationsRecord[ad.entryId] = ad;
        });
    }

    return {
        timeline: Array.isArray(parsed.timeline) ? parsed.timeline : [],
        hierarchy: (parsed.hierarchy && typeof parsed.hierarchy === 'object') ? parsed.hierarchy : {},
        entityAdaptations: adaptationsRecord
    };

  } catch (e: any) {
    if (e.name === 'AbortError') throw e;
    console.error("World Meta Generation Failed", e);
    // Propagate error so UI knows something went wrong, or return minimal valid state
    throw e;
  }
};

export const adaptSingleEntity = async (
    entry: WikiEntry,
    config: SimulationSession['config'],
    prompt: string
): Promise<AdaptedEntity> => {
    const ai = getAiClient();
    try {
        const systemPrompt = `
            You are a Character Adaptation Engine.
            
            **WORLD CONFIGURATION:**
            - **Integration Mode:** ${config.integrationMode} (Native = Rewrite history completely).
            - **Host World:** ${config.hostFandom || 'Merged/Hybrid'}.
            - **Tone:** ${config.tone}.
            - **Power Scaling:** ${config.powerScaling}.
            - **World Rules:** ${config.modifiers || "None"}
            
            **Task:** Adapt the character "${entry.name}" based on user instructions.
            **Wiki Content:** ${entry.content.substring(0, 1000)}...
            
            **INSTRUCTION:**
            The user wants to repurpose this character: "${prompt}"
            
            **CRITICAL:** You must generate values for ALL fields (Adapted Name, Role, Status, Whereabouts, Description) that match this new prompt.
            - Ensure the adaptation fits the Tone (${config.tone}) and World Rules.
        `;

        const response = await withRetry(async () => ai.models.generateContent({
            model: config.model,
            contents: `Execute Adaptation for ${entry.name}`,
            config: {
                systemInstruction: systemPrompt,
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        entryId: { type: Type.STRING },
                        adaptedName: { type: Type.STRING },
                        role: { type: Type.STRING },
                        status: { type: Type.STRING },
                        whereabouts: { type: Type.STRING },
                        description: { type: Type.STRING }
                    },
                    required: ["adaptedName", "role", "status", "whereabouts", "description"]
                }
            }
        }));

        const parsed = repairJson(response.text || "{}");
        return {
            entryId: entry.id,
            adaptedName: parsed.adaptedName || entry.name,
            role: parsed.role || "Unknown",
            status: parsed.status || "Active",
            whereabouts: parsed.whereabouts || "Unknown",
            description: parsed.description || "No description generated."
        };
    } catch (e) {
        throw e;
    }
};

/**
 * Smart AI Assistant to add/modify/sort/delete items within the World Logic Preview.
 * ENHANCED: Includes robust context regarding World Rules, Tone, and Gap Filling.
 */
export const assistWorldLogic = async (
    section: 'timeline' | 'hierarchy' | 'integration',
    prompt: string,
    currentData: any, 
    config: SimulationSession['config'],
    wikiEntries: WikiEntry[],
    signal: AbortSignal
): Promise<any> => {
    const ai = getAiClient();
    
    // Construct simplified context for context
    const entityContext = wikiEntries.slice(0, 40).map(e => 
        `[ID: ${e.id}] ${e.name} (Fandom: ${e.fandom || 'Unknown'}, Type: ${e.category})`
    ).join('\n');

    // PRE-PROCESSING: If Integration, merge pending items into the currentData so the AI sees them
    let effectiveData = currentData;
    if (section === 'integration') {
        const existingMap = (currentData && typeof currentData === 'object') ? currentData : {};
        const fullList: AdaptedEntity[] = wikiEntries.map(entry => {
            if (existingMap[entry.id]) {
                return existingMap[entry.id];
            }
            // Create placeholder for pending item so AI knows it's missing
            return {
                entryId: entry.id,
                adaptedName: entry.name,
                role: "Pending",
                status: "Pending",
                whereabouts: "Unknown",
                description: "Pending integration. Needs adaptation."
            };
        });
        effectiveData = fullList; // Send as Array to AI for easier processing
    }
    
    const systemPrompt = `
        You are an AI World Logic Assistant. Your job is to modify the provided JSON data structure based on the user's Natural Language request.
        
        **Target Section:** ${section.toUpperCase()}
        
        **WORLD CONFIGURATION (ABSOLUTE TRUTHS):**
        - Host Fandom: ${config.hostFandom || 'Hybrid'}
        - Integration Mode: ${config.integrationMode}
        - Narrative Tone: ${config.tone}
        - Power Scaling: ${config.powerScaling}
        - Canon Strictness: ${config.canonStrictness}
        - **WORLD RULES/MODIFIERS:** ${config.modifiers || "None"}
        
        **Context (Entities):** 
        ${entityContext}
        
        **USER INSTRUCTION:** "${prompt}"
        
        **Current Data:**
        ${JSON.stringify(effectiveData)}
        
        **General Rules:**
        1. **MODIFY** the data to fulfill the request (Add, Delete, Edit, Sort).
        2. **FILL GAPS:** If the user asks to "enhance" or "fill", look for items marked "Pending" or missing details and generate logic for them based on the Context and World Rules.
        3. **STRICTLY RETURN** the new JSON data structure matching the input format.
        4. **NO HALLUCINATIONS:** If adding new items, ensure they respect the World Config and Entity Context.
        
        ${section === 'timeline' ? `
        **Timeline Rules:**
        - Return Array of objects: { year, era, description, sourceFandom }.
        - **IMPORTANT:** 'description' field MUST contain a full sentence or short paragraph describing the event in detail, not just a title. (e.g. "The Great War begins after the assassination of the Archduke, plunging the continent into chaos.")
        - **TAGGING LOGIC:** If an event description explicitly mentions a character or faction from the Context, you MUST set 'sourceFandom' to that entity's fandom. If it involves multiple, pick the most dominant one or use 'Crossover'. Only use 'General' if no specific fandom is involved.
        - **ENHANCE LOGIC:** If asked to enhance, rewrite descriptions to be more evocative and consistent with the Tone (${config.tone}). Ensure the timeline flows logically.
        ` : ''}
        
        ${section === 'hierarchy' ? `
        **Hierarchy Rules:**
        - Return Object: { [Category]: [ { tierName, entities: [ { name, subtypes } ] } ] }
        - You can move entities between tiers, add new tiers, or rename tiers.
        - Respect 'Power Scaling': ${config.powerScaling}. If 'Balanced', keep tiers somewhat equal. If 'Lore Accurate', allow OP characters to be in top tiers.
        - **FILL GAPS:** If entities from the Context are missing, add them to the appropriate tier.
        ` : ''}
        
        ${section === 'integration' ? `
        **Integration Rules:**
        - Return Array (List) of objects: { entryId, adaptedName, role, status, whereabouts, description }.
        - **FILL PENDING:** The input list contains items marked "Pending". You MUST generate unique roles, statuses, and descriptions for these items to fit the world.
        - **ENHANCE LOGIC:** Ensure descriptions explain *how* the character fits into the '${config.hostFandom || 'Hybrid'}' world, respecting the '${config.modifiers}' rules.
        - Use 'entryId' to match existing entities. Do NOT lose any entities from the list unless explicitly asked to delete.
        ` : ''}
    `;

    // Define schema based on section
    let responseSchema;
    if (section === 'timeline') {
        responseSchema = {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    year: { type: Type.STRING },
                    era: { type: Type.STRING },
                    description: { type: Type.STRING },
                    sourceFandom: { type: Type.STRING }
                },
                required: ["description", "sourceFandom"]
            }
        };
    } else if (section === 'hierarchy') {
        responseSchema = {
            type: Type.OBJECT,
            properties: {
                Power: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { tierName: {type: Type.STRING}, entities: {type: Type.ARRAY, items: {type: Type.OBJECT, properties: {name: {type:Type.STRING}, subtypes: {type:Type.ARRAY, items:{type:Type.STRING}}}}} } } },
                Political: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { tierName: {type: Type.STRING}, entities: {type: Type.ARRAY, items: {type: Type.OBJECT, properties: {name: {type:Type.STRING}, subtypes: {type:Type.ARRAY, items:{type:Type.STRING}}}}} } } },
                Social: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { tierName: {type: Type.STRING}, entities: {type: Type.ARRAY, items: {type: Type.OBJECT, properties: {name: {type:Type.STRING}, subtypes: {type:Type.ARRAY, items:{type:Type.STRING}}}}} } } },
                Species: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { tierName: {type: Type.STRING}, entities: {type: Type.ARRAY, items: {type: Type.OBJECT, properties: {name: {type:Type.STRING}, subtypes: {type:Type.ARRAY, items:{type:Type.STRING}}}}} } } }
            }
        };
    } else if (section === 'integration') {
        // Convert Record to Array for AI processing stability
        responseSchema = {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    entryId: { type: Type.STRING },
                    adaptedName: { type: Type.STRING },
                    role: { type: Type.STRING },
                    status: { type: Type.STRING },
                    whereabouts: { type: Type.STRING },
                    description: { type: Type.STRING }
                },
                required: ["entryId", "adaptedName", "role", "status", "whereabouts", "description"]
            }
        };
    }

    try {
        const response = await withRetry(async () => ai.models.generateContent({
            model: config.model,
            contents: "Execute World Logic Modification",
            config: {
                systemInstruction: systemPrompt,
                responseMimeType: "application/json",
                responseSchema: responseSchema
            }
        }));

        let parsed = repairJson(response.text || (section === 'hierarchy' ? "{}" : "[]"));
        
        // Post-processing for integration (List -> Map)
        if (section === 'integration' && Array.isArray(parsed)) {
            const map: Record<string, AdaptedEntity> = {};
            parsed.forEach((item: any) => {
                if (item.entryId) map[item.entryId] = item;
            });
            return map;
        }

        return parsed;

    } catch (e: any) {
        if (e.name === 'AbortError') throw e;
        throw e;
    }
};

/**
 * Smartly generates new timeline events, potentially modifying existing ones based on context.
 * @deprecated Use assistWorldLogic instead for more generic control
 */
export const generateSmartTimelineEvents = async (
    prompt: string,
    currentTimeline: TimelineEvent[],
    config: SimulationSession['config'],
    wikiEntries: WikiEntry[], // Added wiki entries
    signal: AbortSignal
): Promise<TimelineEvent[]> => {
    // Forward to new generic function for backward compat if needed, or keep for simple 'add'
    return assistWorldLogic('timeline', prompt, currentTimeline, config, wikiEntries, signal);
};

export const generateTimelineEvent = async (
    prompt: string,
    config: SimulationSession['config'],
    wikiEntries: WikiEntry[], // Added wiki entries
    signal: AbortSignal
): Promise<{ year: string; era: string; description: string; sourceFandom: string }> => {
    // Legacy single wrapper
    const events = await generateSmartTimelineEvents(prompt, [], config, wikiEntries, signal);
    const evt = events[0];
    return {
        year: evt?.year || "????",
        era: evt?.era || "Unknown",
        description: evt?.description || prompt,
        sourceFandom: evt?.sourceFandom || "Manual"
    };
};

export const generateSimulationBriefing = async (
    session: SimulationSession,
    signal: AbortSignal
): Promise<GenerationResult> => {
    const { config, wikiEntries, worldMeta } = session;

    let integrationInstruction = "";
    
    if (config.simulationType === SimulationType.SingleFandom) {
        integrationInstruction = `
            **MODE: SINGLE FANDOM ROLEPLAY**
            - Fandom: ${config.fandoms[0]}
            - Roleplay Type: ${config.roleplayType}
            - Era: ${config.timeEra || "Canonical"}
            - THIS IS A SINGLE UNIVERSE. Do not mention "portals", "crossovers", or "merging".
            
            **ROLE MAPPINGS (CAST):**
            ${config.roleAssignments?.map(r => {
                const char = wikiEntries.find(e => e.id === r.characterId);
                return `- ROLE: ${r.roleName} -> PLAYED BY: ${char?.name || "Unknown"} (${r.description || ""})`;
            }).join('\n') || "No specific roles assigned."}
        `;
    } else if (config.simulationType === SimulationType.OriginalFiction) {
        integrationInstruction = `
            **MODE: ORIGINAL FICTION (IP SIM)**
            - **Genre:** ${config.genre || "Original"}
            - **Premise:** ${config.worldPremise || "Original World"}
            - **NATIVE INTEGRATION ENFORCED**: All characters are native to this original world. NO multiverse.
        `;
    } else {
         integrationInstruction = config.integrationMode === IntegrationMode.Native
        ? `**NATIVE INTEGRATION ENFORCED**: All characters are NATIVES of the ${config.hostFandom} world. Backstories rewritten. NO Multiverse.`
        : `Integration Mode: ${config.integrationMode}`;
    }
    
    // Inject Adapted Entity Data
    const adaptations = worldMeta?.entityAdaptations ? Object.values(worldMeta.entityAdaptations).map(a => 
        `[ADAPTED ROLE] ${a.adaptedName}: ${a.role} at ${a.whereabouts}. (${a.description})`
    ).join('\n') : "";

    const systemPrompt = `
      You are the Gamemaster/Director for a ${config.simulationType === SimulationType.SingleFandom ? 'Single-Fandom Roleplay' : config.simulationType === SimulationType.OriginalFiction ? 'Original Fiction Simulation' : 'Multifandom Simulation'}.
      **TASK:** Initialize the simulation by creating a compelling "Situation Overview".
      **Fandoms:** ${config.simulationType === SimulationType.OriginalFiction ? "Original World (See Premise)" : (config.fandoms || []).join(', ')}
      **Integration:** ${integrationInstruction}
      
      **ADAPTED ROLES (STRICTLY FOLLOW THESE):**
      ${adaptations}

      **Original Lore Context:**
      ${wikiEntries.map(e => `[${e.category}: ${e.name}]`).join(', ')}
      
      **Modifiers / Scenario Hook:**
      ${config.modifiers}

      **OUTPUT REQUIREMENTS:**
      1. **World & Setting:** Describe the immediate environment/atmosphere.
      2. **The Cast:** List key characters present.
      3. **The Inciting Incident:** What is the immediate problem?
      4. **Opening:** End with a call to action.

      **Style:** Narrative, immersive, concise. Setup dossier.
    `;
    
    const ai = getAiClient();
    try {
        const response = await withRetry(async () => ai.models.generateContent({
            model: config.model,
            contents: "Initialize situation overview and cast list.",
            config: {
                systemInstruction: systemPrompt,
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        overviewText: { type: Type.STRING },
                        suggestions: { type: Type.ARRAY, items: { type: Type.STRING } }
                    },
                    required: ["overviewText", "suggestions"]
                }
            }
        }));
        
        const usage: TokenUsage = {
            promptTokens: response.usageMetadata?.promptTokenCount || 0,
            responseTokens: response.usageMetadata?.candidatesTokenCount || 0,
            totalTokens: response.usageMetadata?.totalTokenCount || 0,
        };

        const json = repairJson(response.text || "{}");
        return {
            content: json.overviewText || "Briefing generation failed.",
            suggestions: json.suggestions || [],
            newKeyEvents: [{ description: "Simulation Begins", inStoryTime: "Prologue" }],
            usage
        };
    } catch (e: any) {
        if (e.name === 'AbortError') throw e;
        throw e; // Throw to allow caller to handle error transiently
    }
};


/**
 * Generates the next story segment, adapting to Director or Actor mode.
 * UPDATED: Uses text streaming + separator to allow real-time typewriter effect.
 */
export const generateStorySegment = async (
  session: SimulationSession,
  history: StoryNode[], 
  newInput: string,
  signal: AbortSignal, 
  onStreamText?: (text: string) => void
): Promise<GenerationResult> => {
  const { config, wikiEntries, sceneState, characterStates, consequences, worldMeta } = session;

  let integrationInstruction = "";
  if (config.simulationType === SimulationType.SingleFandom) {
       integrationInstruction = `**SINGLE FANDOM MODE**: ${config.fandoms[0]} (${config.timeEra || 'Canonical'}).
       Roleplay Type: ${config.roleplayType}.
       Do NOT cross over into other fandoms. Keep it contained.`;
  } else if (config.simulationType === SimulationType.OriginalFiction) {
       integrationInstruction = `**ORIGINAL FICTION MODE**:
       - Genre: ${config.genre}
       - Premise: ${config.worldPremise}
       - **RULE:** Do NOT use existing IP/Fandoms. This is a standalone original world. Use only the provided Lore/Characters.`;
  } else {
       integrationInstruction = config.integrationMode === IntegrationMode.Native
        ? `**NATIVE INTEGRATION**: Characters are NATIVES of the ${config.hostFandom} world. NO multiverse references.`
        : `Integration Mode: ${config.integrationMode}`;
  }

  const toneString = config.tone === ToneType.CUSTOM ? config.customTone || 'Canon Compliant' : config.tone.replace(/_/g, ' ');

  // POV and Tense Handling
  const povString = config.narrativePOV ? config.narrativePOV.replace(/_/g, ' ').toLowerCase() : 'third person limited';
  const tenseString = config.narrativeTense ? config.narrativeTense.toLowerCase() : 'past';

  // AUTO-DETECTION LOGIC
  // 1. Map aliases to IDs
  const charAliasMap = new Map<string, string>();
  const allChars = wikiEntries.filter(e => e.category === 'Character');
  
  allChars.forEach(e => {
      // Canon Name Aliases (including Species/Nicknames from content)
      getAliases(e).forEach(alias => charAliasMap.set(alias, e.id));
      
      // Adapted Name Aliases
      const adapted = worldMeta?.entityAdaptations?.[e.id];
      if (adapted) {
          getAliases(adapted).forEach(alias => charAliasMap.set(alias, e.id));
      }
  });

  // 2. Scan Context (Input + Last 3 messages)
  // We use a broader window to catch characters mentioned recently who haven't spoken yet
  const recentNodes = history.slice(-3);
  const contextText = (recentNodes.map(n => n.content).join(' ') + ' ' + newInput).toLowerCase();
  
  const autoDetectedIds = new Set<string>();
  
  // Optimization: Only scan if we have characters
  if (allChars.length > 0) {
      charAliasMap.forEach((id, alias) => {
          // specific boundary check to avoid "Cat" matching "Catastrophe"
          // We use a simple regex builder. Escape alias first.
          const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`\\b${escapedAlias}\\b`, 'i');
          if (regex.test(contextText)) {
              autoDetectedIds.add(id);
          }
      });
  }

  // 3. Merge Active IDs (Manual + Auto)
  // Ensure we check for User Active Character if in Actor mode
  if (config.simulationMode === SimulationMode.Actor && config.activeCharacterId) {
      autoDetectedIds.add(config.activeCharacterId);
  }

  const manualIds = new Set(sceneState?.activeCharacterIds || []);
  const finalActiveIds = new Set([...manualIds, ...autoDetectedIds]);
  
  const activeChars = allChars.filter(e => finalActiveIds.has(e.id));
  const activeStates = Object.values(characterStates || {}).filter(s => finalActiveIds.has(s.characterId));
  const activeConsequences = (consequences || []).filter(c => c.active);

  // Construct Character Bible with explicit Strictness Logic AND Adapted Roles
  // Increased content limit to prevent cutting off psychological profiles (crucial for "Doom Mood")
  const characterBible = activeChars.length > 0 
    ? activeChars.map(e => {
        const state = activeStates.find(s => s.characterId === e.id);
        const adaptation = worldMeta?.entityAdaptations?.[e.id];
        // Check for Single-Fandom Role Assignment
        const roleAssignment = config.roleAssignments?.find(r => r.characterId === e.id);
        
        const nicknames = getAliases(e).slice(1).join(', '); // Exclude first which is name
        
        const stateStr = state ? `[CURRENT STATE: Stress=${state.stress}%, Emotion=${state.emotion}, Status=${state.notes}]` : "";
        
        let identityBlock = "";
        
        if (roleAssignment) {
             identityBlock = `
            **ASSIGNED NARRATIVE ROLE:** ${roleAssignment.roleName}
            - Description: ${roleAssignment.description || "N/A"}
            `;
        } else if (adaptation) {
            identityBlock = `
            **ADAPTED IDENTITY (PRIORITY OVER CANON):**
            - Name: ${adaptation.adaptedName}
            - Role: ${adaptation.role}
            - Whereabouts: ${adaptation.whereabouts}
            - Status: ${adaptation.status}
            - Integration Description: ${adaptation.description}
            `;
        } else {
            identityBlock = `**IDENTITY:** Canon`;
        }

        return `### ACTIVE CHARACTER: ${e.name} (${e.fandom || 'Unknown'})
        **Detected Aliases/Keywords:** ${nicknames || "None"}
        ${stateStr}
        ${identityBlock}
        
        **CONSTITUTION (STRICTNESS: ${config.canonStrictness}):**
        1. [IMMUTABLE TRAITS]: Species (unless Adapted), Gender, Age, Core Physiology.
        2. [MUTABLE TRAITS]: Clothing, Inventory, Hairstyle, Temporary Scars/Injuries.
        3. [PERSONALITY]:
           ${config.canonStrictness === CanonStrictness.Strict ? "- STRICT: Act exactly as canon. No OOC behavior. If the bio says 'Hateful', do NOT make them 'Polite'." : 
             config.canonStrictness === CanonStrictness.Flexible ? "- FLEXIBLE: Adapt to the setting, but keep core moral compass and personality quirks." : 
             "- DIVERGENT: Rewrite behavior to fit the new timeline. Fundamental changes allowed."}
        
        **ANTI-TROPE DIRECTIVE:**
        - Do NOT default to generic archetypes (e.g., "The Generic Doctor", "The Silent Soldier") unless the personality explicitly dictates it.
        - **PRIORITY:** The provided psychological profile and 'Mood' take precedence over their job title or class.
        - If a character is a "Nurse" but described as "Sadistic", they MUST act sadistic, not professional.

        **DYNAMIC VOICE ADAPTATION:**
        ${(config.canonStrictness === CanonStrictness.Flexible || config.canonStrictness === CanonStrictness.Divergent) 
            ? `- **LOCALIZATION:** Adapt the character's speech patterns (vocabulary, sentence structure) to fit the current Setting/Tone (${toneString}) while preserving their core personality intensity. (e.g., A 'Modern Bro' becomes a 'Medieval Gallant' or 'Victorian Rake' depending on the era, using period-appropriate slang but keeping the attitude).` 
            : `- **STRICT CONTRAST:** Character MUST retain their original speech patterns regardless of the setting. Emphasize the culture shock/anachronism.`}

        **ORIGINAL DATA:**
        ${e.content.substring(0, 5000)}`; // Increased limit for complex bios
    }).join('\n\n')
    : "No specific characters active. Use general lore and infer context from history.";
  
  const loreContext = wikiEntries.filter(e => e.category !== 'Character').map(e => {
      const ad = worldMeta?.entityAdaptations?.[e.id];
      return `[${e.category}: ${e.name}] - ${ad ? `ADAPTED: ${ad.description}` : e.content.substring(0, 500)}`;
  }).join('\n');

  let pacingInstruction = "";
  switch(sceneState?.currentDirectorMode) {
      case DirectorMode.SlowBurn: pacingInstruction = "Pacing: Slow Burn. Focus on dialogue, atmosphere, and internal thought. Delay gratification."; break;
      case DirectorMode.HighTension: pacingInstruction = "Pacing: High Tension. Fast, visceral sentences. Focus on danger, time pressure, and stress."; break;
      case DirectorMode.Chaotic: pacingInstruction = "Pacing: Chaotic. Unpredictable events, confusion, sensory overload."; break;
      case DirectorMode.Minimalist: pacingInstruction = "Pacing: Minimalist. Very concise. Only essential actions."; break;
      default: pacingInstruction = "Pacing: Balanced. Standard narrative flow."; break;
  }

  let systemPrompt = `You are an expert multifandom fanfiction author engine (AO3 style).
  
  **NARRATIVE CONTEXT:**
  - **Location:** ${sceneState?.activeLocation || "Unknown"}
  - **Director Mode (Pacing):** ${pacingInstruction}
  - **Tone:** ${toneString}
  - **Integration:** ${integrationInstruction}
  
  **ACTIVE CONSEQUENCES (Must impact narrative):**
  ${activeConsequences.map(c => `- [${c.severity}] ${c.name}: ${c.description}`).join('\n') || "None."}

  **ACTIVE CHARACTERS (Follow Constitution & Adaptation):**
  ${characterBible}

  **ADDITIONAL LORE:**
  ${loreContext}

  **Instructions:**
  - Write in ${povString} point of view.
  - Write in ${tenseString} tense.
  - Maintain continuity.
  - **IMPORTANT:** Output story text naturally.
  `;
  
  const prunedHistory = pruneHistory(history, 15);

  const contents = prunedHistory.map(m => ({
    role: m.role,
    parts: [{ text: m.content }]
  }));

  contents.push({ role: 'user', parts: [{ text: newInput }] });

  systemPrompt += `\n\n**RESPONSE FORMAT (STRICT):**
  1. Write STORY NARRATIVE directly.
  2. End with separator: \`---METADATA---\`
  3. Output JSON object after separator.
  
  JSON Schema:
  {
    "suggestions": ["Action 1", "Action 2"],
    "choices": [],
    "newKeyEvents": [],
    "updatedCharacterStates": [ { "characterId": "...", "emotion": "...", "stress": 0-100, "notes": "..." } ],
    "newConsequences": [ { "id": "...", "name": "...", "description": "...", "severity": "Low|Medium|Critical", "active": true } ]
  }
  
  *Update character states based on the events of this segment.*
  `;

  if (config.simulationMode === SimulationMode.Actor) {
      const activeChar = session.wikiEntries.find(e => e.id === config.activeCharacterId)?.name || 'the player character';
      systemPrompt += `\n**MODE: ACTOR**
      User is roleplaying as **${activeChar}**. Respond to their action.
      Provide 4 distinct choices in JSON (A, B, C, D).
      ${config.showTelltaleIndicators ? "If a choice was significant, embed `|| X will remember this. ||` in story text." : ""}`;
  } else {
      systemPrompt += `\n**MODE: DIRECTOR**
      Provide 3 punchy recommended actions in JSON.`;
  }
  
  const ai = getAiClient();
  try {
    const responseStream = await withRetry(async () => ai.models.generateContentStream({
      model: config.model,
      contents: contents,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "text/plain", 
      }
    }));

    let fullText = "";
    let storyPart = "";
    let isMetadata = false;
    let metadataJson = "";

    const SEPARATOR = "---METADATA---";

    for await (const chunk of responseStream) {
        const text = chunk.text;
        if (!text) continue;

        if (!isMetadata) {
            const separatorIndex = text.indexOf(SEPARATOR);
            
            if (separatorIndex !== -1) {
                const partBefore = text.substring(0, separatorIndex);
                const partAfter = text.substring(separatorIndex + SEPARATOR.length);
                
                storyPart += partBefore;
                if (onStreamText) onStreamText(storyPart);
                
                isMetadata = true;
                metadataJson += partAfter;
            } else {
                storyPart += text;
                if (onStreamText) onStreamText(storyPart);
            }
        } else {
            metadataJson += text;
        }
        fullText += text;
    }

    let resultJson: any = { suggestions: [], choices: [], newKeyEvents: [] };
    
    if (!isMetadata) {
        const parts = fullText.split(SEPARATOR);
        if (parts.length > 1) {
            storyPart = parts[0].trim();
            metadataJson = parts[1].trim();
        } else {
            storyPart = fullText;
        }
    }

    storyPart = storyPart.trim();

    try {
        if (metadataJson.trim()) {
            let cleanJson = metadataJson.replace(/```json/g, '').replace(/```/g, '').trim();
            resultJson = repairJson(cleanJson);
        }
    } catch (e) {
        console.warn("Failed to parse metadata JSON from stream", e);
    }

    const usage: TokenUsage = {
        promptTokens: 0, 
        responseTokens: 0, 
        totalTokens: 0,
    };

    return {
      content: storyPart || "Error generating story.",
      suggestions: resultJson.suggestions,
      choices: resultJson.choices,
      newKeyEvents: resultJson.newKeyEvents || [],
      updatedCharacterStates: resultJson.updatedCharacterStates,
      newConsequences: resultJson.newConsequences,
      usage
    };

  } catch (error: any) {
    if (error.name === 'AbortError') throw error;
    console.error("Story generation failed:", error);
    throw error; // Propagate error so UI can handle it transiently
  }
};
