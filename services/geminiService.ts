// ... imports (keep existing)
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { AppState, SimulationMode, StoryNode, WikiEntry, WorldType, SimulationSession, WorldMeta, ToneType, CanonStrictness, PowerScaling, IntegrationMode, NarrativeEvent, TelltaleChoice, NarrativeStructure, TokenUsage, SceneState, CharacterRuntimeState, Consequence, DirectorMode, AdaptedEntity, WorldGenerationMode, TimelineEvent, HierarchyTier, SimulationType, RoleplayType, ScenarioHook, WorldSeed } from "../types";

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
    sceneHeader?: { location: string; time: string; date: string };
    telltaleTags?: string[];
    newKeyEvents: Partial<NarrativeEvent>[];
    updatedCharacterStates?: CharacterRuntimeState[];
    newConsequences?: Consequence[];
    usage?: TokenUsage;
}

// --- HELPER: Retry Logic for API Calls ---
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
    const first = history[0];
    const recent = history.slice(-maxMessages);
    return [first, ...recent];
};

// --- HELPER: Alias Extraction ---
const getAliases = (entry: WikiEntry | AdaptedEntity): string[] => {
    const name = 'name' in entry ? entry.name : entry.adaptedName;
    const content = 'content' in entry ? entry.content : entry.description;

    const cleanName = name.replace(/['"]/g, '').toLowerCase();
    const aliases = [cleanName];
    
    const parts = cleanName.split(/[\s-]+/);
    if (parts.length > 1) {
        parts.forEach(p => {
            if (p.length > 2 && !['the', 'and', 'of', 'von', 'van', 'de', 'dr', 'mr', 'mrs'].includes(p)) {
                aliases.push(p);
            }
        });
    }

    if (content) {
        const speciesMatch = content.match(/Species:\s*([a-zA-Z0-9\s]+)/i);
        if (speciesMatch && speciesMatch[1]) {
            const s = speciesMatch[1].trim().toLowerCase();
            if (s !== 'human' && s !== 'unknown') aliases.push(s);
        }

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
        let repaired = jsonStr.trim();
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
        
        return JSON.parse(repaired);
    }
};

// ... (keep existing exports like generateWorldGenesis, generateOriginalCharacter, scanWikiUrl, analyzeWikiContent, modifyEntryWithAI, generateScenarioHooks, generateWorldMeta, adaptSingleEntity, assistWorldLogic, generateSmartTimelineEvents, generateTimelineEvent)

export const generateWorldGenesis = async (
    seed: WorldSeed,
    model: string,
    signal: AbortSignal
): Promise<WikiEntry[]> => {
    // ... implementation preserved ...
    const ai = getAiClient();
    const systemPrompt = `
    You are a Worldbuilding Engine (Genesis Module).
    **INPUT SEED:**
    - Genre: ${seed.genre}
    - Premise: ${seed.premise}
    - Magic Level: ${seed.magicLevel}
    - Tech Level: ${seed.techLevel}
    **TASK:** Construct the foundational "World Bible". Generate 6 entries.
    **OUTPUT FORMAT:** JSON Array of WikiEntry objects.
    `;
    try {
        const response = await withRetry(async () => ai.models.generateContent({
            model,
            contents: "Execute Genesis.",
            config: { systemInstruction: systemPrompt, responseMimeType: "application/json", responseSchema: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, category: { type: Type.STRING }, content: { type: Type.STRING } }, required: ["name", "category", "content"] } } }
        }));
        const rawEntries = repairJson(response.text || "[]");
        return rawEntries.map((e: any) => ({ id: crypto.randomUUID(), name: e.name, category: e.category, content: e.content, fandom: 'Original Universe', isSystem: false }));
    } catch (e: any) { if (e.name === 'AbortError') throw e; throw e; }
};

export const generateOriginalCharacter = async (prompt: string, existingEntries: WikiEntry[], model: string, signal: AbortSignal): Promise<WikiEntry> => {
    const ai = getAiClient();
    const contextSummary = existingEntries.slice(0, 15).map(e => `${e.category}: ${e.name}`).join(', ');
    const systemPrompt = `You are the "OC Factory". **WORLD CONTEXT:** ${contextSummary} **USER REQUEST:** "${prompt}" **TASK:** Create a detailed character bio that fits seamlessly. **OUTPUT FORMAT:** JSON object with name and content.`;
    try {
        const response = await withRetry(async () => ai.models.generateContent({ model, contents: "Generate OC.", config: { systemInstruction: systemPrompt, responseMimeType: "application/json", responseSchema: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, content: { type: Type.STRING } }, required: ["name", "content"] } } }));
        const result = repairJson(response.text || "{}");
        return { id: crypto.randomUUID(), name: result.name || "Unknown Character", category: 'Character', content: result.content || "No content generated.", fandom: 'Original Universe' };
    } catch (e: any) { if (e.name === 'AbortError') throw e; throw e; }
};

export const scanWikiUrl = async (input: string, model: string, focus: string, signal: AbortSignal, mode: 'link' | 'search' = 'link'): Promise<{ fandom: string; entities: DiscoveredEntity[] }> => {
  const isSearch = mode === 'search';
  const systemPrompt = `You are an Advanced Wiki Scanner. **Task:** 1. ${isSearch ? "Use Google Search" : "Access URL"}. 2. Identify Fandom. 3. Extract 25 entities. **Focus:** ${focus}. **Output:** JSON.`;
  const ai = getAiClient();
  const contentPrompt = isSearch ? `Search for and scan a wiki about "${input}" with focus on ${focus}.` : `Scan this Wiki URL extensively with focus on ${focus}: ${input}`;
  try {
    const response = await withRetry(async () => ai.models.generateContent({ model, contents: contentPrompt, config: { systemInstruction: systemPrompt, tools: [{ googleSearch: {} }] } }));
    let jsonText = response.text || "{\"fandom\": \"Unknown\", \"entities\": []}";
    if (jsonText.startsWith("```json")) { jsonText = jsonText.substring(7); if (jsonText.endsWith("```")) { jsonText = jsonText.slice(0, -3); } }
    return repairJson(jsonText.trim());
  } catch (e: any) { if (e.name === 'AbortError') throw e; throw new Error("Wiki scan failed."); }
};

export const analyzeWikiContent = async (input: string, category: WikiEntry['category'], model: string, signal: AbortSignal, mode: 'link' | 'text' | 'search' = 'link', modifiers?: string): Promise<{ content: string; fandom?: string }> => {
  let systemInstruction = "";
  
  if (category === 'Character') {
      systemInstruction = `
      You are an expert character profiler. Analyze the input and generate a highly detailed Character Dossier in the following STRICT MARKDOWN format.
      Do not include preamble. Use the emoji that best fits the character next to the title name.

      **FORMAT:**
      [Emoji] [Name]

      **Full Canon Name:** [Name]
      **Species:** [Species]
      **Age:** [Age/Unknown]
      **Fandom Origin:** [Source Material]
      **Pronouns:** [Pronouns]
      **Gender & Orientation:** [Gender / Sexual Orientation]
      **Status:** [Alive/Dead/Unknown + Current Status]

      **Nicknames/Aliases:** [List]

      **Appearance:**
      [Detailed description of physical appearance, clothing, and distinct features]

      **Backstory:**
      [Comprehensive summary of their history, trauma, and key plot points]

      **Personality:**
      [Deep dive into their psyche, behaviors, fears, and motivations]

      **Relationships:**
      * **[Name]:** [Relationship description]

      **Likes:**
      [List]

      **Dislikes:**
      [List]

      **Notes:**
      * **Mental Health:** [If applicable]
      * **Key Abilities:** [Powers/Skills]
      * **Lore Note:** [Trivia/Etymology]
      * **Inventory:** [Key items]
      `;
  } else {
      systemInstruction = `Analyze content regarding ${category}. Identify Fandom. Summarize details.`;
  }

  if (modifiers) systemInstruction += `\n\n**CRITICAL USER OVERRIDES:**\n${modifiers}`;
  let fullPrompt = mode === 'link' || mode === 'search' ? `${systemInstruction} \n\n Analyze content from search/link.` : `${systemInstruction} \n\n Analyze text.`;
  const ai = getAiClient();
  try {
    const response = await withRetry(async () => ai.models.generateContent({ model, contents: input, config: { systemInstruction: fullPrompt, tools: (mode === 'link' || mode === 'search') ? [{ googleSearch: {} }] : [] } }));
    let text = response.text || "";
    if (!text && (mode === 'link' || mode === 'search') && response.candidates?.[0]?.groundingMetadata?.groundingChunks) text = "Content extracted via search grounding.";
    const fandomMatch = text.match(/^FANDOM:\s*(.+)$/m) || text.match(/Fandom Origin:\s*(.+)$/m) || text.match(/\*\*Fandom Origin:\*\*\s*(.+)$/m);
    const contentMatch = text.match(/^CONTENT:\s*([\s\S]*)$/m);
    const fandom = fandomMatch ? fandomMatch[1].trim() : undefined;
    let content = contentMatch ? contentMatch[1].trim() : text;
    if (fandomMatch && !contentMatch && category !== 'Character') content = text.replace(fandomMatch[0], '').trim();
    return { content: content || "No content generated.", fandom: (fandom && fandom.toLowerCase() !== 'unknown') ? fandom : undefined };
  } catch (error: any) { if (error.name === 'AbortError') throw error; throw new Error("Analysis failed."); }
};

export const modifyEntryWithAI = async (name: string, content: string, instructions: string, model: string, signal: AbortSignal): Promise<{ name: string; content: string }> => {
    const systemPrompt = `You are a Lore Modification Engine. Rewrite based on instructions. **Original:** ${name}\n${content}\n**Instruction:** ${instructions}`;
    const ai = getAiClient();
    try {
        const response = await withRetry(async () => ai.models.generateContent({ model, contents: "Execute modification.", config: { systemInstruction: systemPrompt, responseMimeType: "application/json", responseSchema: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, content: { type: Type.STRING } }, required: ["name", "content"] } } }));
        return repairJson(response.text || "{}");
    } catch (e: any) { if (e.name === 'AbortError') throw e; throw e; }
};

export const generateScenarioHooks = async (fandom: string, type: RoleplayType, era: string, model: string, signal: AbortSignal): Promise<ScenarioHook[]> => {
    const ai = getAiClient();
    const systemPrompt = `You are a Fanfiction Scenario Generator. Generate 4 plot hooks. Fandom: ${fandom}, Type: ${type}, Era: ${era}. Output JSON array.`;
    try {
        const response = await withRetry(async () => ai.models.generateContent({ model, contents: "Generate hooks.", config: { systemInstruction: systemPrompt, responseMimeType: "application/json", responseSchema: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, premise: { type: Type.STRING }, hook: { type: Type.STRING } }, required: ["title", "premise", "hook"] } } } }));
        return repairJson(response.text || "[]");
    } catch (e: any) { if (e.name === 'AbortError') throw e; throw e; }
};

export const generateWorldMeta = async (config: SimulationSession['config'], entries: WikiEntry[], signal: AbortSignal, onProgress?: (progress: number) => void, currentMeta?: WorldMeta, enhancementModifier?: string, mode: WorldGenerationMode = WorldGenerationMode.Rewrite, targetSection?: 'timeline' | 'hierarchy' | 'integration'): Promise<WorldMeta> => {
  // ... implementation preserved ...
  const isNative = config.integrationMode === IntegrationMode.Native;
  const integrationInstruction = isNative ? `**CRITICAL - NATIVE INTEGRATION**: ${config.hostFandom}. Rewrite everything.` : `Integration Mode: ${config.integrationMode}. Conflict Resolution: ${config.conflictResolution}`;
  let prompt = `You are a Worldbuilding Engine. Task: Create Timeline, Hierarchy, Adaptations. Host: ${config.hostFandom}. Integration: ${integrationInstruction}. Rules: ${config.modifiers}.`;
  if (currentMeta) prompt += `\nEXISTING DATA: ${JSON.stringify(currentMeta)}`;
  if (enhancementModifier) prompt += `\nUSER INSTRUCTIONS: ${enhancementModifier}`;
  const ai = getAiClient();
  try {
    if (onProgress) onProgress(30);
    const response = await withRetry(async () => ai.models.generateContent({ model: config.model, contents: "Generate World Meta", config: { systemInstruction: prompt, responseMimeType: "application/json", responseSchema: { type: Type.OBJECT, properties: { timeline: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { era: { type: Type.STRING }, year: { type: Type.STRING }, description: { type: Type.STRING }, sourceFandom: { type: Type.STRING } } } }, hierarchy: { type: Type.OBJECT, properties: { Power: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { tierName: { type: Type.STRING }, entities: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, subtypes: { type: Type.ARRAY, items: { type: Type.STRING } } } } } } } }, Political: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { tierName: { type: Type.STRING }, entities: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, subtypes: { type: Type.ARRAY, items: { type: Type.STRING } } } } } } } }, Social: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { tierName: { type: Type.STRING }, entities: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, subtypes: { type: Type.ARRAY, items: { type: Type.STRING } } } } } } } }, Species: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { tierName: { type: Type.STRING }, entities: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, subtypes: { type: Type.ARRAY, items: { type: Type.STRING } } } } } } } } } }, entityAdaptationsList: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { entryId: { type: Type.STRING }, adaptedName: { type: Type.STRING }, role: { type: Type.STRING }, status: { type: Type.STRING }, whereabouts: { type: Type.STRING }, description: { type: Type.STRING } } } } } } } }));
    if (onProgress) onProgress(90);
    const parsed = repairJson(response.text || "{}");
    const adaptationsRecord: Record<string, AdaptedEntity> = {};
    if (parsed.entityAdaptationsList && Array.isArray(parsed.entityAdaptationsList)) { parsed.entityAdaptationsList.forEach((ad: AdaptedEntity) => { if (ad.entryId) adaptationsRecord[ad.entryId] = ad; }); }
    return { timeline: Array.isArray(parsed.timeline) ? parsed.timeline : [], hierarchy: (parsed.hierarchy && typeof parsed.hierarchy === 'object') ? parsed.hierarchy : {}, entityAdaptations: adaptationsRecord };
  } catch (e: any) { if (e.name === 'AbortError') throw e; throw e; }
};

export const adaptSingleEntity = async (entry: WikiEntry, config: SimulationSession['config'], prompt: string): Promise<AdaptedEntity> => {
    const ai = getAiClient();
    try {
        const systemPrompt = `You are a Character Adaptation Engine. Integration: ${config.integrationMode}. Host: ${config.hostFandom}. Task: Adapt "${entry.name}" per user instructions: "${prompt}".`;
        const response = await withRetry(async () => ai.models.generateContent({ model: config.model, contents: `Execute Adaptation for ${entry.name}`, config: { systemInstruction: systemPrompt, responseMimeType: "application/json", responseSchema: { type: Type.OBJECT, properties: { entryId: { type: Type.STRING }, adaptedName: { type: Type.STRING }, role: { type: Type.STRING }, status: { type: Type.STRING }, whereabouts: { type: Type.STRING }, description: { type: Type.STRING } }, required: ["adaptedName", "role", "status", "whereabouts", "description"] } } }));
        const parsed = repairJson(response.text || "{}");
        return { entryId: entry.id, adaptedName: parsed.adaptedName || entry.name, role: parsed.role || "Unknown", status: parsed.status || "Active", whereabouts: parsed.whereabouts || "Unknown", description: parsed.description || "No description generated." };
    } catch (e) { throw e; }
};

export const assistWorldLogic = async (section: 'timeline' | 'hierarchy' | 'integration', prompt: string, currentData: any, config: SimulationSession['config'], wikiEntries: WikiEntry[], signal: AbortSignal): Promise<any> => {
    const ai = getAiClient();
    const entityContext = wikiEntries.slice(0, 40).map(e => `[ID: ${e.id}] ${e.name}`).join('\n');
    let effectiveData = currentData;
    if (section === 'integration') {
        const existingMap = (currentData && typeof currentData === 'object') ? currentData : {};
        effectiveData = wikiEntries.map(entry => existingMap[entry.id] || { entryId: entry.id, adaptedName: entry.name, role: "Pending", status: "Pending", whereabouts: "Unknown", description: "Pending integration." });
    }
    const systemPrompt = `You are an AI World Logic Assistant. Target: ${section}. World: ${config.hostFandom}. Integration: ${config.integrationMode}. Rules: ${config.modifiers}. Instruction: "${prompt}". Current Data provided. Modify/Fill/Sort.`;
    
    // ... schema definition preserved ...
    let responseSchema;
    if (section === 'timeline') responseSchema = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { year: { type: Type.STRING }, era: { type: Type.STRING }, description: { type: Type.STRING }, sourceFandom: { type: Type.STRING } }, required: ["description", "sourceFandom"] } };
    else if (section === 'hierarchy') responseSchema = { type: Type.OBJECT, properties: { Power: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { tierName: {type: Type.STRING}, entities: {type: Type.ARRAY, items: {type: Type.OBJECT, properties: {name: {type:Type.STRING}, subtypes: {type:Type.ARRAY, items:{type:Type.STRING}}}}} } } }, Political: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { tierName: {type: Type.STRING}, entities: {type: Type.ARRAY, items: {type: Type.OBJECT, properties: {name: {type:Type.STRING}, subtypes: {type:Type.ARRAY, items:{type:Type.STRING}}}}} } } }, Social: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { tierName: {type: Type.STRING}, entities: {type: Type.ARRAY, items: {type: Type.OBJECT, properties: {name: {type:Type.STRING}, subtypes: {type:Type.ARRAY, items:{type:Type.STRING}}}}} } } }, Species: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { tierName: {type: Type.STRING}, entities: {type: Type.ARRAY, items: {type: Type.OBJECT, properties: {name: {type:Type.STRING}, subtypes: {type:Type.ARRAY, items:{type:Type.STRING}}}}} } } } } };
    else if (section === 'integration') responseSchema = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { entryId: { type: Type.STRING }, adaptedName: { type: Type.STRING }, role: { type: Type.STRING }, status: { type: Type.STRING }, whereabouts: { type: Type.STRING }, description: { type: Type.STRING } }, required: ["entryId", "adaptedName", "role", "status", "whereabouts", "description"] } };

    try {
        const response = await withRetry(async () => ai.models.generateContent({ model: config.model, contents: "Execute World Logic Modification", config: { systemInstruction: systemPrompt, responseMimeType: "application/json", responseSchema: responseSchema } }));
        let parsed = repairJson(response.text || (section === 'hierarchy' ? "{}" : "[]"));
        if (section === 'integration' && Array.isArray(parsed)) { const map: Record<string, AdaptedEntity> = {}; parsed.forEach((item: any) => { if (item.entryId) map[item.entryId] = item; }); return map; }
        return parsed;
    } catch (e: any) { if (e.name === 'AbortError') throw e; throw e; }
};

export const generateSmartTimelineEvents = async (prompt: string, currentTimeline: TimelineEvent[], config: SimulationSession['config'], wikiEntries: WikiEntry[], signal: AbortSignal): Promise<TimelineEvent[]> => assistWorldLogic('timeline', prompt, currentTimeline, config, wikiEntries, signal);
export const generateTimelineEvent = async (prompt: string, config: SimulationSession['config'], wikiEntries: WikiEntry[], signal: AbortSignal): Promise<{ year: string; era: string; description: string; sourceFandom: string }> => { const events = await generateSmartTimelineEvents(prompt, [], config, wikiEntries, signal); const evt = events[0]; return { year: evt?.year || "????", era: evt?.era || "Unknown", description: evt?.description || prompt, sourceFandom: evt?.sourceFandom || "Manual" }; };

// --- MAIN STORY GENERATION ---

export const generateSimulationBriefing = async (
    session: SimulationSession,
    signal: AbortSignal
): Promise<GenerationResult> => {
    const { config, wikiEntries, worldMeta } = session;

    let integrationInstruction = "";
    if (config.simulationType === SimulationType.SingleFandom) {
        integrationInstruction = `**MODE: SINGLE FANDOM ROLEPLAY** - Fandom: ${config.fandoms[0]} - Roleplay Type: ${config.roleplayType} - Era: ${config.timeEra || "Canonical"}`;
    } else if (config.simulationType === SimulationType.OriginalUniverse) {
        integrationInstruction = `**MODE: ORIGINAL UNIVERSE** - Genre: ${config.worldSeed?.genre} - Premise: ${config.worldSeed?.premise}`;
    } else {
         integrationInstruction = config.integrationMode === IntegrationMode.Native ? `**NATIVE INTEGRATION**: ${config.hostFandom}.` : `Integration Mode: ${config.integrationMode}`;
    }
    
    const adaptations = worldMeta?.entityAdaptations ? Object.values(worldMeta.entityAdaptations).map(a => `[ADAPTED ROLE] ${a.adaptedName}: ${a.role} at ${a.whereabouts}. (${a.description})`).join('\n') : "";

    const headerInstruction = config.showSceneHeaders 
        ? "**MANDATORY**: You MUST return a 'sceneHeader' object in the JSON with 'location', 'time' (specific clock time), and 'date' representing the starting moment." 
        : "";

    const systemPrompt = `
      You are the Gamemaster/Director for a simulation.
      **TASK:** Initialize the simulation by creating a compelling "Situation Overview".
      **Fandoms:** ${(config.fandoms || []).join(', ')}
      **Integration:** ${integrationInstruction}
      **ADAPTED ROLES:** ${adaptations}
      **Original Lore:** ${wikiEntries.map(e => `[${e.category}: ${e.name}]`).join(', ')}
      **Modifiers:** ${config.modifiers}

      **OUTPUT REQUIREMENTS:**
      1. World & Setting.
      2. The Cast.
      3. Inciting Incident.
      4. Call to action.
      
      ${headerInstruction}

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
                        suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
                        sceneHeader: { type: Type.OBJECT, properties: { location: {type: Type.STRING}, time: {type: Type.STRING}, date: {type: Type.STRING} } },
                    },
                    required: ["overviewText", "suggestions"]
                }
            }
        }));
        
        const usage: TokenUsage = { promptTokens: response.usageMetadata?.promptTokenCount || 0, responseTokens: response.usageMetadata?.candidatesTokenCount || 0, totalTokens: response.usageMetadata?.totalTokenCount || 0 };
        const json = repairJson(response.text || "{}");
        return { content: json.overviewText || "Briefing generation failed.", suggestions: json.suggestions || [], sceneHeader: json.sceneHeader, newKeyEvents: [{ description: "Simulation Begins", inStoryTime: "Prologue" }], usage };
    } catch (e: any) { if (e.name === 'AbortError') throw e; throw e; }
};

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
       integrationInstruction = `**SINGLE FANDOM MODE**: ${config.fandoms[0]} (${config.timeEra || 'Canonical'}). Roleplay Type: ${config.roleplayType}.`;
  } else if (config.simulationType === SimulationType.OriginalUniverse) {
       integrationInstruction = `**ORIGINAL UNIVERSE**: Setting: ${config.worldSeed?.genre}. Magic: ${config.worldSeed?.magicLevel}.`;
  } else {
       integrationInstruction = config.integrationMode === IntegrationMode.Native ? `**NATIVE INTEGRATION**: ${config.hostFandom}.` : `Integration Mode: ${config.integrationMode}`;
  }

  const toneString = config.tone === ToneType.CUSTOM ? config.customTone || 'Canon Compliant' : config.tone.replace(/_/g, ' ');
  const povString = config.narrativePOV ? config.narrativePOV.replace(/_/g, ' ').toLowerCase() : 'third person limited';
  const tenseString = config.narrativeTense ? config.narrativeTense.toLowerCase() : 'past';

  // ... (auto-detection logic preserved) ...
  const charAliasMap = new Map<string, string>();
  const allChars = wikiEntries.filter(e => e.category === 'Character');
  allChars.forEach(e => { getAliases(e).forEach(alias => charAliasMap.set(alias, e.id)); const adapted = worldMeta?.entityAdaptations?.[e.id]; if (adapted) { getAliases(adapted).forEach(alias => charAliasMap.set(alias, e.id)); } });
  const recentNodes = history.slice(-3);
  const contextText = (recentNodes.map(n => n.content).join(' ') + ' ' + newInput).toLowerCase();
  const autoDetectedIds = new Set<string>();
  if (allChars.length > 0) { charAliasMap.forEach((id, alias) => { const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const regex = new RegExp(`\\b${escapedAlias}\\b`, 'i'); if (regex.test(contextText)) { autoDetectedIds.add(id); } }); }
  if (config.simulationMode === SimulationMode.Actor && config.activeCharacterId) { autoDetectedIds.add(config.activeCharacterId); }
  const manualIds = new Set(sceneState?.activeCharacterIds || []);
  const finalActiveIds = new Set([...manualIds, ...autoDetectedIds]);
  const activeChars = allChars.filter(e => finalActiveIds.has(e.id));
  const activeStates = Object.values(characterStates || {}).filter(s => finalActiveIds.has(s.characterId));
  const activeConsequences = (consequences || []).filter(c => c.active);

  const characterBible = activeChars.length > 0 ? activeChars.map(e => {
        const state = activeStates.find(s => s.characterId === e.id);
        const adaptation = worldMeta?.entityAdaptations?.[e.id];
        const roleAssignment = config.roleAssignments?.find(r => r.characterId === e.id);
        const nicknames = getAliases(e).slice(1).join(', ');
        const stateStr = state ? `[CURRENT STATE: Stress=${state.stress}%, Emotion=${state.emotion}, Status=${state.notes}]` : "";
        let identityBlock = "";
        if (roleAssignment) { identityBlock = `**ASSIGNED NARRATIVE ROLE:** ${roleAssignment.roleName}\n- Description: ${roleAssignment.description || "N/A"}`; } else if (adaptation) { identityBlock = `**ADAPTED IDENTITY:**\n- Name: ${adaptation.adaptedName}\n- Role: ${adaptation.role}\n- Whereabouts: ${adaptation.whereabouts}\n- Status: ${adaptation.status}\n- Integration Description: ${adaptation.description}`; } else { identityBlock = `**IDENTITY:** Canon`; }
        return `### ACTIVE CHARACTER: ${e.name} (${e.fandom || 'Unknown'})\n**Aliases:** ${nicknames}\n${stateStr}\n${identityBlock}\n**CONSTITUTION:**\n${config.canonStrictness === CanonStrictness.Strict ? "- STRICT: Act exactly as canon." : "- FLEXIBLE."}\n**DYNAMIC VOICE:** ${config.canonStrictness === CanonStrictness.Flexible ? "Adapt to setting." : "Strict contrast."}\n**ORIGINAL DATA:**\n${e.content.substring(0, 5000)}`; 
    }).join('\n\n') : "No specific characters active. Use general lore.";
  
  const loreContext = wikiEntries.filter(e => e.category !== 'Character').map(e => { const ad = worldMeta?.entityAdaptations?.[e.id]; return `[${e.category}: ${e.name}] - ${ad ? `ADAPTED: ${ad.description}` : e.content.substring(0, 500)}`; }).join('\n');

  let pacingInstruction = "";
  switch(sceneState?.currentDirectorMode) {
      case DirectorMode.SlowBurn: pacingInstruction = "Pacing: Slow Burn. Focus on atmosphere."; break;
      case DirectorMode.HighTension: pacingInstruction = "Pacing: High Tension. Fast, visceral."; break;
      case DirectorMode.Chaotic: pacingInstruction = "Pacing: Chaotic. Confusion, sensory overload."; break;
      case DirectorMode.Minimalist: pacingInstruction = "Pacing: Minimalist. Concise."; break;
      default: pacingInstruction = "Pacing: Balanced."; break;
  }

  // Explicit instruction for Scene Headers based on config
  const sceneHeaderInstruction = config.showSceneHeaders 
    ? "**MANDATORY: You MUST return a 'sceneHeader' object in the JSON metadata with updated 'location', 'time' (e.g. 14:00), and 'date' matching the story progress.**"
    : "Do not generate a sceneHeader unless the scene changes drastically.";

  let systemPrompt = `You are an expert multifandom fanfiction author engine (AO3 style).
  **NARRATIVE CONTEXT:** Location: ${sceneState?.activeLocation || "Unknown"}. Director: ${pacingInstruction}. Tone: ${toneString}. Integration: ${integrationInstruction}.
  **CONSEQUENCES:** ${activeConsequences.map(c => `- ${c.name}: ${c.description}`).join('\n') || "None."}
  **ACTIVE CHARACTERS:** ${characterBible}
  **LORE:** ${loreContext}
  **Instructions:** Write in ${povString} POV, ${tenseString} tense. Maintain continuity. Output story text naturally.
  
  **RESPONSE FORMAT (STRICT):**
  1. Write STORY NARRATIVE directly.
  2. End with separator: \`---METADATA---\`
  3. Output JSON object after separator.
  
  JSON Schema:
  {
    "sceneHeader": { "location": "string", "time": "string", "date": "string" },
    "telltaleTags": ["string"],
    "suggestions": ["Action 1", "Action 2"],
    "choices": [{ "letter": "A", "text": "..." }],
    "newKeyEvents": [],
    "updatedCharacterStates": [ { "characterId": "...", "emotion": "...", "stress": 0-100, "notes": "..." } ],
    "newConsequences": [ { "id": "...", "name": "...", "description": "...", "severity": "Low|Medium|Critical", "active": true } ]
  }
  
  *Update character states based on the events of this segment.*
  ${sceneHeaderInstruction}
  *Generate \`telltaleTags\` for significant relationship shifts or character reactions.*
  `;

  if (config.simulationMode === SimulationMode.Actor) {
      const activeChar = session.wikiEntries.find(e => e.id === config.activeCharacterId)?.name || 'the player character';
      systemPrompt += `\n**MODE: ACTOR** User is **${activeChar}**. Provide 4 choices (A,B,C,D). Personality Driven.`;
  } else {
      systemPrompt += `\n**MODE: DIRECTOR** Provide 3 punchy recommended actions.`;
  }
  
  const prunedHistory = pruneHistory(history, 15);
  const contents = prunedHistory.map(m => ({ role: m.role, parts: [{ text: m.content }] }));
  contents.push({ role: 'user', parts: [{ text: newInput }] });

  const ai = getAiClient();
  try {
    const responseStream = await withRetry(async () => ai.models.generateContentStream({ model: config.model, contents: contents, config: { systemInstruction: systemPrompt, responseMimeType: "text/plain" } }));
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
                storyPart += text.substring(0, separatorIndex);
                if (onStreamText) onStreamText(storyPart);
                isMetadata = true;
                metadataJson += text.substring(separatorIndex + SEPARATOR.length);
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
        if (parts.length > 1) { storyPart = parts[0].trim(); metadataJson = parts[1].trim(); } else { storyPart = fullText; }
    }
    storyPart = storyPart.trim();
    try { if (metadataJson.trim()) { let cleanJson = metadataJson.replace(/```json/g, '').replace(/```/g, '').trim(); resultJson = repairJson(cleanJson); } } catch (e) { console.warn("Failed to parse metadata JSON from stream", e); }

    const usage: TokenUsage = { promptTokens: 0, responseTokens: 0, totalTokens: 0 };
    return { content: storyPart || "Error generating story.", suggestions: resultJson.suggestions, choices: resultJson.choices, sceneHeader: resultJson.sceneHeader, telltaleTags: resultJson.telltaleTags, newKeyEvents: resultJson.newKeyEvents || [], updatedCharacterStates: resultJson.updatedCharacterStates, newConsequences: resultJson.newConsequences, usage };
  } catch (error: any) { if (error.name === 'AbortError') throw error; throw error; }
};
