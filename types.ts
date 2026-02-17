
export enum SimulationMode {
  Director = 'DIRECTOR', // User types scenario, AI writes
  Actor = 'ACTOR' // User plays a character
}

export enum SimulationType {
  Multifandom = 'MULTIFANDOM',
  SingleFandom = 'SINGLE_FANDOM'
}

export enum RoleplayType {
  SelfInsert = 'SELF_INSERT',
  AURewrite = 'AU_REWRITE',
  CanonDivergence = 'CANON_DIVERGENCE',
  CanonCompliant = 'CANON_COMPLIANT'
}

export enum WorldType {
  Collision = 'COLLISION', // Worlds collide, culture shock
  Merged = 'MERGED' // History altered to fit together
}

export enum ToneType {
  CanonCompliant = 'CANON_COMPLIANT',
  DarkAngst = 'DARK_ANGST',
  Horror = 'HORROR',
  FluffComfort = 'FLUFF_COMFORT',
  CrackFic = 'CRACK_FIC',
  PoliticalThriller = 'POLITICAL_THRILLER',
  CUSTOM = 'CUSTOM'
}

export enum DirectorMode {
  Balanced = 'BALANCED',
  SlowBurn = 'SLOW_BURN',
  HighTension = 'HIGH_TENSION',
  Chaotic = 'CHAOTIC',
  Minimalist = 'MINIMALIST'
}

export enum CanonStrictness {
  Strict = 'STRICT', // Characters act exactly as canon
  Flexible = 'FLEXIBLE', // Slight deviations allowed for plot
  Divergent = 'DIVERGENT' // Characters rewritten for the setting
}

export enum PowerScaling {
  LoreAccurate = 'LORE_ACCURATE', // A god is a god. A human is a human.
  Balanced = 'BALANCED', // Nerfs OP characters so everyone matters.
  Narrative = 'NATIVE' // Power fluctuates based on plot needs.
}

export enum IntegrationMode {
  Portal = 'PORTAL', // Characters arrive via portal/rift (Collision). They know they are aliens.
  Native = 'NATIVE', // Characters are reimagined as natives. They have always lived here.
  Visitor = 'VISITOR' // Characters are traveling/displaced but keep original backstory (Road trip style).
}

export enum NarrativeStructure {
    CompactProse = 'COMPACT_PROSE', // Novel-style, long paragraphs
    ScriptLike = 'SCRIPT_LIKE' // More line breaks, script/chat style
}

export enum NarrativePOV {
  ThirdPersonLimited = 'THIRD_PERSON_LIMITED',
  ThirdPersonOmniscient = 'THIRD_PERSON_OMNISCIENT',
  FirstPerson = 'FIRST_PERSON',
  SecondPerson = 'SECOND_PERSON'
}

export enum NarrativeTense {
  Past = 'PAST',
  Present = 'PRESENT'
}

export enum WorldGenerationMode {
    MaintainAndFill = 'MAINTAIN_FILL', // Keep existing, add missing
    EnhanceOnly = 'ENHANCE_ONLY', // Improve descriptions, keep structure
    Rewrite = 'REWRITE' // Clear and regenerate
}

export interface WikiEntry {
  id: string;
  sourceUrl?: string;
  name: string;
  content: string; // The extracted/summarized content
  category: 'World' | 'Character' | 'Lore' | 'Facility' | 'Species' | 'Religion' | 'Country';
  fandom?: string;
  isSystem?: boolean; // For default entries like Humans
}

export interface CharacterRuntimeState {
  characterId: string;
  emotion: string; // e.g. "Anxious"
  stress: number; // 0-100
  notes: string; // Short transient status
}

export interface Consequence {
  id: string;
  name: string;
  description: string;
  severity: 'Low' | 'Medium' | 'Critical';
  active: boolean;
}

export interface SceneState {
  activeLocation: string;
  activeCharacterIds: string[]; // Only these chars are in context
  musicSuggestion?: string;
  currentDirectorMode: DirectorMode;
}

export interface RoleAssignment {
  roleName: string; // e.g. "The Protagonist", "The Rival"
  characterId: string; // WikiEntry ID
  description?: string; // e.g. "A brooding anti-hero version"
}

export interface SimulationConfig {
  title: string;
  simulationType: SimulationType; // NEW: Multi vs Single
  fandoms: string[];
  hostFandom?: string; // The primary setting/world that dominates physics/history
  worldType: WorldType;
  simulationMode: SimulationMode;
  activeCharacterId?: string; // If in Actor mode
  additionalTags: string[];
  modifiers: string; // User defined overrides
  
  // Single Fandom Specifics
  roleplayType?: RoleplayType;
  timeEra?: string; // e.g. "Modern Day", "1800s"
  roleAssignments?: RoleAssignment[]; // Map characters to archetypes

  // Advanced Engine Settings
  tone: ToneType;
  customTone?: string;
  canonStrictness: CanonStrictness;
  powerScaling: PowerScaling;
  integrationMode: IntegrationMode; // How characters fit into the world
  conflictResolution: string; // Rules for Tech vs Magic, etc.
  narrativeStructure: NarrativeStructure;
  narrativePOV: NarrativePOV;
  narrativeTense: NarrativeTense;
  model: string;
  showTelltaleIndicators: boolean;
}

// Telltale-style choice object
export interface TelltaleChoice {
  letter: 'A' | 'B' | 'C' | 'D';
  text: string;
}

// New Tree Node Interface
export interface StoryNode {
  id: string;
  parentId: string | null;
  childrenIds: string[];
  role: 'user' | 'model';
  content: string;
  timestamp: number;
  suggestions?: string[]; // For Director Mode
  choices?: TelltaleChoice[]; // For Actor Mode
  label?: string; // For marking branches (e.g., "Canon", "Dark Timeline")
}

export interface TimelineEvent {
  era: string;
  year?: string;
  description: string;
  sourceFandom?: string;
}

export interface NarrativeEvent {
  id: string;
  description: string;
  inStoryTime: string; // e.g. "Day 1, Afternoon"
  realTimestamp: number;
}

export interface HierarchyEntity {
    name: string;
    subtypes?: string[]; // For Sub-species/Race/Ethnicities
}

export interface HierarchyTier {
  tierName: string; // e.g., "Cosmic Entities", "Government", "Common Folk"
  entities: HierarchyEntity[];
}

export interface AdaptedEntity {
    entryId: string; // Links back to WikiEntry
    adaptedName: string; // e.g., "Sir Connor of Cyberlife"
    role: string; // e.g., "Royal Blacksmith"
    status: string; // e.g., "Exiled"
    whereabouts: string; // e.g., "The Iron Keep"
    description: string; // Short bio adapted to the world
}

export interface WorldMeta {
  timeline: TimelineEvent[];
  hierarchy: Record<string, HierarchyTier[]>; 
  entityAdaptations?: Record<string, AdaptedEntity>; // key is WikiEntry.id
}

export interface TokenUsage {
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
}

export interface SimulationSession {
  id: string;
  lastModified: number;
  config: SimulationConfig;
  wikiEntries: WikiEntry[];
  
  // New Tree Structure
  messageTree: Record<string, StoryNode>; 
  currentLeafId: string | null; // The end of the currently active branch

  worldMeta?: WorldMeta; // Generated world info
  narrativeEvents?: NarrativeEvent[]; // Key events that happened IN the story
  
  // State Tracking
  characterStates: Record<string, CharacterRuntimeState>; // id -> state
  consequences: Consequence[];
  sceneState: SceneState;

  status?: 'draft' | 'active'; // To distinguish drafts from active simulations
  
  usageStats?: TokenUsage; // Track API usage
}

export interface AppState {
  view: 'dashboard' | 'setup' | 'simulation' | 'building_world';
  simulations: SimulationSession[];
  currentSessionId: string | null;
  // Temporary Draft State for Setup
  draftConfig: SimulationConfig;
  draftWikiEntries: WikiEntry[];
  
  // World Logic History State
  draftWorldMetaHistory: WorldMeta[]; 
  draftWorldMetaIndex: number; 

  draftSessionId: string | null; // To track if we are editing an existing draft
  library: WikiEntry[]; // Saved bookmarks
  isGenerating: boolean;
  defaultModel: string;
}

export interface ScenarioHook {
    title: string;
    premise: string;
    hook: string;
}

export const MODEL_OPTIONS = [
  { 
    id: 'gemini-3-flash-preview', 
    label: 'Gemini 3.0 Flash', 
    desc: 'Fast, intelligent, and cost-effective. Best for standard roleplay.' 
  },
  { 
    id: 'gemini-3-pro-preview', 
    label: 'Gemini 3.0 Pro', 
    desc: 'High reasoning capabilities. Best for complex lore integration.' 
  },
  {
    id: 'gemini-2.0-flash',
    label: 'Gemini 2.0 Flash',
    desc: 'Legacy stable model.'
  }
];
