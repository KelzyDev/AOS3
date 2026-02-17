
import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { SimulationSession, StoryNode, SimulationMode, NarrativeEvent, WikiEntry, DirectorMode, TokenUsage, ToneType, CanonStrictness, NarrativeStructure, SceneState, MODEL_OPTIONS, Consequence, AdaptedEntity } from '../types';
import { generateStorySegment, generateSimulationBriefing, adaptSingleEntity } from '../services/geminiService';
import { Loader2, RefreshCw, Edit3, ArrowRight, ArrowLeft, Globe, X, Crown, List, Terminal, GitFork, MapPin, Book, UserPlus, ChevronLeft, ChevronRight, GitBranch, MessageSquare, Users, Cpu, Check, Video, Zap, AlertTriangle, Clapperboard, HeartPulse, Activity, Trash2, Edit2, Save, Copy, Network, Sparkles, HelpCircle, CornerDownRight } from 'lucide-react';
import { TypewriterMarkdown } from './TypewriterMarkdown';
import { WikiImporter } from './WikiImporter';
import { useModalAccessibility } from '../hooks/useModalAccessibility';

interface SimulationReaderProps {
  session: SimulationSession;
  onUpdateSession: (updates: Partial<SimulationSession>) => void;
  onExit: () => void;
  isGenerating: boolean;
  setIsGenerating: (val: boolean) => void;
  onForkSession: (messageIndex: number) => void;
  library: WikiEntry[];
  onAddToLibrary: (entry: WikiEntry) => void;
  onRemoveFromLibrary: (id: string) => void;
  onQuotaExhausted?: () => void;
}

export const SimulationReader: React.FC<SimulationReaderProps> = ({ 
    session, 
    onUpdateSession, 
    onExit, 
    isGenerating, 
    setIsGenerating, 
    onForkSession,
    library,
    onAddToLibrary,
    onRemoveFromLibrary,
    onQuotaExhausted
}) => {
  const [input, setInput] = useState('');
  const [showWorldInfo, setShowWorldInfo] = useState(false);
  const [showStoryLog, setShowStoryLog] = useState(false);
  const [showAddLore, setShowAddLore] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [showDirectorsBoard, setShowDirectorsBoard] = useState(false);
  const [directorsBoardTab, setDirectorsBoardTab] = useState<'scene'|'timeline'|'hierarchy'>('scene');
  const [activeHierarchyTab, setActiveHierarchyTab] = useState<string>('Power');
  
  const [viewingCharacter, setViewingCharacter] = useState<WikiEntry | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editInput, setEditInput] = useState('');
  
  // Telltale Choices State
  const [expandedChoiceNodeId, setExpandedChoiceNodeId] = useState<string | null>(null);
  
  // Consequence Editing State
  const [editingConsequenceId, setEditingConsequenceId] = useState<string | null>(null);
  const [editConsequenceText, setEditConsequenceText] = useState('');
  
  // Adaptation/Integration Editing State (Local to Reader for mid-game edits)
  const [editingAdaptationId, setEditingAdaptationId] = useState<string | null>(null);
  const [editAdaptationValues, setEditAdaptationValues] = useState<AdaptedEntity | null>(null);
  const [aiAdaptPrompt, setAiAdaptPrompt] = useState('');
  const [isAiAdapting, setIsAiAdapting] = useState(false);

  // Track which message has already been animated
  const [animatedMessageIds, setAnimatedMessageIds] = useState<Set<string>>(new Set());
  
  // Transient Error State
  const [generationError, setGenerationError] = useState<string | null>(null);
  
  const storyContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Accessibility hooks for modals
  const worldInfoModalRef = useModalAccessibility(showWorldInfo, () => setShowWorldInfo(false));
  const storyLogModalRef = useModalAccessibility(showStoryLog, () => setShowStoryLog(false));
  const addLoreModalRef = useModalAccessibility(showAddLore, () => setShowAddLore(false));
  const rosterModalRef = useModalAccessibility(showRoster, () => setShowRoster(false));
  const directorsBoardRef = useModalAccessibility(showDirectorsBoard, () => setShowDirectorsBoard(false));
  const bioModalRef = useModalAccessibility(!!viewingCharacter, () => setViewingCharacter(null));
  const adaptationModalRef = useModalAccessibility(!!editingAdaptationId, () => setEditingAdaptationId(null));
  
  const characters = useMemo(() => session.wikiEntries.filter(e => e.category === 'Character'), [session.wikiEntries]);

  // Host Fandom Options for World Info Modal
  const hostOptions = useMemo(() => {
     const options = new Set<string>();
     session.config.fandoms.forEach(f => options.add(f));
     session.wikiEntries.forEach(e => {
         if (['World', 'Location', 'Facility', 'Country'].includes(e.category)) {
             options.add(e.name);
         }
     });
     return Array.from(options).sort();
  }, [session.config.fandoms, session.wikiEntries]);

  const currentHostValue = session.config.hostFandom;
  const hostSelectValue = useMemo(() => {
    if (currentHostValue === undefined) return 'MIXED';
    if (currentHostValue === '' || !hostOptions.includes(currentHostValue)) return 'CUSTOM';
    return currentHostValue;
  }, [currentHostValue, hostOptions]);

  // --- Tree Traversal & History Reconstruction ---

  const currentHistory = useMemo(() => {
    const history: StoryNode[] = [];
    if (!session.messageTree || !session.currentLeafId) return history;

    let currId: string | null = session.currentLeafId;
    while (currId && session.messageTree[currId]) {
        history.unshift(session.messageTree[currId]);
        currId = session.messageTree[currId].parentId;
    }
    return history;
  }, [session.messageTree, session.currentLeafId]);

  // --- Initial Mount Logic (Briefing & Typewriter Prevention) ---
  useEffect(() => {
    // 1. Prevent Typewriter on existing messages on reload
    if (currentHistory.length > 0) {
        const existingIds = new Set(currentHistory.map(n => n.id));
        setAnimatedMessageIds(existingIds);
    }

    // 2. If empty tree, generate briefing
    if ((!session.messageTree || Object.keys(session.messageTree).length === 0) && !isGenerating) {
      handleStartBriefing();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); 

  // --- Smart Auto-scroll ---
  useEffect(() => {
    const container = storyContainerRef.current;
    if (!container) return;
    
    // Only auto-scroll if user is near the bottom (e.g., within 150px)
    const isScrolledToBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 150;
    
    if (!isGenerating && isScrolledToBottom) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [currentHistory.length, isGenerating]);
  
  // Autosize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    setGenerationError(null); // Clear error on typing
    if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  };


  // --- Logic ---
  
  const handleCancelGeneration = () => {
    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
    }
    setIsGenerating(false);
    setGenerationError(null);
  }

  const updateUsageStats = (newUsage?: TokenUsage) => {
    if (!newUsage) return;
    const currentStats = session.usageStats || { promptTokens: 0, responseTokens: 0, totalTokens: 0 };
    onUpdateSession({
        usageStats: {
            promptTokens: currentStats.promptTokens + newUsage.promptTokens,
            responseTokens: currentStats.responseTokens + newUsage.responseTokens,
            totalTokens: currentStats.totalTokens + newUsage.totalTokens
        }
    });
  };

  const handleStartBriefing = async () => {
    handleCancelGeneration();
    setGenerationError(null);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsGenerating(true);

    try {
        const response = await generateSimulationBriefing(session, controller.signal);
        
        updateUsageStats(response.usage);

        const newNode: StoryNode = {
            id: crypto.randomUUID(),
            parentId: null,
            childrenIds: [],
            role: 'model',
            content: response.content,
            timestamp: Date.now(),
            suggestions: response.suggestions
        };

        const initialEvents = (response.newKeyEvents || []).map(evt => ({
            id: crypto.randomUUID(),
            description: evt.description || "Story Begins",
            inStoryTime: evt.inStoryTime || "Start",
            realTimestamp: Date.now()
        })) as NarrativeEvent[];

        onUpdateSession({ 
          messageTree: { [newNode.id]: newNode },
          currentLeafId: newNode.id,
          lastModified: Date.now(),
          narrativeEvents: [...(session.narrativeEvents || []), ...initialEvents]
        });
    } catch(e: any) {
        if (e.name !== 'AbortError') {
            console.error(e);
            if (e.message && (e.message.includes('429') || e.message.includes('Resource has been exhausted'))) {
                if (onQuotaExhausted) onQuotaExhausted();
            } else {
                setGenerationError(e.message || "Failed to generate briefing.");
            }
        }
    } finally {
        setIsGenerating(false);
        abortControllerRef.current = null;
    }
  };

  const handleGenerate = async (prompt: string, parentNodeId: string | null = null) => {
    handleCancelGeneration();
    setGenerationError(null);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsGenerating(true);
    
    const effectiveParentId = parentNodeId || session.currentLeafId;

    const userNode: StoryNode = {
        id: crypto.randomUUID(),
        parentId: effectiveParentId,
        childrenIds: [],
        role: 'user',
        content: prompt,
        timestamp: Date.now()
    };

    let updatedTree = { ...session.messageTree };
    updatedTree[userNode.id] = userNode;
    if (effectiveParentId && updatedTree[effectiveParentId]) {
        updatedTree[effectiveParentId] = {
            ...updatedTree[effectiveParentId],
            childrenIds: [...updatedTree[effectiveParentId].childrenIds, userNode.id]
        };
    }
    // We update session here so user sees their message immediately
    onUpdateSession({ messageTree: updatedTree, currentLeafId: userNode.id, lastModified: Date.now() });
    
    // Add User Node to animated list immediately so it doesn't type
    setAnimatedMessageIds(prev => new Set(prev).add(userNode.id));

    const historyForAi: StoryNode[] = [];
    let currId: string | null = userNode.id;
    while(currId && updatedTree[currId]) {
        historyForAi.unshift(updatedTree[currId]);
        currId = updatedTree[currId].parentId;
    }
    
    try {
        const response = await generateStorySegment(session, historyForAi, "", controller.signal);
        
        updateUsageStats(response.usage);

        const aiNode: StoryNode = {
            id: crypto.randomUUID(),
            parentId: userNode.id,
            childrenIds: [],
            role: 'model',
            content: response.content,
            suggestions: response.suggestions,
            choices: response.choices,
            timestamp: Date.now()
        };

        updatedTree[aiNode.id] = aiNode;
        updatedTree[userNode.id] = { ...updatedTree[userNode.id], childrenIds: [aiNode.id] };

        // Process Updates from AI (Consequences, Emotions)
        const newEvents = (response.newKeyEvents || []).map(evt => ({
            id: crypto.randomUUID(),
            description: evt.description || "Unknown Event",
            inStoryTime: evt.inStoryTime || "Unknown Time",
            realTimestamp: Date.now()
        })) as NarrativeEvent[];

        let updatedCharStates = { ...session.characterStates };
        if (response.updatedCharacterStates) {
            response.updatedCharacterStates.forEach(st => {
                updatedCharStates[st.characterId] = st;
            });
        }

        let updatedConsequences = [ ...(session.consequences || []) ];
        if (response.newConsequences) {
            response.newConsequences.forEach(c => {
                const existingIdx = updatedConsequences.findIndex(ex => ex.id === c.id || ex.name === c.name);
                if (existingIdx !== -1) {
                     updatedConsequences[existingIdx] = { ...updatedConsequences[existingIdx], ...c };
                } else {
                     if (!c.id) c.id = crypto.randomUUID();
                     updatedConsequences.push(c);
                }
            });
        }
        
        onUpdateSession({ 
          messageTree: updatedTree,
          currentLeafId: aiNode.id,
          lastModified: Date.now(),
          narrativeEvents: [...(session.narrativeEvents || []), ...newEvents],
          characterStates: updatedCharStates,
          consequences: updatedConsequences
        });
        setInput('');
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }
    } catch(e: any) {
        if (e.name === 'AbortError') {
            let treeAfterCancel = { ...session.messageTree };
            delete treeAfterCancel[userNode.id];
            if (effectiveParentId && treeAfterCancel[effectiveParentId]) {
                treeAfterCancel[effectiveParentId] = {
                    ...treeAfterCancel[effectiveParentId],
                    childrenIds: treeAfterCancel[effectiveParentId].childrenIds.filter(id => id !== userNode.id)
                };
            }
            onUpdateSession({ messageTree: treeAfterCancel, currentLeafId: effectiveParentId });
            return;
        } else if (e.message && (e.message.includes('429') || e.message.includes('Resource has been exhausted'))) {
            if (onQuotaExhausted) onQuotaExhausted();
        } else {
             console.error("Story Generation Error:", e);
             setGenerationError(e.message || "An unknown error occurred during generation.");
        }
    } finally {
        setIsGenerating(false);
        abortControllerRef.current = null;
    }
  };

  const handleBranchSelect = (targetNodeId: string) => {
      onUpdateSession({ currentLeafId: targetNodeId });
      setShowDirectorsBoard(false);
      setGenerationError(null);
  };

  const startEditing = (node: StoryNode) => {
      setEditingNodeId(node.id);
      setEditInput(node.content);
  };

  const cancelEditing = () => {
      setEditingNodeId(null);
      setEditInput('');
  };

  const submitEdit = (originalNode: StoryNode) => {
      if (!editInput.trim() || editInput === originalNode.content) {
          cancelEditing();
          return;
      }
      
      if (originalNode.role === 'model') {
         const newNode: StoryNode = {
             ...originalNode,
             id: crypto.randomUUID(),
             content: editInput,
             childrenIds: [],
             timestamp: Date.now()
         };
         
         let updatedTree = { ...session.messageTree };
         updatedTree[newNode.id] = newNode;
         
         if (originalNode.parentId && updatedTree[originalNode.parentId]) {
             updatedTree[originalNode.parentId] = {
                 ...updatedTree[originalNode.parentId],
                 childrenIds: [...updatedTree[originalNode.parentId].childrenIds, newNode.id]
             };
         }
         
         onUpdateSession({ messageTree: updatedTree, currentLeafId: newNode.id });
      } else {
         handleGenerate(editInput, originalNode.parentId);
      }
      cancelEditing();
  };

  const handleRegenerate = (node: StoryNode) => {
      if (node.role !== 'model' || isGenerating) return;
      if (!node.parentId) {
          handleStartBriefing();
          return;
      }
      
      const parentNode = session.messageTree[node.parentId];
      
      const historyForAi: StoryNode[] = [];
      let currId: string | null = parentNode.id;
      while(currId && session.messageTree[currId]) {
          historyForAi.unshift(session.messageTree[currId]);
          currId = session.messageTree[currId].parentId;
      }

      handleCancelGeneration();
      setGenerationError(null);
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsGenerating(true);

      generateStorySegment(session, historyForAi, "", controller.signal)
        .then(response => {
             updateUsageStats(response.usage);

             const newAiNode: StoryNode = {
                 id: crypto.randomUUID(),
                 parentId: parentNode.id,
                 childrenIds: [],
                 role: 'model',
                 content: response.content,
                 suggestions: response.suggestions,
                 choices: response.choices,
                 timestamp: Date.now()
             };

             let updatedTree = { ...session.messageTree };
             updatedTree[newAiNode.id] = newAiNode;
             updatedTree[parentNode.id] = {
                 ...updatedTree[parentNode.id],
                 childrenIds: [...updatedTree[parentNode.id].childrenIds, newAiNode.id]
             };

             onUpdateSession({ 
                 messageTree: updatedTree, 
                 currentLeafId: newAiNode.id,
                 lastModified: Date.now() 
             });
        }).catch((e: any) => {
            if(e.name !== 'AbortError') {
                console.error("Regeneration failed", e);
                if (e.message && (e.message.includes('429') || e.message.includes('Resource has been exhausted'))) {
                    if (onQuotaExhausted) onQuotaExhausted();
                } else {
                    setGenerationError(e.message || "Regeneration failed.");
                }
            }
        }).finally(() => {
             setIsGenerating(false);
             abortControllerRef.current = null;
        });
  };
  
  const handleRetryLastAction = () => {
      if (currentLastNode?.role === 'user') {
          handleCancelGeneration();
          setGenerationError(null);
          const controller = new AbortController();
          abortControllerRef.current = controller;
          setIsGenerating(true);
          
          const historyForAi: StoryNode[] = [];
          let currId: string | null = currentLastNode.id;
          while(currId && session.messageTree[currId]) {
              historyForAi.unshift(session.messageTree[currId]);
              currId = session.messageTree[currId].parentId;
          }
          
          generateStorySegment(session, historyForAi, "", controller.signal)
            .then(response => {
                 updateUsageStats(response.usage);
                 const aiNode: StoryNode = {
                     id: crypto.randomUUID(),
                     parentId: currentLastNode.id,
                     childrenIds: [],
                     role: 'model',
                     content: response.content,
                     suggestions: response.suggestions,
                     choices: response.choices,
                     timestamp: Date.now()
                 };
                 let updatedTree = { ...session.messageTree };
                 updatedTree[aiNode.id] = aiNode;
                 updatedTree[currentLastNode.id] = { ...updatedTree[currentLastNode.id], childrenIds: [aiNode.id] };
                 onUpdateSession({ messageTree: updatedTree, currentLeafId: aiNode.id, lastModified: Date.now() });
            })
            .catch(e => {
                 if (e.name !== 'AbortError') {
                     if (e.message?.includes('429')) onQuotaExhausted?.();
                     else setGenerationError(e.message);
                 }
            })
            .finally(() => {
                setIsGenerating(false);
                abortControllerRef.current = null;
            });
      }
  }

  const handleImportMidStory = (entry: WikiEntry) => {
      const updatedEntries = [...session.wikiEntries, entry];
      let updatedFandoms = session.config.fandoms;
      if (entry.fandom && !updatedFandoms.includes(entry.fandom)) {
          updatedFandoms = [...updatedFandoms, entry.fandom];
      }
      onUpdateSession({ 
          wikiEntries: updatedEntries,
          config: { ...session.config, fandoms: updatedFandoms }
      });
      setInput(`[META: The timeline acknowledges the sudden appearance of ${entry.name} (${entry.category}).]`);
      setShowAddLore(false);
  };

  const handleAnimationComplete = (id: string) => {
      setAnimatedMessageIds(prev => new Set(prev).add(id));
      const container = storyContainerRef.current;
      if (container) {
          const isScrolledToBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 150;
          if (isScrolledToBottom) {
              bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
          }
      }
  };
  
  const handleCopyText = (text: string) => {
      navigator.clipboard.writeText(text);
  };
  
  // --- Consequence Management ---
  const handleUpdateConsequence = (id: string) => {
      if (!editConsequenceText.trim()) return;
      const updated = session.consequences.map(c => 
          c.id === id ? { ...c, description: editConsequenceText } : c
      );
      onUpdateSession({ consequences: updated });
      setEditingConsequenceId(null);
  };
  
  const handleDeleteConsequence = (id: string) => {
      const updated = session.consequences.filter(c => c.id !== id);
      onUpdateSession({ consequences: updated });
  };
  
  // --- Integration/Adaptation Edit Logic ---
  const handleSaveAdaptation = () => {
    if (!editingAdaptationId || !editAdaptationValues) return;
    
    // Create new Meta object (copying existing)
    const currentMeta = session.worldMeta || { timeline: [], hierarchy: {}, entityAdaptations: {} };
    const newAdaptations = { ...currentMeta.entityAdaptations };
    newAdaptations[editingAdaptationId] = editAdaptationValues;
    
    onUpdateSession({ worldMeta: { ...currentMeta, entityAdaptations: newAdaptations } });
    // Keep modal open or closed? Let's close it on save.
    setEditingAdaptationId(null);
  };

  const handleAiAdapt = async () => {
    if (!editingAdaptationId) return;
    const entry = session.wikiEntries.find(e => e.id === editingAdaptationId);
    if (!entry) return;
    
    setIsAiAdapting(true);
    try {
        const adapted = await adaptSingleEntity(entry, session.config, aiAdaptPrompt);
        setEditAdaptationValues(adapted);
        setAiAdaptPrompt('');
    } catch (e: any) {
         console.error(e);
         alert("Adaptation failed.");
    } finally {
        setIsAiAdapting(false);
    }
  };

  // --- Render Helpers ---

  const renderNav = (node: StoryNode) => {
      if (!node.parentId) return null;
      const parent = session.messageTree[node.parentId];
      const count = parent.childrenIds.length;
      if (count <= 1) return null;

      const index = parent.childrenIds.indexOf(node.id);
      
      return (
          <div className="flex items-center gap-2 text-xs font-bold text-gray-400 select-none">
              <button 
                onClick={() => {
                     const siblingId = parent.childrenIds[Math.max(0, index - 1)];
                     let tracerId = siblingId;
                     while (session.messageTree[tracerId] && session.messageTree[tracerId].childrenIds.length > 0) {
                        const childs = session.messageTree[tracerId].childrenIds;
                        tracerId = childs[childs.length - 1]; 
                     }
                     onUpdateSession({ currentLeafId: tracerId });
                     setGenerationError(null);
                }}
                disabled={index === 0}
                className="hover:text-gray-800 disabled:opacity-30 p-1"
                aria-label="Previous branch"
              >
                  <ChevronLeft size={14} />
              </button>
              <span>{index + 1} / {count}</span>
              <button 
                onClick={() => {
                     const siblingId = parent.childrenIds[Math.min(count - 1, index + 1)];
                     let tracerId = siblingId;
                     while (session.messageTree[tracerId] && session.messageTree[tracerId].childrenIds.length > 0) {
                        const childs = session.messageTree[tracerId].childrenIds;
                        tracerId = childs[childs.length - 1]; 
                     }
                     onUpdateSession({ currentLeafId: tracerId });
                     setGenerationError(null);
                }}
                disabled={index === count - 1}
                className="hover:text-gray-800 disabled:opacity-30 p-1"
                aria-label="Next branch"
              >
                  <ChevronRight size={14} />
              </button>
          </div>
      );
  };
  
  const currentLastNode = currentHistory.length > 0 ? currentHistory[currentHistory.length - 1] : null;

  return (
    <>
      <div className="max-w-6xl mx-auto bg-white min-h-screen shadow-lg border-x border-gray-300 flex flex-col relative font-ao3-sans">
        {/* Header Info */}
        <header className="p-4 border-b border-[#770000] bg-[#990000] text-white flex flex-col md:flex-row md:items-center gap-4 sticky top-0 z-40 shadow-md z-50">
          <div className="flex items-center gap-4 flex-1">
            <button 
                onClick={onExit}
                className="p-2 hover:bg-[#770000] text-white transition-colors border border-white/20 rounded-none"
                aria-label="Back to Dashboard"
            >
                <ArrowLeft size={20} />
            </button>
            <div className="flex-1">
                <h1 className="font-ao3-serif text-xl md:text-2xl text-white mb-1 leading-none font-bold">
                {session.config.title || "Untitled Simulation"}
                </h1>
                <div className="flex items-center gap-3 text-xs text-white/90 font-mono mt-1 w-fit">
                    <span className="flex items-center gap-1" title="Estimated session token usage (Input + Output)">
                        <Zap size={12} className="text-yellow-300" />
                        <strong>{(session.usageStats?.totalTokens || 0).toLocaleString()}</strong> Tokens
                    </span>
                    <span className="text-white/50">|</span>
                    <div className="flex items-center gap-1">
                        <Cpu size={12} className="text-blue-300" />
                        <select
                            value={session.config.model}
                            onChange={(e) => onUpdateSession({ config: { ...session.config, model: e.target.value } })}
                            className="bg-transparent outline-none border-none cursor-pointer text-white font-bold max-w-[150px] truncate hover:text-white/80"
                            title="Switch AI Model"
                        >
                            {MODEL_OPTIONS.map(opt => (
                                <option key={opt.id} value={opt.id} className="text-gray-900">{opt.label}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <div className="hidden sm:flex items-center gap-0 border border-white/30 rounded-none overflow-hidden" role="group" aria-label="Simulation Mode">
                <button onClick={() => onUpdateSession({ config: {...session.config, simulationMode: SimulationMode.Director} })} className={`px-3 py-1 text-sm font-bold ${session.config.simulationMode === SimulationMode.Director ? 'bg-white text-[#990000]' : 'bg-[#770000] text-white hover:bg-[#660000]'}`}>Director</button>
                <button onClick={() => onUpdateSession({ config: {...session.config, simulationMode: SimulationMode.Actor} })} className={`px-3 py-1 text-sm font-bold ${session.config.simulationMode === SimulationMode.Actor ? 'bg-white text-[#990000]' : 'bg-[#770000] text-white hover:bg-[#660000]'}`}>Actor</button>
            </div>
            
            <div className="flex gap-2">
                <button 
                  onClick={() => setShowAddLore(true)}
                  className="bg-white text-[#990000] border border-white px-3 py-2 text-sm font-bold flex items-center gap-2 hover:bg-gray-100 rounded-none shadow-sm"
                  aria-label="Add Character or Lore Mid-Story"
                >
                    <UserPlus size={16} />
                </button>
               <button 
                  onClick={() => setShowDirectorsBoard(true)}
                  className="bg-[#770000] text-white border border-[#550000] px-3 py-2 text-sm font-bold flex items-center gap-2 hover:bg-[#660000] rounded-none shadow-sm"
                  aria-label="Director Board & Scene Manager"
                  title="Director Board & Scene Manager"
              >
                  <Clapperboard size={16} />
              </button>
               <button 
                  onClick={() => setShowRoster(true)}
                  className="bg-white text-[#990000] border border-white px-3 py-2 text-sm font-bold flex items-center gap-2 hover:bg-gray-100 rounded-none shadow-sm"
                  aria-label="Open Character Roster"
              >
                  <Users size={16} />
              </button>
              <button 
                  onClick={() => setShowWorldInfo(true)}
                  className="bg-[#770000] text-white px-3 py-2 text-sm font-bold flex items-center gap-2 hover:bg-[#660000] rounded-none shadow-sm border border-[#550000]"
                  aria-label="Open Narrative Engine Controls"
              >
                  <Globe size={16} />
              </button>
            </div>
          </div>
        </header>

        <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative bg-gray-100">
          
          {session.config.simulationMode === SimulationMode.Director && (
            <aside className="hidden md:flex flex-col w-64 bg-white border-r border-gray-300 p-4 sticky top-[73px] h-[calc(100vh-73px)] overflow-y-auto shadow-sm">
                <h2 className="flex items-center gap-2 font-bold text-[#990000] uppercase text-xs mb-4 border-b border-gray-200 pb-2">
                <MessageSquare size={14} /> Recommended Actions
                </h2>
                {!isGenerating && currentLastNode?.role === 'model' && currentLastNode.suggestions ? (
                    <div className="space-y-2">
                        {currentLastNode?.suggestions?.map((s, i) => (
                            <button 
                                key={i}
                                onClick={() => handleGenerate(s)}
                                className="w-full text-left text-sm bg-gray-50 hover:bg-white text-gray-800 border border-gray-300 hover:border-[#990000] p-3 shadow-sm rounded-none transition-all duration-200 font-ao3-sans"
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="text-gray-400 text-sm italic text-center mt-10 font-ao3-serif">
                        {isGenerating ? "AI is thinking..." : "Waiting for narrative..."}
                    </div>
                )}
            </aside>
          )}

          <main className="flex-1 flex flex-col h-[calc(100vh-73px)] overflow-hidden bg-white">
            <article ref={storyContainerRef} className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 scroll-smooth">
                {currentHistory.length === 0 && !isGenerating && (
                    <div className="text-center p-12 text-gray-400 font-ao3-serif italic">
                        Initializing narrative engine...
                    </div>
                )}
                
                {currentHistory.map((node, idx) => {
                    const isFirstMessage = idx === 0 && node.role === 'model';
                    const isLastMessage = idx === currentHistory.length - 1;
                    const shouldAnimate = isLastMessage && node.role === 'model' && !animatedMessageIds.has(node.id) && !isGenerating;
                    const isUser = node.role === 'user';
                    
                    const hasChoices = (node.choices?.length ?? 0) > 0;
                    const hasSuggestions = (node.suggestions?.length ?? 0) > 0;
                    // Telltale Indicators are usually for Actor choices, but we support Suggestions as decision points too if desired
                    const isDecisionPoint = hasChoices || (session.config.simulationMode === SimulationMode.Director && hasSuggestions);
                    const isChoicesExpanded = expandedChoiceNodeId === node.id;

                    if (editingNodeId === node.id) {
                        return (
                            <div key={node.id} className="bg-gray-50 p-4 border border-gray-300 rounded-none shadow-inner">
                                <label htmlFor={`edit-area-${node.id}`} className="sr-only">Edit entry</label>
                                <textarea
                                    id={`edit-area-${node.id}`}
                                    value={editInput}
                                    onChange={(e) => setEditInput(e.target.value)}
                                    className="w-full p-2 border border-gray-300 min-h-[100px] mb-2 font-ao3-serif bg-white focus:ring-1 focus:ring-[#990000] focus:border-[#990000] outline-none rounded-none"
                                />
                                <div className="flex gap-2 justify-end">
                                    <button onClick={cancelEditing} className="px-3 py-1 bg-gray-200 text-gray-700 text-xs font-bold rounded-none hover:bg-gray-300">Cancel</button>
                                    <button onClick={() => submitEdit(node)} className="px-3 py-1 bg-[#990000] text-white text-xs font-bold rounded-none hover:bg-[#770000]">Save & Branch</button>
                                </div>
                            </div>
                        );
                    }

                    return (
                    <div key={node.id} className={`group relative pb-8 ${isFirstMessage ? 'bg-gray-50 p-6 border border-gray-300 shadow-sm' : ''} ${isUser ? 'pl-8 border-l-4 border-gray-200' : ''}`}>
                        
                        <div className="flex justify-between items-start mb-2 opacity-100 transition-opacity">
                            <div className="flex gap-2 items-center">
                                <span className={`text-xs font-bold uppercase tracking-wider ${isUser ? 'text-gray-500' : 'text-[#990000]'}`}>
                                    {isUser ? (characters.find(c=>c.id === session.config.activeCharacterId)?.name || 'You') : (isFirstMessage ? 'Situation Overview' : 'Chapter ' + (Math.floor(idx/2)+1))}
                                </span>
                                {renderNav(node)}
                            </div>
                            
                            {/* TELLTALE INDICATOR */}
                            {session.config.showTelltaleIndicators && isDecisionPoint && !isUser && (
                                <div className="relative">
                                    <button 
                                        onClick={() => setExpandedChoiceNodeId(isChoicesExpanded ? null : node.id)}
                                        className={`flex items-center gap-1 text-[10px] uppercase font-bold px-2 py-1 rounded-full border transition-all shadow-sm ${isChoicesExpanded ? 'bg-[#990000] text-white border-[#990000]' : 'bg-white text-gray-500 border-gray-300 hover:border-[#990000] hover:text-[#990000]'}`}
                                        title="Choice point — click to view options / toggle branching."
                                        aria-label="Toggle Choice Options"
                                        aria-expanded={isChoicesExpanded}
                                    >
                                        <GitBranch size={12} />
                                        <span>{(node.choices?.length || node.suggestions?.length || 0)} Options</span>
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* EXPANDED CHOICE LIST FOR TELLTALE INDICATOR */}
                        {isChoicesExpanded && (
                            <div className="mb-4 bg-gray-50 border border-gray-200 p-3 rounded-none animate-in fade-in slide-in-from-top-1 duration-200">
                                <h4 className="text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-2">
                                    <CornerDownRight size={12}/> Available Paths at this point:
                                </h4>
                                <div className="space-y-1">
                                    {(node.choices || node.suggestions || []).map((c, i) => (
                                        <div key={i} className="text-sm font-ao3-sans text-gray-700 bg-white border border-gray-200 p-2 shadow-sm flex gap-2">
                                            {typeof c !== 'string' && <span className="font-bold text-[#990000] font-mono">{c.letter}</span>}
                                            <span>{typeof c === 'string' ? c : c.text}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {isFirstMessage && (
                            <h2 className="flex items-center gap-2 mb-4 text-[#990000] font-bold uppercase text-xs tracking-wider border-b border-[#990000] pb-1">
                                <Terminal size={14} /> Simulation Briefing
                            </h2>
                        )}

                        {shouldAnimate ? (
                            <TypewriterMarkdown content={node.content} onComplete={() => handleAnimationComplete(node.id)} />
                        ) : (
                            <div className={`font-ao3-serif text-lg leading-relaxed text-gray-900 prose prose-p:my-4 prose-strong:text-gray-900 max-w-none ${isUser ? 'text-gray-600 italic' : ''}`}>
                            <ReactMarkdown>{node.content}</ReactMarkdown>
                            </div>
                        )}
                        
                        {/* BOTTOM TOOLBAR */}
                        <div className="flex gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                             <button onClick={() => handleCopyText(node.content)} className="flex items-center gap-1 px-2 py-1 text-[10px] uppercase font-bold text-gray-500 hover:text-gray-800 bg-white hover:bg-gray-100 border border-gray-300 rounded-none transition-all" title="Copy Text">
                                <Copy size={12}/> Copy
                             </button>
                             <button onClick={() => startEditing(node)} className="flex items-center gap-1 px-2 py-1 text-[10px] uppercase font-bold text-gray-500 hover:text-blue-700 bg-white hover:bg-blue-50 border border-gray-300 hover:border-blue-300 rounded-none transition-all" title="Edit & Branch">
                                <Edit3 size={12}/> Edit
                             </button>
                             <button onClick={() => onForkSession(idx)} className="flex items-center gap-1 px-2 py-1 text-[10px] uppercase font-bold text-gray-500 hover:text-purple-700 bg-white hover:bg-purple-50 border border-gray-300 hover:border-purple-300 rounded-none transition-all" title="Fork Session Here">
                                <GitFork size={12}/> Branch
                             </button>
                             {!isUser && (
                                 <button onClick={() => handleRegenerate(node)} className="flex items-center gap-1 px-2 py-1 text-[10px] uppercase font-bold text-gray-500 hover:text-green-700 bg-white hover:bg-green-50 border border-gray-300 hover:border-green-300 rounded-none transition-all" title="Regenerate Response">
                                    <RefreshCw size={12}/> Regen
                                 </button>
                             )}
                        </div>
                        
                        {!isFirstMessage && !isUser && <hr className="my-8 border-gray-300 w-1/4 mx-auto border-dashed" />}
                    </div>
                    );
                })}

                {isGenerating && (
                    <div className="flex justify-center items-center py-8">
                    <Loader2 className="animate-spin text-[#990000]" size={32} />
                    <span className="ml-3 font-ao3-serif italic text-gray-500">Writing...</span>
                    </div>
                )}
                <div ref={bottomRef} />
            </article>

            {/* Bottom Interaction Area */}
            <div className="bg-gray-100 border-t border-gray-300 p-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] z-10">
                {generationError && (
                    <div className="bg-red-50 border border-red-300 text-red-800 p-3 mb-3 rounded-none flex justify-between items-center text-sm shadow-sm">
                        <span className="flex items-center gap-2 font-bold"><AlertTriangle size={16}/> {generationError}</span>
                        <div className="flex gap-2">
                            {currentLastNode?.role === 'user' && (
                                <button onClick={handleRetryLastAction} className="font-bold underline hover:text-red-950">Retry</button>
                            )}
                            <button onClick={() => setGenerationError(null)} className="text-red-500 hover:text-red-900"><X size={16}/></button>
                        </div>
                    </div>
                )}
                
                {session.config.simulationMode === SimulationMode.Actor && !isGenerating && currentLastNode?.choices && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                        {currentLastNode.choices.map((choice) => (
                            <button
                                key={choice.letter}
                                onClick={() => handleGenerate(choice.text)}
                                className="text-left p-3 border border-gray-300 bg-white hover:bg-gray-50 hover:border-[#990000] focus:outline-none focus:ring-1 focus:ring-[#990000] transition-all duration-150 shadow-sm rounded-none"
                            >
                                <span className="font-bold font-mono text-lg text-[#990000] mr-3">{choice.letter}</span>
                                <span className="font-ao3-sans">{choice.text}</span>
                            </button>
                        ))}
                    </div>
                )}

                <div className="flex gap-2 bg-white p-2 border border-gray-300 shadow-sm">
                     <label htmlFor="main-input" className="sr-only">{ session.config.simulationMode === SimulationMode.Actor ? "Type your custom action..." : "Enter next scenario..." }</label>
                    <textarea
                        id="main-input"
                        ref={textareaRef}
                        rows={2}
                        value={input}
                        onChange={handleInputChange}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (input.trim() && !isGenerating) handleGenerate(input); } }}
                        placeholder={ session.config.simulationMode === SimulationMode.Actor ? "Type your custom action..." : "Enter next scenario..." }
                        className="flex-1 p-2 outline-none font-ao3-serif text-lg bg-white text-gray-900 resize-none max-h-40 overflow-y-auto placeholder:font-ao3-sans placeholder:text-sm placeholder:text-gray-400"
                        disabled={isGenerating}
                    />
                    {isGenerating ? (
                        <button onClick={handleCancelGeneration} className="bg-gray-600 text-white px-6 py-2 font-bold hover:bg-gray-700 flex flex-col items-center justify-center min-w-[100px] rounded-none">
                            <X size={20} /> <span className="text-xs uppercase mt-1">Cancel</span>
                        </button>
                    ) : (
                        <button onClick={() => handleGenerate(input)} disabled={!input.trim() || isGenerating} className="bg-[#990000] text-white px-6 py-2 font-bold hover:bg-[#770000] disabled:opacity-50 flex flex-col items-center justify-center min-w-[100px] rounded-none transition-colors">
                            <span className="text-xs uppercase mb-1">{session.config.simulationMode === SimulationMode.Director ? 'Direct' : 'Act'}</span>
                            <ArrowRight size={20} />
                        </button>
                    )}
                </div>
            </div>
          </div>
        </div>
      )}

      {/* Directors Board Modal (Integrated Timeline & Scene & Hierarchy) */}
      {showDirectorsBoard && (
          <div ref={directorsBoardRef} className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="directors-board-heading">
              <div className="bg-white max-w-6xl w-full max-h-[90vh] flex flex-col shadow-2xl rounded-none border border-gray-400">
                  <div className="p-4 border-b border-[#770000] flex justify-between items-center bg-[#990000] text-white">
                      <div className="flex items-center gap-6">
                        <h3 id="directors-board-heading" className="font-ao3-serif text-lg font-bold flex items-center gap-2">
                            <Clapperboard size={20} /> Director's Board
                        </h3>
                        <div className="flex gap-2">
                            <button onClick={()=>setDirectorsBoardTab('scene')} className={`px-3 py-1 text-sm font-bold rounded-none border border-white/30 ${directorsBoardTab === 'scene' ? 'bg-white text-[#990000]' : 'text-white hover:bg-[#770000]'}`}>Scene Manager</button>
                            <button onClick={()=>setDirectorsBoardTab('timeline')} className={`px-3 py-1 text-sm font-bold rounded-none border border-white/30 ${directorsBoardTab === 'timeline' ? 'bg-white text-[#990000]' : 'text-white hover:bg-[#770000]'}`}>Timeline</button>
                            <button onClick={()=>setDirectorsBoardTab('hierarchy')} className={`px-3 py-1 text-sm font-bold rounded-none border border-white/30 ${directorsBoardTab === 'hierarchy' ? 'bg-white text-[#990000]' : 'text-white hover:bg-[#770000]'}`}>Hierarchy</button>
                        </div>
                      </div>
                      <button onClick={() => setShowDirectorsBoard(false)} className="text-white hover:bg-[#770000] p-1 rounded-none" aria-label="Close modal">
                          <X size={20} />
                      </button>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto bg-gray-100 p-6">
                    {/* ... (Existing Director Board Content Unchanged) ... */}
                    {directorsBoardTab === 'scene' ? (
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                          {/* Scene Context */}
                          <div className="lg:col-span-1 space-y-6">
                              <div className="bg-white p-4 border border-gray-300 shadow-sm rounded-none">
                                  <h4 className="font-bold text-gray-800 border-b border-gray-200 pb-2 mb-3 flex items-center gap-2">
                                      <MapPin size={16} className="text-[#990000]"/> Scene Context
                                  </h4>
                                  <div className="space-y-4">
                                      <div>
                                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Current Location</label>
                                          <input 
                                              type="text" 
                                              className="w-full p-2 border border-gray-300 text-sm font-bold bg-white rounded-none focus:border-[#990000] outline-none" 
                                              value={session.sceneState?.activeLocation || ''} 
                                              onChange={(e) => onUpdateSession({ sceneState: { ...session.sceneState, activeLocation: e.target.value } })}
                                              placeholder="e.g. The Abandoned Warehouse"
                                          />
                                      </div>
                                      <div>
                                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">AI Director Pacing</label>
                                          <select 
                                              className="w-full p-2 border border-gray-300 text-sm bg-white rounded-none focus:border-[#990000] outline-none"
                                              value={session.sceneState?.currentDirectorMode || DirectorMode.Balanced}
                                              onChange={(e) => onUpdateSession({ sceneState: { ...session.sceneState, currentDirectorMode: e.target.value as DirectorMode } })}
                                          >
                                              <option value={DirectorMode.Balanced}>Balanced (Standard)</option>
                                              <option value={DirectorMode.SlowBurn}>Slow Burn (Character Focus)</option>
                                              <option value={DirectorMode.HighTension}>High Tension (Action/Thriller)</option>
                                              <option value={DirectorMode.Chaotic}>Chaotic (Unpredictable)</option>
                                              <option value={DirectorMode.Minimalist}>Minimalist (Concise)</option>
                                          </select>
                                      </div>
                                  </div>
                              </div>
                              
                              <div className="bg-white p-4 border border-gray-300 shadow-sm rounded-none">
                                  <h4 className="font-bold text-gray-800 border-b border-gray-200 pb-2 mb-3 flex items-center gap-2">
                                      <Users size={16} className="text-[#990000]"/> Active Characters
                                  </h4>
                                  <div className="max-h-60 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                                      {characters.map(char => {
                                          const isActive = session.sceneState?.activeCharacterIds?.includes(char.id);
                                          const adaptation = session.worldMeta?.entityAdaptations?.[char.id];
                                          const displayRole = adaptation ? `${adaptation.adaptedName} (${adaptation.role})` : char.name;

                                          return (
                                              <label key={char.id} className={`flex items-center gap-2 p-2 border rounded-none cursor-pointer transition-colors ${isActive ? 'bg-red-50 border-red-200' : 'hover:bg-gray-50 border-gray-200'}`}>
                                                  <input 
                                                      type="checkbox" 
                                                      className="rounded-none text-[#990000] focus:ring-[#990000]"
                                                      checked={isActive || false}
                                                      onChange={(e) => {
                                                          const currentIds = session.sceneState?.activeCharacterIds || [];
                                                          const newIds = e.target.checked 
                                                              ? [...currentIds, char.id] 
                                                              : currentIds.filter(id => id !== char.id);
                                                          onUpdateSession({ sceneState: { ...session.sceneState, activeCharacterIds: newIds } });
                                                      }}
                                                  />
                                                  <div className="flex flex-col overflow-hidden">
                                                      <span className="text-sm font-bold text-gray-700 truncate font-ao3-sans">{displayRole}</span>
                                                      {adaptation && <span className="text-[10px] text-gray-500 truncate">{adaptation.status} • {adaptation.whereabouts}</span>}
                                                  </div>
                                              </label>
                                          );
                                      })}
                                  </div>
                              </div>
                          </div>

                          {/* REPLACED: Emotional Tracker -> Active Integration Manager */}
                          <div className="lg:col-span-1">
                              <div className="bg-white p-4 border border-gray-300 shadow-sm h-full rounded-none">
                                  <h4 className="font-bold text-gray-800 border-b border-gray-200 pb-2 mb-3 flex items-center gap-2">
                                      <Network size={16} className="text-blue-700"/> Active Integration Manager
                                  </h4>
                                  <div className="space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                                      {session.sceneState?.activeCharacterIds?.map(charId => {
                                          const char = characters.find(c => c.id === charId);
                                          const adaptation = session.worldMeta?.entityAdaptations?.[charId];
                                          if (!char) return null;

                                          return (
                                              <div 
                                                  key={charId} 
                                                  className="bg-gray-50 border border-gray-200 p-3 rounded-none hover:bg-gray-100 cursor-pointer group transition-colors"
                                                  onClick={() => {
                                                      setEditingAdaptationId(charId);
                                                      setEditAdaptationValues(adaptation || {
                                                          entryId: charId,
                                                          adaptedName: char.name,
                                                          role: 'New Arrival',
                                                          status: 'Active',
                                                          whereabouts: session.sceneState?.activeLocation || 'Unknown',
                                                          description: 'Not yet fully integrated.'
                                                      });
                                                  }}
                                                  title="Click to edit World Role"
                                              >
                                                  <div className="flex justify-between items-center mb-1">
                                                      <span className="font-bold text-sm text-gray-800 group-hover:text-[#990000]">{adaptation?.adaptedName || char.name}</span>
                                                      <span className="text-[10px] uppercase font-bold text-gray-500 bg-white border px-1 rounded-none group-hover:border-[#990000]">{adaptation?.status || "Pending"}</span>
                                                  </div>
                                                  <div className="text-xs text-gray-600 font-bold mb-1">
                                                      {adaptation?.role || "Unassigned Role"}
                                                  </div>
                                                  <p className="text-xs text-gray-500 italic line-clamp-2">
                                                      {adaptation?.description || "No specific integration lore set."}
                                                  </p>
                                                  <div className="text-[10px] text-blue-600 mt-2 font-bold opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                                                      <Edit2 size={10}/> Edit Integration
                                                  </div>
                                              </div>
                                          );
                                      })}
                                      {(!session.sceneState?.activeCharacterIds || session.sceneState.activeCharacterIds.length === 0) && (
                                          <p className="text-sm text-gray-400 italic text-center py-8">Select active characters to manage their integration roles.</p>
                                      )}
                                  </div>
                              </div>
                          </div>

                          {/* Editable Consequence Engine */}
                          <div className="lg:col-span-1">
                              <div className="bg-white p-4 border border-gray-300 shadow-sm h-full rounded-none">
                                  <h4 className="font-bold text-gray-800 border-b border-gray-200 pb-2 mb-3 flex items-center gap-2">
                                      <Activity size={16} className="text-orange-700"/> Consequence Engine
                                  </h4>
                                  <div className="space-y-3 max-h-[60vh] overflow-y-auto custom-scrollbar">
                                      {(!session.consequences || session.consequences.length === 0) ? (
                                          <p className="text-sm text-gray-400 italic text-center py-8">No active consequences. Narrative events will appear here.</p>
                                      ) : (
                                          session.consequences.map((cons, idx) => (
                                              <div key={idx} className={`p-3 border-l-4 rounded-none bg-gray-50 relative group ${cons.active ? (cons.severity === 'Critical' ? 'border-red-600' : cons.severity === 'Medium' ? 'border-orange-400' : 'border-blue-400') : 'border-gray-300 opacity-60'}`}>
                                                  <div className="flex justify-between items-start mb-1">
                                                      <span className="font-bold text-sm text-gray-800">{cons.name}</span>
                                                      <div className="flex items-center gap-1">
                                                        <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-none border ${cons.active ? 'bg-white' : 'bg-gray-200'}`}>
                                                            {cons.active ? cons.severity : 'Resolved'}
                                                        </span>
                                                        <button 
                                                            onClick={() => { setEditingConsequenceId(cons.id); setEditConsequenceText(cons.description); }} 
                                                            className="p-1 hover:bg-gray-200 text-gray-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                                        >
                                                            <Edit2 size={12} />
                                                        </button>
                                                        <button 
                                                            onClick={() => handleDeleteConsequence(cons.id)} 
                                                            className="p-1 hover:bg-gray-200 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                                        >
                                                            <Trash2 size={12} />
                                                        </button>
                                                      </div>
                                                  </div>
                                                  {editingConsequenceId === cons.id ? (
                                                      <div className="mt-2">
                                                          <textarea 
                                                            className="w-full text-xs p-1 border border-gray-300 rounded-none bg-white" 
                                                            value={editConsequenceText}
                                                            onChange={(e) => setEditConsequenceText(e.target.value)}
                                                          />
                                                          <div className="flex justify-end gap-1 mt-1">
                                                              <button onClick={() => setEditingConsequenceId(null)} className="text-[10px] uppercase font-bold text-gray-500 hover:underline">Cancel</button>
                                                              <button onClick={() => handleUpdateConsequence(cons.id)} className="text-[10px] uppercase font-bold text-green-700 hover:underline">Save</button>
                                                          </div>
                                                      </div>
                                                  ) : (
                                                      <p className="text-xs text-gray-600 leading-relaxed font-ao3-serif">{cons.description}</p>
                                                  )}
                                              </div>
                                          ))
                                      )}
                                  </div>
                              </div>
                          </div>
                      </div>
                    ) : directorsBoardTab === 'timeline' ? (
                        // TIMELINE TAB
                        <div className="bg-white p-6 border border-gray-300 shadow-sm h-full overflow-y-auto rounded-none">
                            <h4 className="font-bold text-[#990000] mb-4 flex items-center gap-2 uppercase tracking-wide text-sm border-b border-gray-200 pb-2">
                                <GitBranch size={16} /> Integrated Timeline Tracking
                            </h4>
                            
                            <div className="space-y-0 relative border-l-2 border-[#990000] ml-3 pl-6 py-2">
                                {/* 1. World Logic Timeline (Lore) */}
                                {session.worldMeta?.timeline.map((evt, idx) => (
                                    <div key={`lore-${idx}`} className="mb-6 relative opacity-75 group">
                                        <div className="absolute -left-[33px] top-1 w-4 h-4 bg-gray-100 border-4 border-gray-400 rounded-full" title="Lore Event"></div>
                                        <div className="text-xs font-bold text-gray-500 uppercase">{evt.era} {evt.year ? `• ${evt.year}` : ''}</div>
                                        <div className="text-sm font-bold text-gray-700 font-ao3-serif">{evt.description}</div>
                                        <div className="text-[10px] text-gray-400 mt-1 uppercase tracking-wide">{evt.sourceFandom || 'Lore'}</div>
                                    </div>
                                ))}

                                {/* Simulation Start Divider */}
                                <div className="mb-6 relative">
                                    <div className="absolute -left-[39px] top-[-10px] bg-[#990000] text-white text-[10px] font-bold uppercase px-2 py-0.5 rounded-none shadow">Simulation Start</div>
                                </div>

                                {/* 2. Narrative Events (Interactive) */}
                                {(session.narrativeEvents || []).map((evt, idx) => {
                                    const relatedNode = (Object.values(session.messageTree) as StoryNode[]).find(n => n.content.includes(evt.description));
                                    
                                    return (
                                        <button 
                                            key={evt.id}
                                            onClick={() => relatedNode && handleBranchSelect(relatedNode.id)}
                                            className={`mb-6 relative w-full text-left group focus:outline-none`}
                                            disabled={!relatedNode}
                                        >
                                            <div className="absolute -left-[33px] top-1 w-4 h-4 bg-white border-4 border-[#990000] rounded-full group-hover:scale-110 transition-transform"></div>
                                            <div className="p-3 border border-gray-200 bg-gray-50 rounded-none hover:border-[#990000] hover:bg-white transition-all shadow-sm">
                                                <div className="text-xs font-bold text-[#990000] uppercase mb-1">{evt.inStoryTime}</div>
                                                <div className="text-sm text-gray-900 font-bold font-ao3-serif">{evt.description}</div>
                                                <div className="text-[10px] text-gray-400 mt-1 uppercase">Interaction #{idx + 1}</div>
                                            </div>
                                        </button>
                                    );
                                })}
                                
                                {(!session.narrativeEvents || session.narrativeEvents.length === 0) && (
                                    <p className="text-gray-400 italic pl-2">No interactive events recorded yet.</p>
                                )}
                            </div>
                        </div>
                    ) : (
                        // HIERARCHY TAB
                        <div className="bg-white p-6 border border-gray-300 shadow-sm h-full overflow-y-auto rounded-none">
                            <h4 className="font-bold text-[#990000] mb-4 flex items-center gap-2 uppercase tracking-wide text-sm border-b border-gray-200 pb-2">
                                <Crown size={16} /> World Hierarchy & Power Tiers
                            </h4>
                            {session.worldMeta?.hierarchy ? (
                                <div>
                                    {/* Tabs */}
                                    <div className="flex gap-1 mb-4 border-b border-gray-200">
                                        {Object.keys(session.worldMeta.hierarchy).map(key => (
                                            <button
                                                key={key}
                                                onClick={() => setActiveHierarchyTab(key)}
                                                className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${activeHierarchyTab === key ? 'border-[#990000] text-[#990000]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                                            >
                                                {key}
                                            </button>
                                        ))}
                                    </div>
                                    
                                    {/* Content */}
                                    <div className="space-y-4">
                                        {session.worldMeta.hierarchy[activeHierarchyTab]?.map((tier, idx) => (
                                            <div key={idx} className="border border-gray-200 rounded-none bg-gray-50">
                                                <div className="bg-gray-100 p-2 border-b border-gray-200 text-xs font-bold uppercase text-gray-700">
                                                    {tier.tierName}
                                                </div>
                                                <div className="p-3 flex flex-wrap gap-2">
                                                    {tier.entities && tier.entities.length > 0 ? (
                                                        tier.entities.map((ent, eIdx) => (
                                                            <div key={eIdx} className="bg-white px-2 py-1 rounded-none border border-gray-300 text-sm font-bold text-gray-800 shadow-sm font-ao3-serif">
                                                                {ent.name}
                                                                {ent.subtypes && ent.subtypes.length > 0 && (
                                                                    <span className="text-xs font-normal text-gray-500 ml-1 font-ao3-sans">({ent.subtypes.length} types)</span>
                                                                )}
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <span className="text-gray-400 italic text-sm">Empty Tier</span>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <p className="text-gray-500 italic">No hierarchy data generated for this world.</p>
                            )}
                        </div>
                    )}
                  </div>
              </div>
          </div>
      )}

      {/* World Info Modal */}
      {showWorldInfo && (
        <div ref={worldInfoModalRef} className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="world-info-heading">
          <div className="bg-white max-w-4xl w-full max-h-[85vh] flex flex-col shadow-2xl rounded-none border border-gray-400">
             <div className="p-4 border-b border-[#770000] flex justify-between items-center bg-[#990000] text-white">
                <h3 id="world-info-heading" className="font-ao3-serif text-lg font-bold flex items-center gap-2"> <Globe size={20} /> Narrative Engine Controls </h3>
                <button onClick={() => setShowWorldInfo(false)} className="text-white hover:bg-[#770000] p-1 rounded-none" aria-label="Close modal"> <X size={20} /> </button>
             </div>
             
             <div className="flex-1 overflow-y-auto p-8 font-ao3-sans space-y-6">
                 <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1" htmlFor="host-fandom-select">Host Fandom / Setting</label>
                    <select 
                        id="host-fandom-select"
                        value={hostSelectValue}
                        onChange={(e) => {
                            const val = e.target.value;
                            let newHost: string | undefined = val;
                            if (val === 'MIXED') newHost = undefined;
                            else if (val === 'CUSTOM') newHost = '';
                            
                            onUpdateSession({ config: {...session.config, hostFandom: newHost }});
                        }}
                        className="w-full p-2 border border-gray-300 font-ao3-sans text-sm bg-white rounded-none focus:border-[#990000] outline-none"
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
                            value={session.config.hostFandom || ''}
                            onChange={(e) => onUpdateSession({ config: {...session.config, hostFandom: e.target.value }})}
                            placeholder="Enter custom setting or host world..."
                            className="w-full p-2 mt-2 border border-gray-300 font-ao3-sans text-sm bg-white text-gray-900 rounded-none focus:border-[#990000] outline-none"
                        />
                    )}
                </div>
                 <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1" htmlFor="tone-select">Narrative Tone</label>
                    <select 
                        id="tone-select"
                        value={session.config.tone} 
                        onChange={(e) => onUpdateSession({ config: {...session.config, tone: e.target.value as ToneType }})}
                        className="w-full p-2 border border-gray-300 font-ao3-sans text-sm bg-white rounded-none focus:border-[#990000] outline-none"
                    >
                        {Object.values(ToneType).map(t => ( <option key={t} value={t}>{t === ToneType.CUSTOM ? "Custom..." : t.replace(/_/g, ' ')}</option> ))}
                    </select>
                    {session.config.tone === ToneType.CUSTOM && (
                      <input
                        type="text"
                        aria-label="Custom narrative tone"
                        value={session.config.customTone || ''}
                        onChange={(e) => onUpdateSession({ config: {...session.config, customTone: e.target.value }})}
                        placeholder="e.g. Hopeful Melancholy"
                        className="w-full p-2 mt-2 border border-gray-300 font-ao3-sans text-sm bg-white text-gray-900 rounded-none focus:border-[#990000] outline-none"
                      />
                    )}
                </div>
                 <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1" htmlFor="canon-select">Canon Strictness</label>
                    <select 
                        id="canon-select"
                        value={session.config.canonStrictness} 
                        onChange={(e) => onUpdateSession({ config: {...session.config, canonStrictness: e.target.value as CanonStrictness }})}
                        className="w-full p-2 border border-gray-300 font-ao3-sans text-sm bg-white rounded-none focus:border-[#990000] outline-none"
                    >
                        <option value={CanonStrictness.Strict}>Strict (Characters are IC only)</option>
                        <option value={CanonStrictness.Flexible}>Flexible (Slight OOC for plot)</option>
                        <option value={CanonStrictness.Divergent}>Divergent (Rewrite personalities)</option>
                    </select>
                </div>
                 <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1" htmlFor="structure-select">Narrative Structure</label>
                    <select 
                        id="structure-select"
                        value={session.config.narrativeStructure} 
                        onChange={(e) => onUpdateSession({ config: {...session.config, narrativeStructure: e.target.value as NarrativeStructure }})}
                        className="w-full p-2 border border-gray-300 font-ao3-sans text-sm bg-white rounded-none focus:border-[#990000] outline-none"
                    >
                        <option value={NarrativeStructure.CompactProse}>Compact Prose (Novel-like)</option>
                        <option value={NarrativeStructure.ScriptLike}>Script-like (More line breaks)</option>
                    </select>
                </div>
                 <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1" htmlFor="modifiers-text">World Modifiers (Absolute Truths)</label>
                     <textarea 
                        id="modifiers-text"
                        className="w-full p-2 border border-gray-300 font-ao3-sans text-sm h-24 bg-white rounded-none focus:border-[#990000] outline-none"
                        placeholder="e.g. Magic is fading from the world. Character X never died."
                        value={session.config.modifiers}
                        onChange={(e) => onUpdateSession({ config: {...session.config, modifiers: e.target.value }})}
                    />
                </div>
                <hr className="border-gray-300"/>
                <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">Telltale Indicators</label>
                    <div className="flex items-center">
                        <input type="checkbox" id="telltale-toggle" className="h-4 w-4 rounded-none border-gray-300 text-[#990000] focus:ring-[#990000]" checked={session.config.showTelltaleIndicators} onChange={(e) => onUpdateSession({ config: {...session.config, showTelltaleIndicators: e.target.checked} })} />
                        <label htmlFor="telltale-toggle" className="ml-2 text-sm text-gray-600">Show indicators like "X will remember that."</label>
                    </div>
                </div>
             </div>
          </div>
        </div>
      )}

      {showRoster && ( 
          <div ref={rosterModalRef} className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="roster-heading">
            <div className="bg-white max-w-4xl w-full max-h-[85vh] flex flex-col shadow-2xl rounded-none border border-gray-400">
                <div className="p-4 border-b border-[#770000] flex justify-between items-center bg-[#990000] text-white">
                    <h3 id="roster-heading" className="font-ao3-serif text-lg font-bold flex items-center gap-2">
                        <Users size={20} /> Character List
                    </h3>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setShowRoster(false)} className="text-white hover:bg-[#770000] p-1 rounded-none" aria-label="Close modal">
                            <X size={20} />
                        </button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
                    {characters.length === 0 ? (
                        <div className="text-center text-gray-500 p-12 italic">
                            No character entries found. Add characters via the "Add Character" button or the Setup menu.
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {characters.map((char, idx) => {
                                const adaptation = session.worldMeta?.entityAdaptations?.[char.id];
                                return (
                                <div key={idx} className="bg-white border border-gray-300 p-4 rounded-none shadow-sm flex flex-col hover:border-[#990000] transition-colors cursor-pointer group" onClick={() => setViewingCharacter(char)}>
                                    <div className="flex justify-between items-start mb-2">
                                        <h4 className="font-ao3-serif text-xl font-bold text-gray-900 group-hover:text-[#990000] transition-colors">{adaptation?.adaptedName || char.name}</h4>
                                        <div className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-none font-bold uppercase tracking-wide border border-gray-200">
                                            {char.fandom || "Unknown Fandom"}
                                        </div>
                                    </div>
                                    
                                    {/* Integration Details Display */}
                                    {adaptation ? (
                                        <div className="mb-2 bg-red-50 border border-red-100 p-2 rounded-none text-xs">
                                            <div className="flex justify-between mb-1">
                                                <span className="font-bold text-[#990000]">Role:</span>
                                                <span className="text-gray-800">{adaptation.role}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="font-bold text-[#990000]">Status:</span>
                                                <span className="text-gray-800">{adaptation.status}</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="mb-2 text-xs text-gray-400 italic">No adaptation data available.</div>
                                    )}

                                    <div className="mt-2 text-sm text-gray-600 font-ao3-sans border-t border-gray-100 pt-3 flex-1 overflow-hidden">
                                        <p className="line-clamp-3 leading-relaxed">{char.content}</p>
                                    </div>
                                </div>
                            )})}
                        </div>
                    )}
                </div>
            </div>
          </div>
      )}
      
      {/* Character Bio Modal */}
      {viewingCharacter && (
        <div ref={bioModalRef} className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="bio-heading">
          <div className="bg-white max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl rounded-none border border-gray-400">
             <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-100">
                <div>
                    <h3 id="bio-heading" className="font-ao3-serif text-2xl font-bold text-[#990000]">{viewingCharacter.name}</h3>
                    <p className="text-sm text-gray-500 uppercase font-bold">{viewingCharacter.fandom}</p>
                </div>
                <button onClick={() => setViewingCharacter(null)} className="text-gray-500 hover:text-gray-800 p-2"><X size={24} /></button>
             </div>
             
             <div className="flex-1 overflow-y-auto p-8 font-ao3-serif text-gray-900 leading-relaxed whitespace-pre-wrap text-lg">
                 <p>{viewingCharacter.content}</p>
                 
                 {/* Show Adapted Role in Bio if available */}
                 {session.worldMeta?.entityAdaptations?.[viewingCharacter.id] && (
                     <div className="mt-8 pt-6 border-t border-gray-300 bg-gray-50 p-4 rounded-none border border-gray-200">
                         <h4 className="font-bold text-[#990000] mb-2 flex items-center gap-2"><Globe size={16}/> Integration Status (Adapted)</h4>
                         <div className="text-sm space-y-2 font-ao3-sans">
                             <div><span className="font-bold text-gray-700">Role:</span> {session.worldMeta.entityAdaptations[viewingCharacter.id].role}</div>
                             <div><span className="font-bold text-gray-700">Status:</span> {session.worldMeta.entityAdaptations[viewingCharacter.id].status}</div>
                             <div><span className="font-bold text-gray-700">Whereabouts:</span> {session.worldMeta.entityAdaptations[viewingCharacter.id].whereabouts}</div>
                             <div><span className="font-bold text-gray-700">Notes:</span> {session.worldMeta.entityAdaptations[viewingCharacter.id].description}</div>
                         </div>
                     </div>
                 )}
             </div>

             <div className="p-4 bg-gray-50 border-t border-gray-200 text-right">
                <button 
                    onClick={() => setViewingCharacter(null)}
                    className="bg-gray-800 text-white px-4 py-2 text-sm font-bold rounded-none hover:bg-gray-900"
                >
                    Close
                </button>
             </div>
          </div>
        </div>
      )}
      
      {showAddLore && ( <div ref={addLoreModalRef} className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="add-lore-heading"> <div className="bg-white max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl rounded-none border border-gray-400"> <div className="p-4 border-b border-[#770000] flex justify-between items-center bg-[#990000] text-white"> <h3 id="add-lore-heading" className="font-ao3-serif text-lg font-bold flex items-center gap-2"> <UserPlus size={20} /> Add Character or Lore Mid-Story </h3> <button onClick={() => setShowAddLore(false)} className="text-white hover:bg-[#770000] p-1 rounded-none" aria-label="Close modal"> <X size={20} /> </button> </div> <div className="flex-1 overflow-y-auto bg-gray-100"> <div className="p-6"> <div className="bg-white border border-[#990000] p-4 mb-4 text-sm text-gray-800 font-ao3-sans shadow-sm"> Items added here will be immediately available to the AI for the next story generation. The AI will recognize them as if they just appeared or became relevant. </div> <WikiImporter model={session.config.model} existingEntries={session.wikiEntries} onImport={handleImportMidStory} onUpdateEntry={() => {}} onRemoveEntry={() => {}} onClearAll={() => {}} onFandomDetected={(fandom) => { const currentFandoms = session.config.fandoms; if (!currentFandoms.includes(fandom)) { onUpdateSession({ config: { ...session.config, fandoms: [...currentFandoms, fandom] } }); } }} library={library} onAddToLibrary={onAddToLibrary} onRemoveFromLibrary={onRemoveFromLibrary} /> </div> </div> </div> </div> )}

      {/* Integration Edit Modal (Local to Reader) */}
      {editingAdaptationId && editAdaptationValues && (
          <div ref={adaptationModalRef} className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
              <div className="bg-white max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl rounded-none border border-gray-400">
                  <div className="p-4 border-b border-[#770000] flex justify-between items-center bg-[#990000] text-white">
                      <h3 className="font-ao3-serif text-lg font-bold">Edit Integration Details</h3>
                      <button onClick={() => setEditingAdaptationId(null)} className="text-white hover:bg-[#770000] p-1 rounded-none"><X size={20}/></button>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-6 bg-gray-50 space-y-4">
                      {/* AI Adapt Section */}
                      <div className="bg-white p-3 border border-gray-300 shadow-sm">
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1 flex items-center gap-1">
                              <Sparkles size={12} className="text-[#990000]"/> AI Re-Adaptation
                          </label>
                          <div className="flex gap-2">
                              <input 
                                  type="text" 
                                  className="flex-1 p-2 border border-gray-300 text-sm bg-white focus:bg-white outline-none focus:border-[#990000]"
                                  placeholder="e.g. 'Make them a cyborg'"
                                  value={aiAdaptPrompt}
                                  onChange={(e) => setAiAdaptPrompt(e.target.value)}
                                  onKeyDown={(e) => e.key === 'Enter' && handleAiAdapt()}
                              />
                              <button 
                                  onClick={handleAiAdapt}
                                  disabled={isAiAdapting || !aiAdaptPrompt.trim()}
                                  className="bg-gray-800 text-white px-3 py-1 text-xs font-bold hover:bg-gray-900 disabled:opacity-50"
                              >
                                  {isAiAdapting ? <Loader2 className="animate-spin" size={14}/> : 'Auto-Adapt'}
                              </button>
                          </div>
                      </div>

                      {/* Manual Fields */}
                      <div>
                          <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Adapted Name</label>
                          <input 
                              type="text" 
                              className="w-full p-2 border border-gray-300 text-sm bg-white focus:border-[#990000] outline-none font-bold"
                              value={editAdaptationValues.adaptedName}
                              onChange={(e) => setEditAdaptationValues({...editAdaptationValues, adaptedName: e.target.value})}
                          />
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                          <div>
                              <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Role</label>
                              <input 
                                  type="text" 
                                  className="w-full p-2 border border-gray-300 text-sm bg-white focus:border-[#990000] outline-none"
                                  value={editAdaptationValues.role}
                                  onChange={(e) => setEditAdaptationValues({...editAdaptationValues, role: e.target.value})}
                              />
                          </div>
                          <div>
                              <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Status</label>
                              <input 
                                  type="text" 
                                  className="w-full p-2 border border-gray-300 text-sm bg-white focus:border-[#990000] outline-none"
                                  value={editAdaptationValues.status}
                                  onChange={(e) => setEditAdaptationValues({...editAdaptationValues, status: e.target.value})}
                              />
                          </div>
                      </div>

                      <div>
                          <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Whereabouts</label>
                          <input 
                              type="text" 
                              className="w-full p-2 border border-gray-300 text-sm bg-white focus:border-[#990000] outline-none"
                              value={editAdaptationValues.whereabouts}
                              onChange={(e) => setEditAdaptationValues({...editAdaptationValues, whereabouts: e.target.value})}
                          />
                      </div>

                      <div>
                          <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Description & Integration Lore</label>
                          <textarea 
                              className="w-full p-2 border border-gray-300 text-sm h-32 bg-white focus:border-[#990000] outline-none font-ao3-serif leading-relaxed"
                              value={editAdaptationValues.description}
                              onChange={(e) => setEditAdaptationValues({...editAdaptationValues, description: e.target.value})}
                          />
                      </div>
                  </div>

                  <div className="p-4 border-t border-gray-300 bg-gray-100 flex justify-end gap-2">
                      <button onClick={() => setEditingAdaptationId(null)} className="px-4 py-2 text-sm font-bold text-gray-600 hover:text-gray-800">Cancel</button>
                      <button 
                          onClick={handleSaveAdaptation} 
                          className="bg-[#990000] text-white px-4 py-2 text-sm font-bold hover:bg-[#770000] shadow-sm flex items-center gap-2"
                      >
                          <Save size={16}/> Save Changes
                      </button>
                  </div>
              </div>
          </div>
      )}
    </>
  );
};
