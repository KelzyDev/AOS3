import React, { useState, useEffect, useRef } from 'react';
import { AppState, SimulationMode, WorldType, SimulationSession, WikiEntry, SimulationConfig, WorldMeta, ToneType, CanonStrictness, PowerScaling, IntegrationMode, StoryNode, NarrativeStructure, HierarchyTier, DirectorMode, MODEL_OPTIONS, HierarchyEntity, AdaptedEntity, WorldGenerationMode, TimelineEvent, NarrativePOV, NarrativeTense, SimulationType, RoleplayType, ScenarioHook, RoleAssignment } from './types';
import { WikiImporter } from './components/WikiImporter';
import { SimulationReader } from './components/SimulationReader';
import { HoldToDeleteButton } from './components/HoldToDeleteButton';
import { TagInput } from './components/TagInput';
import { QuotaExhaustedModal } from './components/QuotaExhaustedModal';
import { DisclaimerModal } from './components/DisclaimerModal';
import { generateWorldMeta, assistWorldLogic, adaptSingleEntity, generateScenarioHooks, generateWorldGenesis } from './services/geminiService';
import { BookOpen, AlertCircle, Sparkles, PlusCircle, LayoutDashboard, Clock, Hammer, Globe, Eye, ArrowRight, ArrowLeft, List, Crown, Settings2, GitFork, MapPin, Download, Upload, Trash2, Save, Cpu, MessageSquare, Copy, Search, X, Loader2, Tag, Layers, Undo, Redo, Edit2, XCircle, Plus, Wand2, GripVertical, ChevronDown, User, Network, Trash, RefreshCw, Settings, Maximize2, Minimize2, Info, Users } from 'lucide-react';
import { useModalAccessibility } from './hooks/useModalAccessibility';

const LOCAL_STORAGE_KEY = 'ao3_sim_sessions';
const LIBRARY_STORAGE_KEY = 'ao3_sim_library';
const DRAFT_AUTOSAVE_KEY = 'ao3_sim_autosave_draft';
const SETTINGS_KEY = 'ao3_sim_settings';
const DISCLAIMER_KEY = 'ao3_sim_disclaimer_accepted';

const DEFAULT_SYSTEM_ENTRIES: WikiEntry[] = [
  {
    id: 'sys_human',
    name: 'Humans',
    category: 'Species',
    fandom: 'General',
    content: 'Baseline humanity. Non-anomalous, versatile, and widespread. Subject to the laws of physics unless modified by other lore.',
    isSystem: true
  },
  {
    id: 'sys_animal',
    name: 'Baseline Animals',
    category: 'Species',
    fandom: 'General',
    content: 'Standard Earth flora and fauna (dogs, cats, birds, etc.).',
    isSystem: true
  },
  {
    id: 'sys_history',
    name: 'Human History',
    category: 'Lore',
    fandom: 'General',
    content: 'Standard Earth history up to the divergence point. Includes major real-world wars, technological advancements, and cultural shifts.',
    isSystem: true
  },
  {
    id: 'sys_religion',
    name: 'Mainstream Religions',
    category: 'Religion',
    fandom: 'General',
    content: 'Major real-world belief systems including Christianity, Islam, Judaism, Hinduism, Buddhism, etc. existing as they do in our reality.',
    isSystem: true
  },
  {
    id: 'sys_countries',
    name: 'Major Nations',
    category: 'Country',
    fandom: 'General',
    content: 'United Nations recognized countries (USA, China, Russia, EU nations, etc.) with standard real-world borders and governments unless overwritten.',
    isSystem: true
  }
];

const INITIAL_DRAFT_CONFIG: SimulationConfig = {
  title: '',
  simulationType: SimulationType.Multifandom,
  fandoms: [],
  worldType: WorldType.Merged,
  simulationMode: SimulationMode.Director,
  additionalTags: [],
  modifiers: '',
  tone: ToneType.CanonCompliant,
  canonStrictness: CanonStrictness.Flexible,
  powerScaling: PowerScaling.Balanced,
  integrationMode: IntegrationMode.Portal,
  conflictResolution: '',
  narrativeStructure: NarrativeStructure.CompactProse,
  narrativePOV: NarrativePOV.ThirdPersonLimited,
  narrativeTense: NarrativeTense.Past,
  model: 'gemini-3-flash-preview',
  showTelltaleIndicators: true,
  showSceneHeaders: true,
  activeCharacterId: undefined,
  // Single Fandom Defaults
  roleplayType: RoleplayType.CanonDivergence,
  timeEra: '',
  roleAssignments: [],
  // Original Universe Defaults
  worldSeed: {
      genre: "High Fantasy",
      premise: "",
      magicLevel: "High",
      techLevel: "Medieval"
  }
};

// DETERMINISTIC EXTRACTOR HELPER
const extractDeterministicMeta = (entries: WikiEntry[]): WorldMeta => {
    const timeline: any[] = [];
    const hierarchy: Record<string, HierarchyTier[]> = {
        'Power': [
             { tierName: 'S-Tier (Cosmic/Gods)', entities: [] },
             { tierName: 'A-Tier (Superhuman)', entities: [] },
             { tierName: 'B-Tier (Elite)', entities: [] },
             { tierName: 'C-Tier (Standard)', entities: [] },
             { tierName: 'F-Tier (Civilian)', entities: [] },
        ],
        'Political': [
            { tierName: 'Ruling Class', entities: [] },
            { tierName: 'Influential', entities: [] },
            { tierName: 'Common', entities: [] },
        ]
    };

    const powerKeywords = {
        S: ['god', 'deity', 'cosmic', 'immortal', 'omnipotent', 'primordial'],
        A: ['superhuman', 'hero', 'villain', 'magic', 'cyborg', 'advanced'],
        B: ['soldier', 'veteran', 'elite', 'knight', 'captain'],
        C: ['human', 'citizen', 'average'],
        F: ['child', 'pet', 'weak']
    };

    const addEntity = (tierKey: string, index: number, name: string) => {
        if (!hierarchy[tierKey]) return;
        hierarchy[tierKey][index].entities.push({ name, subtypes: [] });
    };

    entries.forEach(entry => {
        // 1. Timeline Extraction (Regex for Years)
        // Improved regex to catch more date formats
        const yearMatches = entry.content.matchAll(/(?:in|year|date|born|founded|circa|est\.|since)\s*[:\s]?\s*(\d{4}|ancient|prehistoric|\d{1,2}(?:st|nd|rd|th)?\s+century)/gi);
        for (const match of yearMatches) {
            const yearStr = match[1];
            // Simple dedupe check
            if (!timeline.some(t => t.year === yearStr && t.description.includes(entry.name))) {
                let era = 'Historical';
                const yearNum = parseInt(yearStr);
                if (!isNaN(yearNum)) {
                     if (yearNum > 2050) era = 'Future';
                     else if (yearNum > 1900) era = 'Modern';
                } else if (yearStr.toLowerCase().includes('ancient') || yearStr.toLowerCase().includes('prehistoric')) {
                     era = 'Ancient';
                }

                timeline.push({
                    era: era,
                    year: yearStr,
                    description: `Key event involving ${entry.name}.`,
                    sourceFandom: entry.fandom || 'General'
                });
            }
        }

        // 2. Hierarchy Placement (Keyword Guessing)
        if (entry.category === 'Character' || entry.category === 'Species') {
            const contentLower = entry.content.toLowerCase();
            let placed = false;
            
            // Try S
            if (powerKeywords.S.some(k => contentLower.includes(k))) {
                addEntity('Power', 0, entry.name);
                placed = true;
            } else if (powerKeywords.A.some(k => contentLower.includes(k))) {
                addEntity('Power', 1, entry.name);
                placed = true;
            } else if (powerKeywords.B.some(k => contentLower.includes(k))) {
                 addEntity('Power', 2, entry.name);
                 placed = true;
            }
            
            if (!placed) {
                // Default to C if character
                addEntity('Power', 3, entry.name);
            }
        }
        
        if (entry.category === 'Country' || entry.category === 'Facility') {
             addEntity('Political', 1, entry.name);
        }
    });

    return { timeline: timeline.sort((a,b) => (parseInt(a.year)||0) - (parseInt(b.year)||0)), hierarchy, entityAdaptations: {} };
};

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    view: 'dashboard',
    simulations: [],
    currentSessionId: null,
    draftConfig: INITIAL_DRAFT_CONFIG,
    draftWikiEntries: [...DEFAULT_SYSTEM_ENTRIES],
    draftWorldMetaHistory: [],
    draftWorldMetaIndex: -1,
    draftSessionId: null,
    library: [],
    isGenerating: false,
    defaultModel: 'gemini-3-flash-preview',
  });
  
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [dashboardSearch, setDashboardSearch] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedImportSimId, setSelectedImportSimId] = useState<string | null>(null);
  
  // Disclaimer Modal State
  const [showDisclaimer, setShowDisclaimer] = useState(false);

  // Quota Modal State
  const [showQuotaModal, setShowQuotaModal] = useState(false);
  
  // World Preview UI State
  const [activeHierarchyTab, setActiveHierarchyTab] = useState<string>('Power');
  const [previewTab, setPreviewTab] = useState<'timeline' | 'hierarchy' | 'integration'>('integration');
  const [generationMode, setGenerationMode] = useState<WorldGenerationMode>(WorldGenerationMode.MaintainAndFill);
  
  // Specific Modifiers
  const [timelineModifier, setTimelineModifier] = useState('');
  const [hierarchyModifier, setHierarchyModifier] = useState('');
  const [integrationModifier, setIntegrationModifier] = useState('');

  // AI Assistant State
  const [showAiAssistant, setShowAiAssistant] = useState(false);
  const [aiAssistantPrompt, setAiAssistantPrompt] = useState('');
  const [isAiAssistantThinking, setIsAiAssistantThinking] = useState(false);

  // Manual Timeline Editing State
  const [isAddingEvent, setIsAddingEvent] = useState(false); // Only used for manual now
  const [newEventYear, setNewEventYear] = useState('');
  const [newEventDesc, setNewEventDesc] = useState('');
  const [editingTimelineIdx, setEditingTimelineIdx] = useState<number | null>(null);
  const [editTimelineDesc, setEditTimelineDesc] = useState('');
  
  // Integration Editing State
  const [viewingAdaptationId, setViewingAdaptationId] = useState<string | null>(null); // For the detailed menu
  const [editAdaptationValues, setEditAdaptationValues] = useState<AdaptedEntity | null>(null);
  const [aiAdaptPrompt, setAiAdaptPrompt] = useState('');
  const [isAiAdapting, setIsAiAdapting] = useState(false);
  
  // Drag and Drop State (Timeline/Entity)
  const [draggedTimelineIdx, setDraggedTimelineIdx] = useState<number | null>(null);
  const [draggedEntity, setDraggedEntity] = useState<{ name: string, sourceTierIdx: number } | null>(null);
  const [dragOverTierIdx, setDragOverTierIdx] = useState<number | null>(null); // For visual feedback
  
  // --- SINGLE FANDOM STATES ---
  const [scenarioHooks, setScenarioHooks] = useState<ScenarioHook[]>([]);
  const [isGeneratingHooks, setIsGeneratingHooks] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleCharId, setNewRoleCharId] = useState('');

  // --- ORIGINAL UNIVERSE STATES ---
  const [isGeneratingGenesis, setIsGeneratingGenesis] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsFileInputRef = useRef<HTMLInputElement>(null);
  const dashboardImportRef = useRef<HTMLInputElement>(null);
  const setupImportRef = useRef<HTMLInputElement>(null);
  
  // Logic Preview Abort Controller
  const previewAbortRef = useRef<AbortController | null>(null);
  
  const importModalRef = useModalAccessibility(showImportModal, () => setShowImportModal(false));
  const integrationDetailRef = useModalAccessibility(!!viewingAdaptationId, () => setViewingAdaptationId(null));

  const getCurrentWorldMeta = () => {
      if (state.draftWorldMetaIndex >= 0 && state.draftWorldMetaIndex < state.draftWorldMetaHistory.length) {
          return state.draftWorldMetaHistory[state.draftWorldMetaIndex];
      }
      return undefined;
  };

  // ... (useEffects preserved)
  useEffect(() => {
      if (state.view === 'setup' && state.draftWorldMetaHistory.length === 0 && state.draftWikiEntries.length > DEFAULT_SYSTEM_ENTRIES.length) {
           const deterministic = extractDeterministicMeta(state.draftWikiEntries);
           setState(prev => ({
               ...prev,
               draftWorldMetaHistory: [deterministic],
               draftWorldMetaIndex: 0
           }));
      }
  }, [state.draftWikiEntries, state.view]);

  // (Other useEffects from original code) ...
  useEffect(() => {
    const savedSessions = localStorage.getItem(LOCAL_STORAGE_KEY);
    const savedLibrary = localStorage.getItem(LIBRARY_STORAGE_KEY);
    const savedDraft = localStorage.getItem(DRAFT_AUTOSAVE_KEY);
    const savedSettings = localStorage.getItem(SETTINGS_KEY);
    
    // Check for Disclaimer acceptance
    const disclaimerAccepted = localStorage.getItem(DISCLAIMER_KEY);
    if (!disclaimerAccepted) {
        setShowDisclaimer(true);
    }
    
    let simulations: SimulationSession[] = [];
    let library: WikiEntry[] = [];
    let defaultModel = 'gemini-3-flash-preview'; // UPDATED DEFAULT

    if (savedSettings) {
        try {
            const parsedSettings = JSON.parse(savedSettings);
            if (parsedSettings.defaultModel) {
                defaultModel = parsedSettings.defaultModel;
            }
        } catch (e) { console.error("Failed to load settings", e); }
    }

    if (savedSessions) {
      try {
        const parsed = JSON.parse(savedSessions);
        simulations = parsed.map((sim: any) => {
            if (sim.messages && Array.isArray(sim.messages) && (!sim.messageTree || Object.keys(sim.messageTree).length === 0)) {
                const tree: Record<string, StoryNode> = {};
                let lastId: string | null = null;
                sim.messages.forEach((msg: any) => {
                    const nodeId = msg.id || crypto.randomUUID();
                    tree[nodeId] = { ...msg, id: nodeId, parentId: lastId, childrenIds: [] };
                    if (lastId && tree[lastId]) tree[lastId].childrenIds.push(nodeId);
                    lastId = nodeId;
                });
                return { 
                    ...sim, 
                    messageTree: tree, 
                    currentLeafId: lastId, 
                    messages: undefined,
                    characterStates: sim.characterStates || {},
                    consequences: sim.consequences || [],
                    sceneState: sim.sceneState || { activeLocation: "Loaded", activeCharacterIds: [], currentDirectorMode: DirectorMode.Balanced }
                };
            }
            const migratedConfig = { ...INITIAL_DRAFT_CONFIG, model: defaultModel, ...sim.config };
            if (sim.config.userCharacterId) { // Migration
                migratedConfig.activeCharacterId = sim.config.userCharacterId;
                delete migratedConfig.userCharacterId;
            }
            // Migrate hierarchy array to Record if needed
            let migratedWorldMeta = sim.worldMeta;
            if (migratedWorldMeta && Array.isArray(migratedWorldMeta.hierarchy)) {
                migratedWorldMeta.hierarchy = { 'Power': migratedWorldMeta.hierarchy };
            }
            // Migrate hierarchy strings to objects
            if (migratedWorldMeta && migratedWorldMeta.hierarchy) {
                Object.keys(migratedWorldMeta.hierarchy).forEach(key => {
                    migratedWorldMeta.hierarchy[key].forEach((tier: any) => {
                        if (tier.entities && tier.entities.length > 0 && typeof tier.entities[0] === 'string') {
                            tier.entities = tier.entities.map((e: string) => ({ name: e, subtypes: [] }));
                        }
                    });
                });
            }

            return { 
                ...sim, 
                config: migratedConfig, 
                worldMeta: migratedWorldMeta, 
                status: sim.status || 'active', 
                characterStates: sim.characterStates || {},
                consequences: sim.consequences || [],
                sceneState: sim.sceneState || { activeLocation: "Loaded", activeCharacterIds: [], currentDirectorMode: DirectorMode.Balanced }
            };
        });
      } catch (e) { console.error("Failed to load sessions", e); }
    }

    if (savedLibrary) {
        try { library = JSON.parse(savedLibrary); } 
        catch (e) { console.error("Failed to load library", e); }
    }
    
    const initialDraftConfig = { ...INITIAL_DRAFT_CONFIG, model: defaultModel };

    if (savedDraft) {
        try {
            if (window.confirm("You have an unsaved simulation draft. Would you like to restore it?")) {
                const { draftConfig, draftWikiEntries, draftWorldMetaHistory } = JSON.parse(savedDraft);
                const mergedConfig = { ...initialDraftConfig, ...draftConfig };
                // Restore World Meta History if it exists
                const restoredHistory = draftWorldMetaHistory || [];
                
                setState(prev => ({ 
                    ...prev, 
                    simulations, 
                    library, 
                    defaultModel, 
                    draftConfig: mergedConfig, 
                    draftWikiEntries,
                    draftWorldMetaHistory: restoredHistory,
                    draftWorldMetaIndex: restoredHistory.length > 0 ? restoredHistory.length - 1 : -1,
                    view: 'setup' 
                }));
            } else {
                localStorage.removeItem(DRAFT_AUTOSAVE_KEY);
                setState(prev => ({ ...prev, simulations, library, defaultModel, draftConfig: initialDraftConfig }));
            }
        } catch(e) {
             console.error("Failed to restore draft", e);
             localStorage.removeItem(DRAFT_AUTOSAVE_KEY);
             setState(prev => ({ ...prev, simulations, library, defaultModel, draftConfig: initialDraftConfig }));
        }
    } else {
        setState(prev => ({ ...prev, simulations, library, defaultModel, draftConfig: initialDraftConfig }));
    }
  }, []);

  useEffect(() => {
    try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state.simulations));
        localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(state.library));
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ defaultModel: state.defaultModel }));
    } catch(e) {
        console.error("Failed to save to localStorage", e);
    }
  }, [state.simulations, state.library, state.defaultModel]);
  
  useEffect(() => {
    if (state.view === 'setup') {
        const autoSaveData = {
            draftConfig: state.draftConfig,
            draftWikiEntries: state.draftWikiEntries,
            draftWorldMetaHistory: state.draftWorldMetaHistory // PERSIST WORLD META HISTORY
        };
        try {
            localStorage.setItem(DRAFT_AUTOSAVE_KEY, JSON.stringify(autoSaveData));
        } catch(e) {
            console.error("Failed to autosave draft", e);
        }
    }
  }, [state.draftConfig, state.draftWikiEntries, state.draftWorldMetaHistory, state.view]);


  const updateDraftConfig = (key: keyof SimulationConfig, value: any) => {
    setState(prev => ({
      ...prev,
      draftConfig: { ...prev.draftConfig, [key]: value },
    }));
  };

  const handleUpdateEntry = (updated: WikiEntry) => {
    setState(prev => ({
        ...prev,
        draftWikiEntries: prev.draftWikiEntries.map(e => e.id === updated.id ? updated : e),
    }));
  };

  const handleRemoveEntry = (id: string) => {
    setState(prev => ({
        ...prev,
        draftWikiEntries: prev.draftWikiEntries.filter(e => e.id !== id),
    }));
  };
  
  const handleReorderEntry = (draggedId: string, targetId: string) => {
      setState(prev => {
          const entries = [...prev.draftWikiEntries];
          const draggedIdx = entries.findIndex(e => e.id === draggedId);
          const targetIdx = entries.findIndex(e => e.id === targetId);
          
          if (draggedIdx === -1 || targetIdx === -1) return prev;
          
          const [removed] = entries.splice(draggedIdx, 1);
          entries.splice(targetIdx, 0, removed);
          
          return { ...prev, draftWikiEntries: entries };
      });
  };

  const handleClearAllEntries = () => {
      setState(prev => ({ ...prev, draftWikiEntries: [] }));
  };

  const handleRestoreDefaults = () => {
      setState(prev => {
          const existingIds = new Set(prev.draftWikiEntries.map(e => e.id));
          const missingDefaults = DEFAULT_SYSTEM_ENTRIES.filter(e => !existingIds.has(e.id));
          return { ...prev, draftWikiEntries: [...prev.draftWikiEntries, ...missingDefaults] };
      });
  };

  const handleAddToLibrary = (entry: WikiEntry) => {
    setState(prev => {
        if (prev.library.some(e => e.id === entry.id)) return prev;
        return { ...prev, library: [...prev.library, entry] };
    });
  };

  const handleRemoveFromLibrary = (id: string) => {
      setState(prev => ({ ...prev, library: prev.library.filter(e => e.id !== id) }));
  };
  
  // Accept Disclaimer Logic
  const handleAcceptDisclaimer = () => {
      localStorage.setItem(DISCLAIMER_KEY, 'true');
      setShowDisclaimer(false);
  };

  // World Logic: Generation & History Management
  
  const cancelPreviewGeneration = () => {
      if (previewAbortRef.current) {
          previewAbortRef.current.abort();
          previewAbortRef.current = null;
      }
      setState(prev => ({ ...prev, isGenerating: false }));
      setLoadingProgress(0);
  };

  const handlePreviewWorld = async (targetSection?: 'timeline' | 'hierarchy' | 'integration') => {
    if (state.draftConfig.fandoms.length === 0 || state.draftWikiEntries.length <= 2) {
        alert("Please add at least one Fandom and one Wiki Entry/Lore to preview.");
        return;
    }
    
    // Cancel any ongoing generation
    cancelPreviewGeneration();

    setState(prev => ({ ...prev, isGenerating: true }));
    setLoadingProgress(0);
    
    const controller = new AbortController();
    previewAbortRef.current = controller;

    // Get current context if it exists to pass for enhancement
    const contextMeta = getCurrentWorldMeta();

    // Determine correct modifier based on target section
    let appliedModifier = '';
    if (targetSection === 'timeline') appliedModifier = timelineModifier;
    else if (targetSection === 'hierarchy') appliedModifier = hierarchyModifier;
    else if (targetSection === 'integration') appliedModifier = integrationModifier;
    else appliedModifier = [timelineModifier, hierarchyModifier, integrationModifier].filter(m => m).join('\n');


    try {
        const worldMeta = await generateWorldMeta(
            state.draftConfig, 
            state.draftWikiEntries, 
            controller.signal,
            (p) => setLoadingProgress(p),
            contextMeta, // Pass current state
            appliedModifier, // Pass user modifier
            generationMode, // Pass current generation mode
            targetSection // Pass specific target if any
        );
        
        // Strict Validation & Parsing
        const validatedMeta: WorldMeta = {
            timeline: Array.isArray(worldMeta.timeline) ? worldMeta.timeline : [],
            hierarchy: (worldMeta.hierarchy && typeof worldMeta.hierarchy === 'object') ? worldMeta.hierarchy : {},
            entityAdaptations: worldMeta.entityAdaptations || {}
        };
        
        // Merge if targeting specific section to prevent data loss (AI returns minimal if targeted)
        if (targetSection && contextMeta) {
             if (targetSection === 'timeline') {
                 validatedMeta.hierarchy = contextMeta.hierarchy;
                 validatedMeta.entityAdaptations = contextMeta.entityAdaptations;
             } else if (targetSection === 'hierarchy') {
                 validatedMeta.timeline = contextMeta.timeline;
                 validatedMeta.entityAdaptations = contextMeta.entityAdaptations;
             } else if (targetSection === 'integration') {
                 validatedMeta.timeline = contextMeta.timeline;
                 validatedMeta.hierarchy = contextMeta.hierarchy;
             }
        }
        
        // Add to history
        setState(prev => {
            const newHistory = [...prev.draftWorldMetaHistory.slice(0, prev.draftWorldMetaIndex + 1), validatedMeta];
            return {
                ...prev,
                draftWorldMetaHistory: newHistory,
                draftWorldMetaIndex: newHistory.length - 1,
                isGenerating: false
            };
        });
        
        // Reset hierarchy tab to first key
        const keys = Object.keys(validatedMeta.hierarchy);
        setActiveHierarchyTab(keys.length > 0 ? keys[0] : 'Power');

        // Clear only used modifiers
        if (targetSection === 'timeline') setTimelineModifier('');
        else if (targetSection === 'hierarchy') setHierarchyModifier('');
        else if (targetSection === 'integration') setIntegrationModifier('');
        else {
            setTimelineModifier('');
            setHierarchyModifier('');
            setIntegrationModifier('');
        }

    } catch (e: any) {
        if (e.name !== 'AbortError') {
            if (e.message && (e.message.includes('429') || e.message.includes('Resource has been exhausted'))) {
               setShowQuotaModal(true);
            } else {
               console.error(e);
               alert("Failed to enhance world preview. Please check your connection and try again.");
            }
        }
        setState(prev => ({ ...prev, isGenerating: false }));
    } finally {
        previewAbortRef.current = null;
        setLoadingProgress(0);
    }
  };

  const handleClearSection = (section: 'timeline' | 'hierarchy' | 'integration') => {
      // Logic only, no window.confirm. The HoldButton component handles visual confirmation.
      const current = getCurrentWorldMeta();
      if (!current) return;
      
      const updates: Partial<WorldMeta> = {};
      
      if (section === 'timeline') {
          updates.timeline = [];
      } else if (section === 'hierarchy') {
          const cleanedHierarchy = { ...current.hierarchy };
          Object.keys(cleanedHierarchy).forEach(k => {
              if(cleanedHierarchy[k]) {
                  cleanedHierarchy[k] = cleanedHierarchy[k].map(t => ({ ...t, entities: [] }));
              }
          });
          updates.hierarchy = cleanedHierarchy;
      } else if (section === 'integration') {
          updates.entityAdaptations = {};
      }
      
      updateWorldMeta({ ...current, ...updates });
  };
  
  const handleClearSingleAdaptation = (entryId: string) => {
       const current = getCurrentWorldMeta();
       if (!current) return;
       
       const newAdaptations = { ...current.entityAdaptations };
       if (newAdaptations[entryId]) {
           delete newAdaptations[entryId];
           updateWorldMeta({ ...current, entityAdaptations: newAdaptations });
       }
  };

  const handleWorldHistoryNav = (direction: 'prev' | 'next') => {
      setState(prev => {
          const newIndex = direction === 'prev' ? Math.max(0, prev.draftWorldMetaIndex - 1) : Math.min(prev.draftWorldMetaHistory.length - 1, prev.draftWorldMetaIndex + 1);
          return { ...prev, draftWorldMetaIndex: newIndex };
      });
  };
  
  const updateWorldMeta = (newMeta: WorldMeta) => {
       setState(prev => {
           const historyClone = [...prev.draftWorldMetaHistory];
           historyClone[prev.draftWorldMetaIndex] = newMeta;
           return { ...prev, draftWorldMetaHistory: historyClone };
      });
  };

  // ... (rest of methods preserved) ...
  const handleSaveAdaptation = () => {
      if (!viewingAdaptationId || !editAdaptationValues) return;
      const current = getCurrentWorldMeta();
      if (!current) return;
      
      const newAdaptations = { ...current.entityAdaptations };
      newAdaptations[viewingAdaptationId] = editAdaptationValues;
      
      updateWorldMeta({ ...current, entityAdaptations: newAdaptations });
      // Don't close modal here, allow continued editing or explicit close
  };
  
  const handleAiAdapt = async () => {
      if (!viewingAdaptationId) return;
      const entry = state.draftWikiEntries.find(e => e.id === viewingAdaptationId);
      if (!entry) return;
      
      setIsAiAdapting(true);
      try {
          const adapted = await adaptSingleEntity(entry, state.draftConfig, aiAdaptPrompt);
          setEditAdaptationValues(adapted);
          setAiAdaptPrompt('');
      } catch (e: any) {
           console.error(e);
           alert("Adaptation failed.");
      } finally {
          setIsAiAdapting(false);
      }
  };

  // --- MANUAL WORLD EDITING & DND ---
  
  const handleMoveEntity = (entityName: string, targetTierIdx: number) => {
      const current = getCurrentWorldMeta();
      if (!current) return;
      
      const newHierarchy = JSON.parse(JSON.stringify(current.hierarchy));
      const tiers = newHierarchy[activeHierarchyTab];
      
      if (!tiers) return;

      // Find the entity object in any tier
      let entityObj: HierarchyEntity = { name: entityName, subtypes: [] };
      
      // Remove from old tier(s)
      tiers.forEach((tier: any) => {
          const idx = tier.entities.findIndex((e: any) => e.name === entityName);
          if (idx !== -1) {
              entityObj = tier.entities[idx];
              tier.entities.splice(idx, 1);
          }
      });
      
      // Add to new tier if valid index
      if (tiers[targetTierIdx]) {
        tiers[targetTierIdx].entities.push(entityObj);
      }
      
      updateWorldMeta({ ...current, hierarchy: newHierarchy });
  };
  
  const handleDeleteTierEntity = (tierIdx: number, entityIdx: number) => {
       const current = getCurrentWorldMeta();
       if (!current) return;
       const newHierarchy = JSON.parse(JSON.stringify(current.hierarchy));
       const tiers = newHierarchy[activeHierarchyTab];
       if (!tiers) return;
       tiers[tierIdx].entities.splice(entityIdx, 1);
       updateWorldMeta({ ...current, hierarchy: newHierarchy });
  };

  // DnD: Hierarchy Entity
  const onDragStartEntity = (e: React.DragEvent, name: string, tierIdx: number) => {
      setDraggedEntity({ name, sourceTierIdx: tierIdx });
      e.dataTransfer.effectAllowed = 'move';
  };

  const onDropEntityOnTier = (e: React.DragEvent, targetTierIdx: number) => {
      e.preventDefault();
      setDragOverTierIdx(null);
      if (draggedEntity) {
          handleMoveEntity(draggedEntity.name, targetTierIdx);
          setDraggedEntity(null);
      }
  };

  // DnD: Timeline Event
  const onDragStartTimeline = (e: React.DragEvent, index: number) => {
      setDraggedTimelineIdx(index);
      e.dataTransfer.effectAllowed = 'move';
  };

  const onDropTimeline = (e: React.DragEvent, targetIndex: number) => {
      e.preventDefault();
      setDragOverTierIdx(null);
      
      if (draggedTimelineIdx === null) return;
      
      // FIX: Ensure state is cleared even if returning early
      if (draggedTimelineIdx === targetIndex) {
          setDraggedTimelineIdx(null);
          return;
      }
      
      const current = getCurrentWorldMeta();
      if (!current) {
          setDraggedTimelineIdx(null);
          return;
      }
      
      const newTimeline = [...current.timeline];
      const [removed] = newTimeline.splice(draggedTimelineIdx, 1);
      newTimeline.splice(targetIndex, 0, removed);
      
      updateWorldMeta({ ...current, timeline: newTimeline });
      setDraggedTimelineIdx(null);
  };

  // Ensure drag cleanup on end
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const onDragEndTimeline = () => {
      setDraggedTimelineIdx(null);
      setDragOverTierIdx(null);
  }

  const handleAddTimelineEvent = () => {
      if (!newEventDesc.trim()) return;
      
      const current = getCurrentWorldMeta();
      if (!current) return;
      
      const newEvent = {
          era: parseInt(newEventYear) > 2000 ? 'Modern' : 'Historical',
          year: newEventYear,
          description: newEventDesc,
          sourceFandom: 'Manual'
      };
      
      const newTimeline = [...current.timeline, newEvent];
      updateWorldMeta({ ...current, timeline: newTimeline });
      
      setNewEventYear('');
      setNewEventDesc('');
      setIsAddingEvent(false);
  };
  
  // --- AI World Logic Assistant ---
  
  const handleAiAssist = async () => {
      if (!aiAssistantPrompt.trim()) return;
      
      const current = getCurrentWorldMeta();
      if (!current) return;
      
      setIsAiAssistantThinking(true);
      const controller = new AbortController();
      
      try {
          let targetData: any = null;
          if (previewTab === 'timeline') targetData = current.timeline;
          else if (previewTab === 'hierarchy') targetData = current.hierarchy;
          else if (previewTab === 'integration') targetData = current.entityAdaptations;

          // Call Generic Service
          const result = await assistWorldLogic(
              previewTab,
              aiAssistantPrompt,
              targetData,
              state.draftConfig,
              state.draftWikiEntries,
              controller.signal
          );
          
          if (!result) {
              alert("AI operation returned no result.");
              return;
          }

          // Merge result back into meta
          const newMeta = { ...current };
          if (previewTab === 'timeline') {
              newMeta.timeline = Array.isArray(result) ? result : current.timeline;
              // Ensure chrono sort after AI op
              newMeta.timeline.sort((a,b) => (parseInt(a.year)||0) - (parseInt(b.year)||0));
          } else if (previewTab === 'hierarchy') {
              newMeta.hierarchy = (result && typeof result === 'object') ? result : current.hierarchy;
          } else if (previewTab === 'integration') {
              newMeta.entityAdaptations = result;
          }
          
          updateWorldMeta(newMeta);
          setAiAssistantPrompt('');
          // AI Assistant stays open for follow-up prompts

      } catch (e: any) {
          console.error(e);
          if (e.message && (e.message.includes('429') || e.message.includes('Resource has been exhausted'))) {
               setShowQuotaModal(true);
          } else {
               alert("AI Assistant failed.");
          }
      } finally {
          setIsAiAssistantThinking(false);
      }
  };
  
  // --- NEW AUTO ENHANCE FUNCTION ---
  const handleAutoEnhance = async (section: 'timeline' | 'hierarchy' | 'integration') => {
      const current = getCurrentWorldMeta();
      if (!current) return;
      
      const prompt = `
        Review the current ${section} data.
        1. **FILL GAPS**: The input list may contain items marked "Pending". You MUST generate unique logic for these based on the Wiki Entries.
        2. **ENHANCE**: Improve descriptions to match the '${state.draftConfig.tone}' tone and '${state.draftConfig.hostFandom || 'Hybrid'}' setting.
        3. **CONSISTENCY**: Ensure it aligns with World Rules: "${state.draftConfig.modifiers || 'None'}".
        4. ${section === 'timeline' ? "Ensure dates flow logically and cover key events." : ""}
        5. ${section === 'hierarchy' ? "Ensure power tiers are balanced according to '" + state.draftConfig.powerScaling + "'." : ""}
        6. ${section === 'integration' ? "Ensure every entity has a defined Role, Status, and immersive Description." : ""}
      `;
      
      setIsAiAssistantThinking(true);
      const controller = new AbortController();
      previewAbortRef.current = controller;
      
      try {
           let targetData: any = null;
          if (section === 'timeline') targetData = current.timeline;
          else if (section === 'hierarchy') targetData = current.hierarchy;
          else if (section === 'integration') targetData = current.entityAdaptations;

          const result = await assistWorldLogic(
              section,
              prompt,
              targetData,
              state.draftConfig,
              state.draftWikiEntries,
              controller.signal
          );
          
          if (result) {
              const newMeta = { ...current };
               if (section === 'timeline') {
                  newMeta.timeline = Array.isArray(result) ? result : current.timeline;
                  newMeta.timeline.sort((a,b) => (parseInt(a.year)||0) - (parseInt(b.year)||0));
              } else if (section === 'hierarchy') {
                  newMeta.hierarchy = (result && typeof result === 'object') ? result : current.hierarchy;
              } else if (section === 'integration') {
                  newMeta.entityAdaptations = result;
              }
              updateWorldMeta(newMeta);
          }
      } catch (e) {
          console.error("Auto Enhance Failed", e);
          alert("Auto-Enhance failed.");
      } finally {
          setIsAiAssistantThinking(false);
          previewAbortRef.current = null;
      }
  };

  const handleEditTimelineEvent = () => {
      if (editingTimelineIdx === null || !editTimelineDesc.trim()) return;
      const current = getCurrentWorldMeta();
      if (!current) return;
      
      const newTimeline = [...current.timeline];
      newTimeline[editingTimelineIdx] = { ...newTimeline[editingTimelineIdx], description: editTimelineDesc };
      updateWorldMeta({ ...current, timeline: newTimeline });
      setEditingTimelineIdx(null);
  };
  
  const handleDeleteTimelineEvent = (idx: number) => {
       const current = getCurrentWorldMeta();
       if (!current) return;
       const newTimeline = current.timeline.filter((_, i) => i !== idx);
       updateWorldMeta({ ...current, timeline: newTimeline });
  };
  
  // ... (rest of methods preserved) ...
  const handleAddRole = () => {
      if (!newRoleName.trim() || !newRoleCharId) return;
      
      const currentRoles = state.draftConfig.roleAssignments || [];
      const newRole: RoleAssignment = {
          roleName: newRoleName,
          characterId: newRoleCharId,
          description: "Assigned by User"
      };
      
      updateDraftConfig('roleAssignments', [...currentRoles, newRole]);
      setNewRoleName('');
      setNewRoleCharId('');
  };

  const handleRemoveRole = (idx: number) => {
      const currentRoles = state.draftConfig.roleAssignments || [];
      updateDraftConfig('roleAssignments', currentRoles.filter((_, i) => i !== idx));
  };
  
  const handleGenerateHooks = async () => {
      const fandom = state.draftConfig.fandoms[0];
      if (!fandom) { alert("Please import or set a Fandom first."); return; }
      
      setIsGeneratingHooks(true);
      const controller = new AbortController();
      
      try {
          const hooks = await generateScenarioHooks(
              fandom, 
              state.draftConfig.roleplayType || RoleplayType.CanonDivergence,
              state.draftConfig.timeEra || "Canonical",
              state.draftConfig.model,
              controller.signal
          );
          setScenarioHooks(hooks);
      } catch (e: any) {
          console.error(e);
          alert("Failed to generate scenarios.");
      } finally {
          setIsGeneratingHooks(false);
      }
  };
  
  const handleSelectHook = (hook: ScenarioHook) => {
      updateDraftConfig('modifiers', `SCENARIO: ${hook.title}\nPREMISE: ${hook.premise}\nSTART: ${hook.hook}`);
      updateDraftConfig('title', hook.title);
  };

  const handleExecuteGenesis = async () => {
      if (!state.draftConfig.worldSeed?.premise) { alert("Please define a Premise first."); return; }
      setIsGeneratingGenesis(true);
      const controller = new AbortController();
      
      try {
          const entries = await generateWorldGenesis(state.draftConfig.worldSeed, state.draftConfig.model, controller.signal);
          // Replace draft entries with generated ones
          setState(prev => ({ ...prev, draftWikiEntries: entries }));
      } catch(e: any) {
          console.error(e);
          alert("Genesis Failed. Try again.");
      } finally {
          setIsGeneratingGenesis(false);
      }
  };

  const resetDraft = () => {
      localStorage.removeItem(DRAFT_AUTOSAVE_KEY);
      cancelPreviewGeneration(); // Ensure no background process
      return {
          draftConfig: { ...INITIAL_DRAFT_CONFIG, model: state.defaultModel },
          draftWikiEntries: [...DEFAULT_SYSTEM_ENTRIES],
          draftWorldMetaHistory: [],
          draftWorldMetaIndex: -1,
          draftSessionId: null
      };
  };

  const handleSaveDraft = () => {
      const currentMeta = getCurrentWorldMeta();
      const draftData = {
          config: state.draftConfig,
          wikiEntries: state.draftWikiEntries,
          worldMeta: currentMeta, // PERSIST CURRENT META IN DRAFT
          lastModified: Date.now()
      };
      
      let newSimulations = [...state.simulations];
      if (state.draftSessionId) {
          newSimulations = newSimulations.map(sim => 
              sim.id === state.draftSessionId ? { ...sim, ...draftData } : sim
          );
      } else {
          const newDraft: SimulationSession = {
              id: crypto.randomUUID(),
              messageTree: {},
              currentLeafId: null,
              ...draftData,
              status: 'draft',
              characterStates: {},
              consequences: [],
              sceneState: { activeLocation: "Draft", activeCharacterIds: [], currentDirectorMode: DirectorMode.Balanced }
          };
          newSimulations = [newDraft, ...newSimulations];
      }
      
      setState(prev => ({ ...prev, simulations: newSimulations, view: 'dashboard', ...resetDraft() }));
  };

  const handleCreateSimulation = async () => {
    // Validation
    if (state.draftConfig.simulationType === SimulationType.OriginalUniverse) {
        if (!state.draftConfig.worldSeed?.premise) { alert("Please define a World Seed Premise."); return; }
        if (state.draftWikiEntries.length === 0) { alert("Please Execute Genesis first to generate the world lore."); return; }
    } else {
        if (state.draftConfig.fandoms.length === 0 && !state.draftConfig.hostFandom) { alert("Please add at least one Fandom or define a Custom Host Setting."); return; }
    }
    
    // For single fandom and original mode, enforce native integration
    if (state.draftConfig.simulationType === SimulationType.SingleFandom || state.draftConfig.simulationType === SimulationType.OriginalUniverse) {
        updateDraftConfig('integrationMode', IntegrationMode.Native);
        updateDraftConfig('worldType', WorldType.Merged);
    }

    let worldMeta = getCurrentWorldMeta();
    
    if (!worldMeta) {
         // Fallback: Use deterministic meta if none exists
         worldMeta = extractDeterministicMeta(state.draftWikiEntries);
    }

    const sessionData = {
        config: state.draftConfig,
        wikiEntries: state.draftWikiEntries,
        worldMeta,
        lastModified: Date.now(),
        status: 'active' as const,
        messageTree: {},
        currentLeafId: null,
        narrativeEvents: [],
        characterStates: {},
        consequences: [],
        sceneState: { activeLocation: "Start", activeCharacterIds: [], currentDirectorMode: DirectorMode.Balanced }
    };
    
    let sessionId = state.draftSessionId;
    let newSimulations = [...state.simulations];

    if (sessionId) { // Upgrading a draft
        newSimulations = newSimulations.map(sim => sim.id === sessionId ? { ...sim, ...sessionData } : sim);
    } else { // Creating a new session
        sessionId = crypto.randomUUID();
        newSimulations = [{ id: sessionId, ...sessionData }, ...newSimulations];
    }
    
    if (!worldMeta) await new Promise(r => setTimeout(r, 500));

    setState(prev => ({
      ...prev,
      simulations: newSimulations,
      currentSessionId: sessionId,
      view: 'simulation',
      ...resetDraft()
    }));
  };

  const handleOpenSimulation = (id: string) => {
    setState(prev => ({ ...prev, currentSessionId: id, view: 'simulation' }));
  };

  const handleEditDraft = (session: SimulationSession) => {
      const history = session.worldMeta ? [session.worldMeta] : [];
      setState(prev => ({
          ...prev,
          view: 'setup',
          draftConfig: session.config,
          draftWikiEntries: session.wikiEntries,
          draftSessionId: session.id,
          draftWorldMetaHistory: history,
          draftWorldMetaIndex: history.length > 0 ? 0 : -1,
      }));
  };

  const handleUpdateCurrentSession = (updates: Partial<SimulationSession>) => {
    setState(prev => ({
      ...prev,
      simulations: prev.simulations.map(sim => sim.id === prev.currentSessionId ? { ...sim, ...updates, lastModified: Date.now() } : sim)
    }));
  };

  const handleForkSession = (messageIndex: number) => {
    const currentSession = state.simulations.find(s => s.id === state.currentSessionId);
    if (!currentSession) return;
    
    const history: StoryNode[] = [];
    if (currentSession.messageTree && currentSession.currentLeafId) {
        let currId: string | null = currentSession.currentLeafId;
        while (currId && currentSession.messageTree[currId]) {
            history.unshift(currentSession.messageTree[currId]);
            currId = currentSession.messageTree[currId].parentId;
        }
    }
    const slicedHistory = history.slice(0, messageIndex + 1);

    const newTree: Record<string, StoryNode> = {};
    let lastId: string | null = null;
    slicedHistory.forEach(node => {
        const newNodeId = crypto.randomUUID();
        newTree[newNodeId] = { ...node, id: newNodeId, parentId: lastId, childrenIds: [] };
        if (lastId) newTree[lastId].childrenIds.push(newNodeId);
        lastId = newNodeId;
    });

    const newSession: SimulationSession = {
        ...currentSession,
        id: crypto.randomUUID(),
        lastModified: Date.now(),
        messageTree: newTree,
        currentLeafId: lastId,
        config: { ...currentSession.config, title: `${currentSession.config.title} (Fork)` },
        status: 'active'
    };

    setState(prev => ({ ...prev, simulations: [newSession, ...prev.simulations], currentSessionId: newSession.id, view: 'simulation' }));
  };

  const handleImportFandomDetected = (fandom: string) => {
    if (state.view === 'setup') {
        const currentFandoms = state.draftConfig.fandoms;
        if (!currentFandoms.includes(fandom)) updateDraftConfig('fandoms', [...currentFandoms, fandom]);
    }
  };

  const cleanFileContent = (content: string) => {
    let cleaned = content.replace(/^--- START OF FILE .* ---\s*/gm, '');
    cleaned = cleaned.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '');
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }
    return cleaned.trim();
  };

  const handleImportSettingsFromFile = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
          try {
              const rawText = evt.target?.result as string;
              const cleanedText = cleanFileContent(rawText);
              
              const session = JSON.parse(cleanedText) as SimulationSession;
              if (!session.config || !session.wikiEntries) {
                  throw new Error("Invalid simulation file. Missing 'config' or 'wikiEntries'.");
              }

              const newConfig = { ...INITIAL_DRAFT_CONFIG, ...session.config, model: state.defaultModel };
              
              let newHistory = state.draftWorldMetaHistory;
              let newIndex = state.draftWorldMetaIndex;

              if (session.worldMeta) {
                  let importedMeta = session.worldMeta;
                  if (Array.isArray(importedMeta.hierarchy)) {
                      importedMeta.hierarchy = { 'Power': importedMeta.hierarchy };
                  }
                  newHistory = [...newHistory, importedMeta];
                  newIndex = newHistory.length - 1;
              }

              setState(prev => ({
                  ...prev,
                  draftConfig: newConfig,
                  draftWikiEntries: session.wikiEntries,
                  draftWorldMetaHistory: newHistory,
                  draftWorldMetaIndex: newIndex
              }));
              setShowImportModal(false);
              alert("Settings and World Logic imported successfully.");

          } catch (err) {
              alert(`Failed to import settings. ${err instanceof Error ? err.message : "Invalid format"}. Make sure the file is a valid JSON simulation export.`);
          }
      };
      reader.readAsText(file);
      e.target.value = '';
  };
  
  const handleApplySelectedImport = () => {
      if (!selectedImportSimId) return;
      const session = state.simulations.find(s => s.id === selectedImportSimId);
      if (!session) return;

      const newConfig = { ...INITIAL_DRAFT_CONFIG, ...session.config, model: state.defaultModel };
      
      let newHistory = state.draftWorldMetaHistory;
      let newIndex = state.draftWorldMetaIndex;

      if (session.worldMeta) {
          let importedMeta = session.worldMeta;
          if (Array.isArray(importedMeta.hierarchy)) {
              importedMeta.hierarchy = { 'Power': importedMeta.hierarchy };
          }
          newHistory = [...newHistory, importedMeta];
          newIndex = newHistory.length - 1;
      }

      setState(prev => ({
          ...prev,
          draftConfig: newConfig,
          draftWikiEntries: session.wikiEntries,
          draftWorldMetaHistory: newHistory,
          draftWorldMetaIndex: newIndex
      }));
      setShowImportModal(false);
      setSelectedImportSimId(null);
  };

  const handleExportSession = (session: SimulationSession) => {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(session, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", `${session.config.title || "simulation"}_export.json`);
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
  };

  const handleDashboardImportClick = () => { dashboardImportRef.current?.click(); };

  const handleDashboardImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
          try {
              const rawText = evt.target?.result as string;
              const cleanedText = cleanFileContent(rawText);
              
              const session = JSON.parse(cleanedText);
              if (!session.config || !session.id) throw new Error("Invalid simulation file");
              
              const migratedConfig = { ...INITIAL_DRAFT_CONFIG, ...session.config };
              const newSession = { 
                  ...session, 
                  id: crypto.randomUUID(), 
                  lastModified: Date.now(), 
                  status: session.status || 'active', 
                  config: migratedConfig,
                  characterStates: session.characterStates || {},
                  consequences: session.consequences || [],
                  sceneState: session.sceneState || { activeLocation: "Imported", activeCharacterIds: [], currentDirectorMode: DirectorMode.Balanced }
              };
              
              if (newSession.messages && !newSession.messageTree) {
                   const tree: Record<string, StoryNode> = {};
                    let lastId: string | null = null;
                    newSession.messages.forEach((msg: any) => {
                        const nodeId = msg.id || crypto.randomUUID();
                        tree[nodeId] = { ...msg, id: nodeId, parentId: lastId, childrenIds: [] };
                        if (lastId && tree[lastId]) tree[lastId].childrenIds.push(nodeId);
                        lastId = nodeId;
                    });
                    newSession.messageTree = tree; newSession.currentLeafId = lastId; delete newSession.messages;
              }
              setState(prev => ({ ...prev, simulations: [newSession, ...prev.simulations] }));
              alert("Simulation imported successfully!");
          } catch (err) { alert("Failed to import simulation. Invalid file format."); }
      };
      reader.readAsText(file); 
      e.target.value = '';
  };
  
  const handleSetupImportClick = () => { setupImportRef.current?.click(); };

  const handleDeleteSimulation = (id: string) => {
    setState(prev => ({
        ...prev,
        simulations: prev.simulations.filter(s => s.id !== id),
        currentSessionId: prev.currentSessionId === id ? null : prev.currentSessionId
    }));
  };
  
  const handleQuotaExhausted = () => {
      setShowQuotaModal(true);
  };

  const currentSession = state.simulations.find(s => s.id === state.currentSessionId);
  const currentWorldMeta = getCurrentWorldMeta();

  const hostOptions = React.useMemo(() => {
     const options = new Set<string>();
     state.draftConfig.fandoms.forEach(f => options.add(f));
     state.draftWikiEntries.forEach(e => {
         if (['World', 'Location', 'Facility', 'Country'].includes(e.category)) {
             options.add(e.name);
         }
     });
     return Array.from(options).sort();
  }, [state.draftConfig.fandoms, state.draftWikiEntries]);

  const currentHostValue = state.draftConfig.hostFandom;
  const hostSelectValue = React.useMemo(() => {
    if (currentHostValue === undefined) return 'MIXED';
    if (currentHostValue === '' || !hostOptions.includes(currentHostValue)) return 'CUSTOM';
    return currentHostValue;
  }, [currentHostValue, hostOptions]);

  // --- VIEW: LOADING WORLD ---
  if (state.view === 'building_world') {
     return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-white font-ao3-sans">
            <Loader2 className="animate-spin text-[#990000] mb-4" size={48} />
            <h2 className="font-ao3-serif text-2xl font-bold text-gray-800">Constructing World Logic...</h2>
            <p className="text-gray-500 mt-2">Integrating fandoms and generating history.</p>
            {loadingProgress > 0 && (
                <div className="w-64 h-2 bg-gray-200 mt-4 overflow-hidden rounded-none">
                    <div className="h-full bg-[#990000] transition-all duration-300" style={{ width: `${loadingProgress}%` }}></div>
                </div>
            )}
            <button onClick={cancelPreviewGeneration} className="mt-8 text-sm font-bold text-gray-400 hover:text-gray-600 rounded-none border border-gray-300 px-4 py-2 hover:bg-gray-100">Cancel</button>
        </div>
     );
  }

  return (
      <div className="min-h-screen bg-gray-100 text-gray-900 font-ao3-sans">
        <QuotaExhaustedModal 
            isOpen={showQuotaModal} 
            onClose={() => setShowQuotaModal(false)}
            onExport={() => state.currentSessionId && handleExportSession(state.simulations.find(s => s.id === state.currentSessionId)!)}
            onReturnToDashboard={() => setState(prev => ({ ...prev, view: 'dashboard' }))}
        />
        {showDisclaimer && (
            <DisclaimerModal onClose={handleAcceptDisclaimer} />
        )}
        
        {/* Import Modal */}
        {showImportModal && (
            <div ref={importModalRef} className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                <div className="bg-white p-6 shadow-xl max-w-md w-full rounded-none border border-gray-300">
                    <h3 className="font-ao3-serif font-bold text-lg mb-4 text-[#990000] border-b border-gray-200 pb-2">Import Simulation</h3>
                    <div className="space-y-4">
                        <button onClick={handleDashboardImportClick} className="w-full p-4 border-2 border-dashed border-gray-300 hover:border-[#990000] hover:bg-red-50 flex flex-col items-center rounded-none transition-colors">
                            <Upload className="mb-2 text-gray-500"/>
                            <span className="font-bold text-gray-700">Upload JSON File</span>
                            <input type="file" ref={dashboardImportRef} onChange={handleDashboardImportFile} className="hidden" accept=".json" />
                        </button>
                        
                        {state.simulations.length > 0 && (
                            <div>
                                <div className="text-sm font-bold text-gray-500 mb-2 uppercase">Or Clone Existing</div>
                                <select 
                                    className="w-full p-2 border border-gray-300 bg-white rounded-none focus:border-[#990000] outline-none"
                                    onChange={(e) => setSelectedImportSimId(e.target.value)}
                                    value={selectedImportSimId || ''}
                                >
                                    <option value="">Select a simulation...</option>
                                    {state.simulations.map(s => (
                                        <option key={s.id} value={s.id}>{s.config.title}</option>
                                    ))}
                                </select>
                                <button 
                                    onClick={handleApplySelectedImport}
                                    disabled={!selectedImportSimId}
                                    className="w-full mt-2 bg-gray-800 text-white font-bold py-2 hover:bg-gray-700 disabled:opacity-50 rounded-none"
                                >
                                    Clone Settings
                                </button>
                            </div>
                        )}
                        <button onClick={() => setShowImportModal(false)} className="w-full text-gray-500 hover:text-gray-800 text-sm font-bold mt-2 rounded-none">Cancel</button>
                    </div>
                </div>
            </div>
        )}

        {/* ... (Previous code remains the same) ... */}
        {/* --- VIEW: DASHBOARD & SETUP --- */}
        {state.view === 'dashboard' && (
            <div className="max-w-5xl mx-auto p-4 md:p-8">
                {/* ... (Dashboard code remains the same) ... */}
                <header className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4 bg-[#990000] p-6 text-white shadow-md">
                    <div className="flex items-center gap-4">
                         <div>
                            <div className="flex items-baseline gap-2">
                                <h1 className="font-ao3-serif text-3xl font-bold tracking-tight">
                                    <span className="text-white">Archive of Our Sims</span>
                                </h1>
                                <span className="text-xs font-normal opacity-75">beta</span>
                            </div>
                            <p className="text-xs mt-1 font-ao3-sans opacity-90 max-w-xl leading-relaxed">
                                Generating AI slop sims with multifandom stuffs cuz I (the creator) was bored with Deepseek
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                            <input 
                                type="text" 
                                placeholder="Search simulations..." 
                                value={dashboardSearch}
                                onChange={(e) => setDashboardSearch(e.target.value)}
                                className="pl-9 p-2 border border-gray-300 text-sm w-64 focus:border-white focus:ring-1 focus:ring-white outline-none bg-white text-gray-900 rounded-none shadow-inner"
                            />
                        </div>
                        <button 
                            onClick={() => setState(prev => ({ ...prev, view: 'setup', ...resetDraft() }))}
                            className="bg-white text-[#990000] px-4 py-2 font-bold shadow-md hover:bg-gray-100 flex items-center gap-2 rounded-none transition-colors border border-transparent hover:border-white"
                        >
                            <PlusCircle size={18} /> New Story
                        </button>
                        <button onClick={() => setShowImportModal(true)} className="p-2 text-white hover:bg-[#770000] border border-white/50 hover:border-white rounded-none transition-colors" title="Import"><Upload size={18}/></button>
                    </div>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {state.simulations
                        .filter(s => s.config.title.toLowerCase().includes(dashboardSearch.toLowerCase()))
                        .map(sim => (
                        <div key={sim.id} className="bg-white border border-gray-300 p-5 shadow-sm hover:shadow-md transition-shadow relative group rounded-none">
                            <div className="flex items-start justify-between">
                                <h3 className="font-ao3-serif text-xl font-bold text-[#990000] mb-2 truncate pr-8 cursor-pointer hover:underline" onClick={() => handleOpenSimulation(sim.id)}>{sim.config.title}</h3>
                                {sim.config.simulationType === SimulationType.SingleFandom && (
                                    <span className="bg-blue-100 text-blue-800 text-[10px] uppercase font-bold px-2 py-0.5 rounded-none border border-blue-200">RP</span>
                                )}
                                {sim.config.simulationType === SimulationType.OriginalUniverse && (
                                    <span className="bg-purple-100 text-purple-800 text-[10px] uppercase font-bold px-2 py-0.5 rounded-none border border-purple-200">OC</span>
                                )}
                            </div>
                            <div className="flex flex-wrap gap-1 mb-4">
                                {sim.config.fandoms.slice(0, 3).map(f => (
                                    <span key={f} className="text-xs bg-gray-100 border border-gray-300 text-gray-600 px-2 py-1 rounded-none font-ao3-sans">{f}</span>
                                ))}
                                {sim.config.fandoms.length > 3 && <span className="text-xs text-gray-400">+{sim.config.fandoms.length - 3}</span>}
                                {sim.config.simulationType === SimulationType.OriginalUniverse && (
                                    <span className="text-xs bg-purple-50 border border-purple-100 text-purple-600 px-2 py-1 rounded-none font-ao3-sans">{sim.config.worldSeed?.genre}</span>
                                )}
                            </div>
                            <div className="text-xs text-gray-500 mb-4 flex items-center gap-1 font-ao3-sans">
                                <Clock size={12}/> Last updated: {new Date(sim.lastModified).toLocaleDateString()}
                            </div>
                            
                            <div className="flex items-center gap-2 mt-auto pt-3 border-t border-gray-100">
                                <button onClick={() => handleOpenSimulation(sim.id)} className="flex-1 bg-gray-100 border border-gray-300 text-gray-700 font-bold py-2 text-sm hover:bg-gray-200 hover:text-gray-900 rounded-none transition-colors">
                                    Open
                                </button>
                                <button onClick={() => handleEditDraft(sim)} className="p-2 border border-gray-300 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-none transition-colors" title="Edit Settings">
                                    <Settings size={16} />
                                </button>
                                <button onClick={() => handleExportSession(sim)} className="p-2 border border-gray-300 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-none transition-colors" title="Export">
                                    <Download size={16} />
                                </button>
                            </div>
                            
                            <div className="absolute top-4 right-4">
                                <HoldToDeleteButton onDelete={() => handleDeleteSimulation(sim.id)} className="text-gray-300 hover:text-red-500 p-1 rounded-none" />
                            </div>
                        </div>
                    ))}
                    {state.simulations.length === 0 && (
                        <div className="col-span-full text-center py-20 bg-white border border-gray-300 rounded-none">
                            <BookOpen className="mx-auto text-gray-300 mb-4" size={48} />
                            <h3 className="text-gray-600 font-ao3-serif font-bold text-lg">No simulations yet</h3>
                            <p className="text-gray-500 text-sm mb-6 font-ao3-sans">Create your first crossover adventure to get started.</p>
                            <button 
                                onClick={() => setState(prev => ({ ...prev, view: 'setup', ...resetDraft() }))}
                                className="bg-[#990000] text-white px-6 py-2 font-bold hover:bg-[#770000] rounded-none shadow-sm"
                            >
                                Create Simulation
                            </button>
                        </div>
                    )}
                </div>
            </div>
        )}

        {state.view === 'setup' && (
            <div className="flex flex-col h-screen font-ao3-sans">
                {/* ... (Header code) ... */}
                <header className="bg-[#990000] border-b border-[#770000] p-4 flex items-center justify-between shadow-md z-10 text-white">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setState(prev => ({ ...prev, view: 'dashboard' }))} className="text-white/80 hover:text-white transition-colors"><ArrowLeft size={24}/></button>
                        <h1 className="font-ao3-serif text-xl font-bold">
                            {state.draftSessionId ? "Edit Simulation" : "New Simulation"}
                        </h1>
                    </div>
                    {/* Setup Mode Toggle */}
                    <div className="flex items-center bg-[#770000] rounded-none border border-[#550000]">
                         <button 
                            onClick={() => updateDraftConfig('simulationType', SimulationType.Multifandom)}
                            className={`px-4 py-1 text-sm font-bold ${state.draftConfig.simulationType === SimulationType.Multifandom ? 'bg-white text-[#990000]' : 'text-white/60 hover:text-white'}`}
                         >
                            Multifandom Fusion
                         </button>
                         <button 
                            onClick={() => updateDraftConfig('simulationType', SimulationType.SingleFandom)}
                            className={`px-4 py-1 text-sm font-bold ${state.draftConfig.simulationType === SimulationType.SingleFandom ? 'bg-white text-[#990000]' : 'text-white/60 hover:text-white'}`}
                         >
                            Single-Fandom RP
                         </button>
                         <button 
                            onClick={() => updateDraftConfig('simulationType', SimulationType.OriginalUniverse)}
                            className={`px-4 py-1 text-sm font-bold ${state.draftConfig.simulationType === SimulationType.OriginalUniverse ? 'bg-white text-[#990000]' : 'text-white/60 hover:text-white'}`}
                         >
                            Original Universe
                         </button>
                    </div>
                    <div className="flex items-center gap-3">
                         <button onClick={handleSetupImportClick} className="hidden md:flex items-center gap-2 text-white/90 font-bold text-sm px-4 py-2 hover:bg-[#770000] border border-white/20 hover:border-white/50 rounded-none transition-colors" title="Import Settings from JSON">
                            <Upload size={16}/> Import
                            <input type="file" ref={setupImportRef} onChange={handleImportSettingsFromFile} className="hidden" accept=".json" />
                        </button>
                         <button onClick={handleSaveDraft} className="hidden md:flex items-center gap-2 text-white/90 font-bold text-sm px-4 py-2 hover:bg-[#770000] border border-white/20 hover:border-white/50 rounded-none transition-colors">
                            <Save size={16}/> Draft
                        </button>
                        <button 
                            onClick={handleCreateSimulation} 
                            disabled={state.draftConfig.simulationType !== SimulationType.OriginalUniverse && state.draftConfig.fandoms.length === 0 && !state.draftConfig.hostFandom}
                            className="bg-white text-[#990000] px-6 py-2 font-bold hover:bg-gray-100 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed rounded-none shadow-sm transition-colors"
                        >
                            <Sparkles size={18} /> {state.draftSessionId ? "Update" : "Start"}
                        </button>
                    </div>
                </header>

                <div className="flex-1 overflow-hidden flex flex-col md:flex-row bg-gray-100">
                    {/* ... (Left Panel) ... */}
                    <div className="w-full md:w-1/2 lg:w-5/12 overflow-y-auto p-6 border-r border-gray-300 bg-white">
                        <div className="space-y-6 max-w-2xl mx-auto">
                            {/* ... (Inputs) ... */}
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-1">Title</label>
                                <input 
                                    type="text" 
                                    value={state.draftConfig.title} 
                                    onChange={(e) => updateDraftConfig('title', e.target.value)}
                                    placeholder={state.draftConfig.simulationType === SimulationType.SingleFandom ? "My Hero Academia: Vigilantes AU" : (state.draftConfig.simulationType === SimulationType.OriginalUniverse ? "Tales of the Crystal Spire" : "The Avengers meet Sherlock Holmes")}
                                    className="w-full p-2 border border-gray-300 font-ao3-serif text-lg bg-white focus:border-[#990000] outline-none rounded-none shadow-inner"
                                />
                            </div>
                            
                            {/* ... (Skipping verbose repeated code for brevity where unchanged, focusing on structure) ... */}
                            {/* ... Multiverse / Single / Original Configs ... */}
                            {state.draftConfig.simulationType === SimulationType.Multifandom && (
                                <>
                                    <TagInput 
                                        label="Fandoms"
                                        icon={<BookOpen size={16} />}
                                        tags={state.draftConfig.fandoms}
                                        onChange={(tags) => updateDraftConfig('fandoms', tags)}
                                        placeholder="Add fandom (e.g. Star Wars, Marvel)..."
                                        className="rounded-none"
                                    />
                                    {/* ... rest of multifandom config ... */}
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-bold text-gray-700 mb-1">World Type</label>
                                            <select 
                                                value={state.draftConfig.worldType}
                                                onChange={(e) => updateDraftConfig('worldType', e.target.value)}
                                                className="w-full p-2 border border-gray-300 bg-white rounded-none focus:border-[#990000] outline-none shadow-inner"
                                            >
                                                <option value={WorldType.Collision}>Worlds Collide (Portal)</option>
                                                <option value={WorldType.Merged}>Merged History (Fusion)</option>
                                            </select>
                                            <p className="text-[10px] text-gray-500 mt-1 leading-tight">
                                                {state.draftConfig.worldType === WorldType.Collision ? "Characters keep their original memories and know they are displaced." : "History is rewritten so they always lived here."}
                                            </p>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-bold text-gray-700 mb-1">Integration Mode</label>
                                            <select 
                                                value={state.draftConfig.integrationMode}
                                                onChange={(e) => updateDraftConfig('integrationMode', e.target.value)}
                                                className="w-full p-2 border border-gray-300 bg-white rounded-none focus:border-[#990000] outline-none shadow-inner"
                                            >
                                                <option value={IntegrationMode.Portal}>Portal / Isekai</option>
                                                <option value={IntegrationMode.Native}>Native Integration</option>
                                                <option value={IntegrationMode.Visitor}>Visitor / Traveler</option>
                                            </select>
                                        </div>
                                    </div>
                                    
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-1">Host Fandom / Setting</label>
                                        <select 
                                            value={hostSelectValue}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                if (val === 'MIXED') updateDraftConfig('hostFandom', undefined);
                                                else if (val === 'CUSTOM') updateDraftConfig('hostFandom', '');
                                                else updateDraftConfig('hostFandom', val);
                                            }}
                                            className="w-full p-2 border border-gray-300 bg-white rounded-none focus:border-[#990000] outline-none shadow-inner"
                                        >
                                            <option value="MIXED">Mixed / Fusion (No dominant setting)</option>
                                            <optgroup label="Fandoms & Locations">
                                                {hostOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                            </optgroup>
                                            <option value="CUSTOM">Custom...</option>
                                        </select>
                                        {hostSelectValue === 'CUSTOM' && (
                                            <input 
                                                type="text" 
                                                value={state.draftConfig.hostFandom || ''} 
                                                onChange={(e) => updateDraftConfig('hostFandom', e.target.value)}
                                                placeholder="Enter custom setting or host world..."
                                                className="w-full p-2 mt-2 border border-gray-300 bg-white focus:border-[#990000] outline-none rounded-none shadow-inner"
                                            />
                                        )}
                                        <p className="text-xs text-gray-500 mt-1">If set, this world's laws of physics and history will take precedence.</p>
                                    </div>
                                </>
                            )}
                            
                            {/* ... (Single Fandom) ... */}
                            {state.draftConfig.simulationType === SimulationType.SingleFandom && (
                                <>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-1">Core Fandom</label>
                                        <input 
                                            type="text" 
                                            value={state.draftConfig.fandoms[0] || ''} 
                                            readOnly
                                            placeholder="Use Wiki Importer to set Fandom..."
                                            className="w-full p-2 border border-gray-300 bg-gray-50 text-gray-600 outline-none rounded-none shadow-inner cursor-not-allowed"
                                        />
                                        <p className="text-xs text-gray-500 mt-1">Add a character/wiki entry on the right to auto-detect fandom.</p>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-bold text-gray-700 mb-1">Roleplay Type</label>
                                            <select 
                                                value={state.draftConfig.roleplayType}
                                                onChange={(e) => updateDraftConfig('roleplayType', e.target.value)}
                                                className="w-full p-2 border border-gray-300 bg-white rounded-none focus:border-[#990000] outline-none shadow-inner"
                                            >
                                                <option value={RoleplayType.CanonDivergence}>Canon Divergence</option>
                                                <option value={RoleplayType.AURewrite}>Full AU Rewrite</option>
                                                <option value={RoleplayType.SelfInsert}>Self Insert / OC</option>
                                                <option value={RoleplayType.CanonCompliant}>Canon Compliant</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-bold text-gray-700 mb-1">Era / Setting</label>
                                            <input 
                                                type="text" 
                                                value={state.draftConfig.timeEra || ''} 
                                                onChange={(e) => updateDraftConfig('timeEra', e.target.value)}
                                                placeholder="e.g. Modern Day, Post-War..."
                                                className="w-full p-2 border border-gray-300 bg-white rounded-none focus:border-[#990000] outline-none shadow-inner"
                                            />
                                        </div>
                                    </div>
                                    {/* Role Assignments Logic (Skipped for brevity) */}
                                    <div className="bg-gray-50 border border-gray-300 p-4 rounded-none">
                                        <h3 className="font-bold text-[#990000] mb-3 flex items-center gap-2 border-b border-gray-200 pb-2">
                                            <Users size={16}/> Role Casting
                                        </h3>
                                        <div className="space-y-3 mb-3">
                                            {state.draftConfig.roleAssignments?.map((role, idx) => {
                                                const char = state.draftWikiEntries.find(e => e.id === role.characterId);
                                                return (
                                                    <div key={idx} className="flex justify-between items-center bg-white border border-gray-200 p-2 shadow-sm">
                                                        <div className="flex-1">
                                                            <span className="font-bold text-sm text-gray-800">{role.roleName}</span>
                                                            <span className="mx-2 text-gray-400">→</span>
                                                            <span className="text-sm text-[#990000] font-ao3-serif">{char?.name || 'Unknown'}</span>
                                                        </div>
                                                        <button onClick={() => handleRemoveRole(idx)} className="text-gray-400 hover:text-red-600"><Trash2 size={14}/></button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        <div className="flex gap-2">
                                            <input 
                                                type="text" 
                                                placeholder="Role Name (e.g. The Protagonist)" 
                                                className="flex-1 p-2 border border-gray-300 text-sm bg-white rounded-none"
                                                value={newRoleName}
                                                onChange={e => setNewRoleName(e.target.value)}
                                            />
                                            <select 
                                                className="flex-1 p-2 border border-gray-300 text-sm bg-white rounded-none"
                                                value={newRoleCharId}
                                                onChange={e => setNewRoleCharId(e.target.value)}
                                            >
                                                <option value="">Select Character...</option>
                                                {state.draftWikiEntries.filter(e => e.category === 'Character').map(c => (
                                                    <option key={c.id} value={c.id}>{c.name}</option>
                                                ))}
                                            </select>
                                            <button onClick={handleAddRole} className="bg-gray-800 text-white px-3 font-bold hover:bg-gray-900 rounded-none"><Plus size={16}/></button>
                                        </div>
                                    </div>
                                    {/* Scenario Generator Logic (Skipped for brevity) */}
                                    <div className="bg-blue-50 border border-blue-200 p-4 rounded-none">
                                        <div className="flex justify-between items-center mb-3">
                                            <h3 className="font-bold text-blue-800 flex items-center gap-2">
                                                <Sparkles size={16}/> Scenario Generator
                                            </h3>
                                            <button 
                                                onClick={handleGenerateHooks} 
                                                disabled={isGeneratingHooks || !state.draftConfig.fandoms[0]}
                                                className="text-xs bg-blue-700 text-white px-3 py-1 font-bold hover:bg-blue-800 disabled:opacity-50 rounded-none"
                                            >
                                                {isGeneratingHooks ? "Generating..." : "Generate Ideas"}
                                            </button>
                                        </div>
                                        
                                        {scenarioHooks.length > 0 && (
                                            <div className="space-y-2">
                                                {scenarioHooks.map((hook, i) => (
                                                    <div 
                                                        key={i} 
                                                        onClick={() => handleSelectHook(hook)}
                                                        className="bg-white border border-blue-100 p-3 hover:border-blue-500 cursor-pointer shadow-sm transition-colors group"
                                                    >
                                                        <div className="font-bold text-sm text-gray-800 group-hover:text-blue-700">{hook.title}</div>
                                                        <div className="text-xs text-gray-600 mt-1">{hook.premise}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}

                            {/* ... (Original Universe) ... */}
                            {state.draftConfig.simulationType === SimulationType.OriginalUniverse && (
                                <div className="space-y-4">
                                    <div className="bg-purple-50 border border-purple-200 p-4 rounded-none">
                                        <h3 className="font-bold text-purple-900 mb-3 flex items-center gap-2 border-b border-purple-200 pb-2">
                                            <Wand2 size={16}/> World Genesis Engine
                                        </h3>
                                        <div className="space-y-4">
                                            <div>
                                                <label className="block text-sm font-bold text-gray-700 mb-1">Genre</label>
                                                <input 
                                                    type="text" 
                                                    value={state.draftConfig.worldSeed?.genre || ''} 
                                                    onChange={(e) => updateDraftConfig('worldSeed', { ...state.draftConfig.worldSeed, genre: e.target.value })}
                                                    placeholder="e.g. Steampunk Noir, Space Opera, Gothic Horror"
                                                    className="w-full p-2 border border-gray-300 bg-white rounded-none focus:border-purple-600 outline-none"
                                                />
                                            </div>
                                            
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-sm font-bold text-gray-700 mb-1">Magic Level</label>
                                                    <select 
                                                        value={state.draftConfig.worldSeed?.magicLevel || 'None'} 
                                                        onChange={(e) => updateDraftConfig('worldSeed', { ...state.draftConfig.worldSeed, magicLevel: e.target.value })}
                                                        className="w-full p-2 border border-gray-300 bg-white rounded-none focus:border-purple-600 outline-none"
                                                    >
                                                        <option value="None">None (Realistic)</option>
                                                        <option value="Low">Low (Ritual/Rare)</option>
                                                        <option value="High">High (Common/Powerful)</option>
                                                        <option value="Cosmic">Cosmic (Godlike)</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-bold text-gray-700 mb-1">Tech Level</label>
                                                    <select 
                                                        value={state.draftConfig.worldSeed?.techLevel || 'Modern'} 
                                                        onChange={(e) => updateDraftConfig('worldSeed', { ...state.draftConfig.worldSeed, techLevel: e.target.value })}
                                                        className="w-full p-2 border border-gray-300 bg-white rounded-none focus:border-purple-600 outline-none"
                                                    >
                                                        <option value="Primitive">Primitive</option>
                                                        <option value="Medieval">Medieval</option>
                                                        <option value="Modern">Modern</option>
                                                        <option value="Futuristic">Futuristic</option>
                                                        <option value="Far Future">Far Future</option>
                                                    </select>
                                                </div>
                                            </div>

                                            <div>
                                                <label className="block text-sm font-bold text-gray-700 mb-1">The Premise (World Seed)</label>
                                                <textarea 
                                                    value={state.draftConfig.worldSeed?.premise || ''}
                                                    onChange={(e) => updateDraftConfig('worldSeed', { ...state.draftConfig.worldSeed, premise: e.target.value })}
                                                    placeholder="e.g. A world where the sun never sets and cities are built on the backs of giant tortoises."
                                                    className="w-full p-2 border border-gray-300 bg-white rounded-none focus:border-purple-600 outline-none h-24"
                                                />
                                            </div>

                                            <button 
                                                onClick={handleExecuteGenesis}
                                                disabled={isGeneratingGenesis || !state.draftConfig.worldSeed?.premise}
                                                className="w-full bg-purple-700 text-white font-bold py-3 hover:bg-purple-800 disabled:opacity-50 rounded-none shadow-sm flex items-center justify-center gap-2"
                                            >
                                                {isGeneratingGenesis ? <Loader2 className="animate-spin" size={18}/> : <Sparkles size={18}/>}
                                                Generate World Bible
                                            </button>
                                            <p className="text-xs text-purple-700 mt-1 italic text-center">
                                                This will replace current entries with 6 foundational world lore entries.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* ... (Advanced Logic Section) ... */}
                            <div className="p-4 bg-gray-50 border border-gray-300 rounded-none">
                                <h3 className="font-bold text-[#990000] mb-3 flex items-center gap-2 border-b border-gray-300 pb-2"> <Settings2 size={16} /> Advanced Logic </h3>
                                {/* ... (Logic Settings inputs) ... */}
                                <div className="space-y-4">
                                    {/* Actor Role Selection */}
                                    {state.draftConfig.simulationMode === SimulationMode.Actor && (
                                        <div className="bg-red-50 border border-red-200 p-3 mb-2 rounded-none">
                                            <label className="block text-xs font-bold text-red-800 uppercase mb-1 flex items-center gap-1">
                                                <User size={12}/> Playing As (Main Character)
                                            </label>
                                            <select 
                                                value={state.draftConfig.activeCharacterId || ''}
                                                onChange={(e) => updateDraftConfig('activeCharacterId', e.target.value)}
                                                className="w-full p-2 border border-red-200 text-sm bg-white rounded-none focus:border-[#990000] outline-none shadow-inner"
                                            >
                                                <option value="">None / Observer</option>
                                                {state.draftWikiEntries.filter(e => e.category === 'Character').map(c => (
                                                    <option key={c.id} value={c.id}>{c.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Point of View</label>
                                            <select value={state.draftConfig.narrativePOV} onChange={(e) => updateDraftConfig('narrativePOV', e.target.value)} className="w-full p-2 border border-gray-300 text-sm bg-white rounded-none focus:border-[#990000] outline-none shadow-inner">
                                                {Object.values(NarrativePOV).map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Narrative Tense</label>
                                            <select value={state.draftConfig.narrativeTense} onChange={(e) => updateDraftConfig('narrativeTense', e.target.value)} className="w-full p-2 border border-gray-300 text-sm bg-white rounded-none focus:border-[#990000] outline-none shadow-inner">
                                                {Object.values(NarrativeTense).map(t => <option key={t} value={t}>{t}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Narrative Tone</label>
                                        <select value={state.draftConfig.tone} onChange={(e) => updateDraftConfig('tone', e.target.value)} className="w-full p-2 border border-gray-300 text-sm bg-white rounded-none focus:border-[#990000] outline-none shadow-inner">
                                            {Object.values(ToneType).map(t => <option key={t} value={t}>{t === ToneType.CUSTOM ? "Custom..." : t.replace(/_/g, ' ')}</option>)}
                                        </select>
                                        {state.draftConfig.tone === ToneType.CUSTOM && (
                                            <input 
                                                type="text"
                                                value={state.draftConfig.customTone || ''}
                                                onChange={(e) => updateDraftConfig('customTone', e.target.value)}
                                                placeholder="e.g. Hopeful Melancholy, 80s Cyberpunk..."
                                                className="w-full p-2 mt-2 border border-gray-300 text-sm bg-white rounded-none focus:border-[#990000] outline-none shadow-inner"
                                            />
                                        )}
                                        <p className="text-[10px] text-gray-500 mt-1">Sets the mood (e.g., Angst, Fluff, Horror).</p>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Canon Strictness</label>
                                        <select value={state.draftConfig.canonStrictness} onChange={(e) => updateDraftConfig('canonStrictness', e.target.value)} className="w-full p-2 border border-gray-300 text-sm bg-white rounded-none focus:border-[#990000] outline-none shadow-inner">
                                            {Object.values(CanonStrictness).map(t => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                        <p className="text-[10px] text-gray-500 mt-1">
                                            {state.draftConfig.canonStrictness === CanonStrictness.Strict ? "Characters act exactly as canon." : (state.draftConfig.simulationType === SimulationType.OriginalUniverse ? "Consistent with generated lore." : "Allows deviation for plot needs.")}
                                        </p>
                                    </div>
                                     <div>
                                        <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Power Scaling</label>
                                        <select value={state.draftConfig.powerScaling} onChange={(e) => updateDraftConfig('powerScaling', e.target.value)} className="w-full p-2 border border-gray-300 text-sm bg-white rounded-none focus:border-[#990000] outline-none shadow-inner">
                                            {Object.values(PowerScaling).map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                                        </select>
                                        <p className="text-[10px] text-gray-500 mt-1">
                                            {state.draftConfig.powerScaling === PowerScaling.Balanced ? "Nerfs OP characters for fair conflict." : "Gods remain Gods (Lore Accurate)."}
                                        </p>
                                    </div>
                                    
                                    <div className="flex items-start gap-2 pt-2 border-t border-gray-200 mt-2">
                                        <input 
                                            type="checkbox" 
                                            id="telltale-toggle"
                                            checked={state.draftConfig.showTelltaleIndicators}
                                            onChange={(e) => updateDraftConfig('showTelltaleIndicators', e.target.checked)}
                                            className="mt-1 h-4 w-4 rounded-none border-gray-300 text-[#990000] focus:ring-[#990000]"
                                        />
                                        <div>
                                            <label htmlFor="telltale-toggle" className="block text-xs font-bold text-gray-600 uppercase cursor-pointer">Telltale Indicators</label>
                                            <p className="text-[10px] text-gray-500">Show indicators like "X will remember that."</p>
                                        </div>
                                    </div>

                                    <div className="flex items-start gap-2 pt-2 mt-2">
                                        <input 
                                            type="checkbox" 
                                            id="scene-header-toggle"
                                            checked={state.draftConfig.showSceneHeaders}
                                            onChange={(e) => updateDraftConfig('showSceneHeaders', e.target.checked)}
                                            className="mt-1 h-4 w-4 rounded-none border-gray-300 text-[#990000] focus:ring-[#990000]"
                                        />
                                        <div>
                                            <label htmlFor="scene-header-toggle" className="block text-xs font-bold text-gray-600 uppercase cursor-pointer">Show Scene Headings</label>
                                            <p className="text-[10px] text-gray-500">Display Location, Time, and Date at start of messages.</p>
                                        </div>
                                    </div>

                                    {/* Mode Toggle inside Advanced Logic */}
                                    <div className="flex items-center justify-between border-t border-gray-200 pt-3">
                                        <span className="text-xs font-bold text-gray-600 uppercase">Default Mode</span>
                                        <div className="flex items-center bg-gray-200 rounded-none overflow-hidden">
                                            <button 
                                                onClick={() => updateDraftConfig('simulationMode', SimulationMode.Director)}
                                                className={`px-3 py-1 text-xs font-bold ${state.draftConfig.simulationMode === SimulationMode.Director ? 'bg-[#990000] text-white' : 'text-gray-600'}`}
                                            >
                                                Director
                                            </button>
                                            <button 
                                                onClick={() => updateDraftConfig('simulationMode', SimulationMode.Actor)}
                                                className={`px-3 py-1 text-xs font-bold ${state.draftConfig.simulationMode === SimulationMode.Actor ? 'bg-[#990000] text-white' : 'text-gray-600'}`}
                                            >
                                                Actor
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-1">World Rules / Modifiers</label>
                                <textarea 
                                    value={state.draftConfig.modifiers}
                                    onChange={(e) => updateDraftConfig('modifiers', e.target.value)}
                                    placeholder={state.draftConfig.simulationType === SimulationType.SingleFandom ? "Scenario Hook goes here..." : "e.g. There is no magic here. Everyone is a teenager. It is always raining."}
                                    className="w-full p-2 border border-gray-300 h-24 bg-white focus:border-[#990000] outline-none text-sm rounded-none shadow-inner"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Right Panel: Wiki & Import */}
                    <div className="w-full md:w-1/2 lg:w-7/12 flex flex-col bg-gray-50">
                        <div className="flex-1 overflow-y-auto p-6">
                           <WikiImporter 
                                model={state.draftConfig.model}
                                onImport={(entry) => setState(prev => ({ ...prev, draftWikiEntries: [...prev.draftWikiEntries, entry] }))}
                                onUpdateEntry={handleUpdateEntry}
                                onRemoveEntry={handleRemoveEntry}
                                onClearAll={handleClearAllEntries}
                                onReorder={handleReorderEntry}
                                onRestoreDefaults={handleRestoreDefaults}
                                onFandomDetected={handleImportFandomDetected}
                                existingEntries={state.draftWikiEntries}
                                library={state.library}
                                onAddToLibrary={handleAddToLibrary}
                                onRemoveFromLibrary={handleRemoveFromLibrary}
                           />
                           
                           {/* World Logic Preview (Only show in Multifandom for now, or simplify for single) */}
                           <div className="mt-8 border-t border-gray-300 pt-6">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="font-ao3-serif text-xl font-bold text-gray-800">World Logic Preview</h3>
                                    <div className="flex items-center gap-2">
                                        <select 
                                            value={generationMode} 
                                            onChange={(e) => setGenerationMode(e.target.value as WorldGenerationMode)}
                                            className="text-xs border border-gray-300 p-1 rounded-none bg-white font-bold text-gray-600"
                                        >
                                            <option value={WorldGenerationMode.MaintainAndFill}>Maintain & Fill</option>
                                            <option value={WorldGenerationMode.EnhanceOnly}>Enhance Descriptions</option>
                                            <option value={WorldGenerationMode.Rewrite}>Full Rewrite</option>
                                        </select>
                                    </div>
                                </div>
                                
                                <div className="bg-white border border-gray-300 rounded-none shadow-sm overflow-hidden">
                                    <div className="flex border-b border-gray-200 bg-gray-100">
                                        <button onClick={() => setPreviewTab('integration')} className={`flex-1 py-2 text-sm font-bold border-r border-gray-200 ${previewTab === 'integration' ? 'bg-white text-[#990000] border-t-2 border-t-[#990000] border-r-transparent' : 'text-gray-600 hover:bg-gray-200'}`}>Integration</button>
                                        <button onClick={() => setPreviewTab('timeline')} className={`flex-1 py-2 text-sm font-bold border-r border-gray-200 ${previewTab === 'timeline' ? 'bg-white text-[#990000] border-t-2 border-t-[#990000] border-r-transparent' : 'text-gray-600 hover:bg-gray-200'}`}>Timeline</button>
                                        <button onClick={() => setPreviewTab('hierarchy')} className={`flex-1 py-2 text-sm font-bold ${previewTab === 'hierarchy' ? 'bg-white text-[#990000] border-t-2 border-t-[#990000]' : 'text-gray-600 hover:bg-gray-200'}`}>Hierarchy</button>
                                    </div>
                                    
                                    <div className="p-4 min-h-[300px] max-h-[500px] overflow-y-auto relative">
                                        {/* Modifiers for AI Generation */}
                                        <div className="mb-4 bg-gray-50 p-3 rounded-none border border-gray-200">
                                            <div className="flex gap-2">
                                                <div className="flex-1 relative">
                                                    <input 
                                                        type="text" 
                                                        placeholder={`Instructions for ${previewTab} generation (e.g. "Make it darker")`}
                                                        value={previewTab === 'timeline' ? timelineModifier : previewTab === 'hierarchy' ? hierarchyModifier : integrationModifier}
                                                        onChange={(e) => {
                                                            const val = e.target.value;
                                                            if (previewTab === 'timeline') setTimelineModifier(val);
                                                            else if (previewTab === 'hierarchy') setHierarchyModifier(val);
                                                            else setIntegrationModifier(val);
                                                        }}
                                                        className="w-full p-2 pr-8 text-sm border border-gray-300 bg-white rounded-none focus:border-[#990000] outline-none"
                                                    />
                                                    {(previewTab === 'timeline' ? timelineModifier : previewTab === 'hierarchy' ? hierarchyModifier : integrationModifier) && (
                                                        <button 
                                                            onClick={() => {
                                                                if (previewTab === 'timeline') setTimelineModifier('');
                                                                else if (previewTab === 'hierarchy') setHierarchyModifier('');
                                                                else setIntegrationModifier('');
                                                            }}
                                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-600"
                                                            title="Clear Modifier"
                                                        >
                                                            <X size={14} />
                                                        </button>
                                                    )}
                                                </div>
                                                <button 
                                                    onClick={() => handlePreviewWorld(previewTab)}
                                                    disabled={state.isGenerating}
                                                    className="bg-gray-800 text-white px-3 py-1 rounded-none text-xs font-bold hover:bg-gray-900 flex items-center gap-1 shadow-sm"
                                                >
                                                    <Wand2 size={12}/> Generate
                                                </button>
                                            </div>
                                        </div>

                                        {/* Content Area */}
                                        {previewTab === 'timeline' && currentWorldMeta && (
                                            <div className="space-y-4">
                                                {currentWorldMeta.timeline.map((evt, idx) => (
                                                    <div 
                                                        key={idx} 
                                                        draggable 
                                                        onDragStart={(e) => onDragStartTimeline(e, idx)}
                                                        onDragOver={(e) => e.preventDefault()}
                                                        onDrop={(e) => onDropTimeline(e, idx)}
                                                        className="flex gap-4 group"
                                                    >
                                                        <div className="w-16 text-right text-xs font-bold text-gray-500 pt-1 cursor-grab active:cursor-grabbing font-ao3-sans">
                                                            {evt.year}
                                                        </div>
                                                        <div className="flex-1 pb-4 border-l-2 border-gray-200 pl-4 relative">
                                                            <div className="absolute -left-[5px] top-1.5 w-2 h-2 bg-gray-400 group-hover:bg-[#990000] square-full"></div>
                                                            {editingTimelineIdx === idx ? (
                                                                <div className="flex gap-2 items-start">
                                                                    <textarea 
                                                                        value={editTimelineDesc}
                                                                        onChange={e => setEditTimelineDesc(e.target.value)}
                                                                        className="w-full p-2 border border-gray-300 text-sm bg-white rounded-none"
                                                                    />
                                                                    <button onClick={handleEditTimelineEvent} className="text-green-600 hover:text-green-800"><Save size={14}/></button>
                                                                </div>
                                                            ) : (
                                                                <>
                                                                    <div className="text-sm text-gray-800 font-ao3-serif">{evt.description}</div>
                                                                    <div className="flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                         <span className="text-[10px] text-gray-400 uppercase tracking-wide">{evt.sourceFandom}</span>
                                                                         <button onClick={() => { setEditingTimelineIdx(idx); setEditTimelineDesc(evt.description); }} className="text-gray-400 hover:text-gray-700"><Edit2 size={10}/></button>
                                                                         <button onClick={() => handleDeleteTimelineEvent(idx)} className="text-gray-400 hover:text-red-600"><Trash2 size={10}/></button>
                                                                    </div>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                                {/* Manual Add Event */}
                                                {!isAddingEvent ? (
                                                     <button onClick={() => setIsAddingEvent(true)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-[#990000] mt-2 font-bold ml-20">
                                                        <Plus size={12}/> Add Event
                                                     </button>
                                                ) : (
                                                    <div className="flex gap-2 ml-20 mt-2 items-start bg-gray-50 p-2 border border-gray-200">
                                                        <input 
                                                            type="text" 
                                                            placeholder="Year" 
                                                            value={newEventYear} 
                                                            onChange={e => setNewEventYear(e.target.value)}
                                                            className="w-16 p-1 text-xs border border-gray-300 rounded-none"
                                                        />
                                                        <textarea 
                                                            placeholder="Description"
                                                            value={newEventDesc}
                                                            onChange={e => setNewEventDesc(e.target.value)}
                                                            className="flex-1 p-1 text-xs border border-gray-300 rounded-none"
                                                        />
                                                        <button onClick={handleAddTimelineEvent} className="text-[#990000] hover:text-[#770000]"><Plus size={16}/></button>
                                                        <button onClick={() => setIsAddingEvent(false)} className="text-gray-400 hover:text-gray-600"><X size={16}/></button>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {previewTab === 'hierarchy' && currentWorldMeta && (
                                            <div>
                                                <div className="flex gap-1 mb-4 border-b border-gray-200">
                                                    {Object.keys(currentWorldMeta.hierarchy).map(key => (
                                                        <button
                                                            key={key}
                                                            onClick={() => setActiveHierarchyTab(key)}
                                                            className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${activeHierarchyTab === key ? 'border-[#990000] text-[#990000]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                                                        >
                                                            {key}
                                                        </button>
                                                    ))}
                                                </div>
                                                <div className="space-y-4">
                                                    {currentWorldMeta.hierarchy[activeHierarchyTab]?.map((tier, idx) => (
                                                        <div 
                                                            key={idx} 
                                                            className={`border rounded-none transition-colors ${dragOverTierIdx === idx ? 'bg-blue-50 border-blue-300' : 'bg-gray-50 border-gray-200'}`}
                                                            onDragOver={(e) => { e.preventDefault(); setDragOverTierIdx(idx); }}
                                                            onDragLeave={() => setDragOverTierIdx(null)}
                                                            onDrop={(e) => onDropEntityOnTier(e, idx)}
                                                        >
                                                            <div className="bg-gray-100 p-2 border-b border-gray-200 text-xs font-bold uppercase text-gray-700 flex justify-between">
                                                                {tier.tierName}
                                                            </div>
                                                            <div className="p-3 flex flex-wrap gap-2 min-h-[50px]">
                                                                {tier.entities.map((ent, eIdx) => (
                                                                    <div 
                                                                        key={eIdx} 
                                                                        draggable
                                                                        onDragStart={(e) => onDragStartEntity(e, ent.name, idx)}
                                                                        className="bg-white px-2 py-1 rounded-none border border-gray-300 text-sm font-bold text-gray-800 shadow-sm cursor-grab active:cursor-grabbing hover:border-gray-400 flex items-center gap-2 group font-ao3-serif"
                                                                    >
                                                                        {ent.name}
                                                                        <button onClick={() => handleDeleteTierEntity(idx, eIdx)} className="text-gray-300 hover:text-red-600 hidden group-hover:block"><X size={10}/></button>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {previewTab === 'integration' && currentWorldMeta && (
                                            <div className="space-y-0">
                                                {state.draftWikiEntries.map(entry => {
                                                    const adaptation = currentWorldMeta.entityAdaptations?.[entry.id];
                                                    const hasAdaptation = !!adaptation;
                                                    
                                                    return (
                                                        <div key={entry.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors group">
                                                            <div 
                                                                className="p-3 flex items-start justify-between cursor-pointer"
                                                                onClick={() => setViewingAdaptationId(entry.id)}
                                                            >
                                                                <div className="flex-1">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="font-bold text-sm text-gray-900">{entry.name}</span>
                                                                        {!hasAdaptation && <span className="text-[10px] bg-red-100 text-red-700 px-1 font-bold">Pending</span>}
                                                                    </div>
                                                                    {hasAdaptation ? (
                                                                        <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                                                                            <span className="font-bold text-[#990000]">{adaptation.role}</span> • {adaptation.description}
                                                                        </p>
                                                                    ) : (
                                                                        <p className="text-xs text-gray-400 mt-1 italic">Click to define integration role...</p>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center gap-1">
                                                                    {hasAdaptation && (
                                                                        <button 
                                                                            onClick={(e) => { e.stopPropagation(); handleClearSingleAdaptation(entry.id); }}
                                                                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-none opacity-0 group-hover:opacity-100 transition-all mr-1"
                                                                            title="Reset Adaptation"
                                                                        >
                                                                            <Trash2 size={14} />
                                                                        </button>
                                                                    )}
                                                                    <ChevronDown size={14} className="text-gray-400 mt-1"/>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                                {state.draftWikiEntries.length === 0 && <p className="text-gray-400 italic text-center p-4">Add wiki entries to see integration list.</p>}
                                            </div>
                                        )}
                                    </div>
                                    
                                    {/* Action Bar */}
                                    <div className="bg-gray-100 p-2 border-t border-gray-200 flex justify-between items-center text-xs">
                                         <div className="flex gap-2">
                                            <button onClick={() => handleWorldHistoryNav('prev')} disabled={state.draftWorldMetaIndex <= 0} className="p-1 hover:text-gray-800 disabled:opacity-30"><Undo size={14}/></button>
                                            <span className="font-bold text-gray-500 pt-1">v{state.draftWorldMetaIndex + 1}</span>
                                            <button onClick={() => handleWorldHistoryNav('next')} disabled={state.draftWorldMetaIndex >= state.draftWorldMetaHistory.length - 1} className="p-1 hover:text-gray-800 disabled:opacity-30"><Redo size={14}/></button>
                                         </div>
                                         <div className="flex gap-2">
                                              <button onClick={() => setShowAiAssistant(!showAiAssistant)} className={`flex items-center gap-1 font-bold hover:text-[#990000] ${showAiAssistant ? 'text-[#990000]' : 'text-gray-600'}`}>
                                                 <MessageSquare size={12}/> AI Assistant
                                              </button>
                                             <button onClick={() => handleAutoEnhance(previewTab)} className="flex items-center gap-1 font-bold text-gray-600 hover:text-[#990000]">
                                                 <Sparkles size={12}/> Auto-Enhance {previewTab}
                                              </button>
                                             <HoldToDeleteButton onDelete={() => handleClearSection(previewTab)} className="flex items-center gap-1 font-bold text-gray-600 hover:text-red-600 px-2 py-0.5" label="Hold to Clear Section">
                                                 <Trash size={12}/> Clear {previewTab}
                                             </HoldToDeleteButton>
                                         </div>
                                    </div>

                                    {/* AI Assistant Panel */}
                                    {showAiAssistant && (
                                        <div className="border-t border-gray-300 bg-gray-50 p-3">
                                            <label className="block text-xs font-bold text-[#990000] mb-1">AI World Logic Assistant ({previewTab})</label>
                                            <div className="flex gap-2 items-start">
                                                <textarea 
                                                    value={aiAssistantPrompt} 
                                                    onChange={e => setAiAssistantPrompt(e.target.value)}
                                                    placeholder={`Ask to modify ${previewTab}... (e.g. "Add a war in 1999", "Make X stronger")`}
                                                    className="flex-1 p-2 text-sm border border-gray-300 rounded-none focus:border-[#990000] outline-none resize-y"
                                                    rows={2}
                                                    onKeyDown={e => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAiAssist(); } }}
                                                />
                                                <button 
                                                    onClick={handleAiAssist} 
                                                    disabled={isAiAssistantThinking || !aiAssistantPrompt}
                                                    className="bg-[#990000] text-white px-3 font-bold hover:bg-[#770000] disabled:opacity-50 rounded-none h-full"
                                                >
                                                    {isAiAssistantThinking ? <Loader2 size={14} className="animate-spin"/> : <ArrowRight size={14}/>}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* --- VIEW: SIMULATION --- */}
        {state.view === 'simulation' && currentSession && (
            <SimulationReader 
                session={currentSession}
                onUpdateSession={handleUpdateCurrentSession}
                onExit={() => setState(prev => ({ ...prev, view: 'dashboard' }))}
                isGenerating={state.isGenerating}
                setIsGenerating={(val) => setState(prev => ({ ...prev, isGenerating: val }))}
                onForkSession={handleForkSession}
                library={state.library}
                onAddToLibrary={handleAddToLibrary}
                onRemoveFromLibrary={handleRemoveFromLibrary}
                onQuotaExhausted={handleQuotaExhausted}
            />
        )}
        
        {/* --- MODAL: INTEGRATION DETAIL --- */}
        {viewingAdaptationId && (
            <div ref={integrationDetailRef} className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                <div className="bg-white max-w-lg w-full rounded-none shadow-2xl border border-gray-400">
                    <div className="p-4 border-b border-[#990000] flex justify-between items-center bg-gray-50">
                        <h3 className="font-bold text-[#990000] font-ao3-serif text-lg">
                            Adaptation: {state.draftWikiEntries.find(e => e.id === viewingAdaptationId)?.name}
                        </h3>
                        <button onClick={() => setViewingAdaptationId(null)}><X size={20} className="text-gray-500 hover:text-[#990000]"/></button>
                    </div>
                    
                    <div className="p-6 space-y-4">
                        {/* Auto-Adapt Button */}
                        <div className="bg-blue-50 p-3 border border-blue-100 flex gap-2 rounded-none mb-4 items-start">
                             <textarea 
                                value={aiAdaptPrompt}
                                onChange={e => setAiAdaptPrompt(e.target.value)}
                                placeholder="Instructions (e.g. 'Make them a villain')"
                                className="flex-1 text-sm p-2 border border-blue-200 outline-none rounded-none resize-none"
                                rows={2}
                                onKeyDown={e => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAiAdapt(); } }}
                             />
                             <button 
                                onClick={handleAiAdapt}
                                disabled={isAiAdapting}
                                className="bg-blue-700 text-white px-3 font-bold text-xs hover:bg-blue-800 disabled:opacity-50 rounded-none flex items-center gap-1 h-full py-2"
                             >
                                 {isAiAdapting ? <Loader2 size={12} className="animate-spin"/> : <Sparkles size={12}/>} Auto
                             </button>
                        </div>

                        {(() => {
                            const entry = state.draftWikiEntries.find(e => e.id === viewingAdaptationId);
                            const existing = currentWorldMeta?.entityAdaptations?.[viewingAdaptationId!] || {
                                entryId: viewingAdaptationId!,
                                adaptedName: entry?.name || '',
                                role: '',
                                status: '',
                                whereabouts: '',
                                description: ''
                            };
                            
                            // Initialize local edit state if not set
                            if (!editAdaptationValues || editAdaptationValues.entryId !== viewingAdaptationId) {
                                setEditAdaptationValues(existing);
                                return null; // Wait for re-render with state set
                            }

                            return (
                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Adapted Name</label>
                                        <textarea 
                                            value={editAdaptationValues.adaptedName}
                                            onChange={e => setEditAdaptationValues({...editAdaptationValues!, adaptedName: e.target.value})}
                                            className="w-full p-2 border border-gray-300 rounded-none focus:border-[#990000] outline-none text-sm font-bold resize-y"
                                            rows={1}
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Role / Job</label>
                                            <textarea 
                                                value={editAdaptationValues.role}
                                                onChange={e => setEditAdaptationValues({...editAdaptationValues!, role: e.target.value})}
                                                className="w-full p-2 border border-gray-300 rounded-none focus:border-[#990000] outline-none text-sm resize-y"
                                                rows={1}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Status</label>
                                            <textarea 
                                                value={editAdaptationValues.status}
                                                onChange={e => setEditAdaptationValues({...editAdaptationValues!, status: e.target.value})}
                                                className="w-full p-2 border border-gray-300 rounded-none focus:border-[#990000] outline-none text-sm resize-y"
                                                rows={1}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Whereabouts</label>
                                        <textarea 
                                            value={editAdaptationValues.whereabouts}
                                            onChange={e => setEditAdaptationValues({...editAdaptationValues!, whereabouts: e.target.value})}
                                            className="w-full p-2 border border-gray-300 rounded-none focus:border-[#990000] outline-none text-sm resize-y"
                                            rows={1}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Integration Description</label>
                                        <textarea 
                                            value={editAdaptationValues.description}
                                            onChange={e => setEditAdaptationValues({...editAdaptationValues!, description: e.target.value})}
                                            className="w-full p-2 border border-gray-300 rounded-none focus:border-[#990000] outline-none text-sm h-32 resize-y"
                                            placeholder="How do they fit into this world?"
                                        />
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                    
                    <div className="p-4 bg-gray-50 border-t border-gray-300 flex justify-end gap-2">
                        <button onClick={() => setViewingAdaptationId(null)} className="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-200 rounded-none">Cancel</button>
                        <button onClick={() => { handleSaveAdaptation(); setViewingAdaptationId(null); }} className="px-4 py-2 text-sm font-bold bg-[#990000] text-white hover:bg-[#770000] rounded-none shadow-sm">Save Changes</button>
                    </div>
                </div>
            </div>
        )}
      </div>
  );
};

export default App;