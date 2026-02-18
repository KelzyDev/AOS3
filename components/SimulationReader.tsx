import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { SimulationSession, StoryNode, SimulationMode, NarrativeEvent, WikiEntry, DirectorMode, TokenUsage, ToneType, CanonStrictness, NarrativeStructure, SceneState, MODEL_OPTIONS, Consequence, AdaptedEntity, SceneHeader } from '../types';
import { generateStorySegment, generateSimulationBriefing, adaptSingleEntity } from '../services/geminiService';
import { Loader2, RefreshCw, Edit3, ArrowRight, ArrowLeft, Globe, X, Crown, List, Terminal, GitFork, MapPin, Book, UserPlus, ChevronLeft, ChevronRight, GitBranch, MessageSquare, Users, Cpu, Check, Video, Zap, AlertTriangle, Clapperboard, HeartPulse, Activity, Trash2, Edit2, Save, Copy, Network, Sparkles, HelpCircle, CornerDownRight, Clock, Calendar } from 'lucide-react';
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

const SceneHeaderBlock = ({ header }: { header: SceneHeader }) => (
    <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-6 text-xs font-mono text-gray-700 mb-6 bg-gray-50 border-l-4 border-[#990000] p-3 shadow-sm rounded-r-md select-none font-bold">
        <div className="flex items-center gap-2 flex-1">
            <MapPin size={14} className="text-[#990000]" />
            <span className="uppercase tracking-widest">{header.location || "Unknown Location"}</span>
        </div>
        <div className="flex items-center gap-4 text-gray-500">
            <div className="flex items-center gap-1.5">
                <Calendar size={14} />
                <span>{header.date || "----"}</span>
            </div>
            <div className="flex items-center gap-1.5">
                <Clock size={14} />
                <span>{header.time || "--:--"}</span>
            </div>
        </div>
    </div>
);

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
  
  const [expandedChoiceNodeId, setExpandedChoiceNodeId] = useState<string | null>(null);
  
  const [editingConsequenceId, setEditingConsequenceId] = useState<string | null>(null);
  const [editConsequenceText, setEditConsequenceText] = useState('');
  
  const [editingAdaptationId, setEditingAdaptationId] = useState<string | null>(null);
  const [editAdaptationValues, setEditAdaptationValues] = useState<AdaptedEntity | null>(null);
  const [aiAdaptPrompt, setAiAdaptPrompt] = useState('');
  const [isAiAdapting, setIsAiAdapting] = useState(false);

  const [animatedMessageIds, setAnimatedMessageIds] = useState<Set<string>>(new Set());
  
  const [generationError, setGenerationError] = useState<string | null>(null);
  
  const storyContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const worldInfoModalRef = useModalAccessibility(showWorldInfo, () => setShowWorldInfo(false));
  const storyLogModalRef = useModalAccessibility(showStoryLog, () => setShowStoryLog(false));
  const addLoreModalRef = useModalAccessibility(showAddLore, () => setShowAddLore(false));
  const rosterModalRef = useModalAccessibility(showRoster, () => setShowRoster(false));
  const directorsBoardRef = useModalAccessibility(showDirectorsBoard, () => setShowDirectorsBoard(false));
  const bioModalRef = useModalAccessibility(!!viewingCharacter, () => setViewingCharacter(null));
  const adaptationModalRef = useModalAccessibility(!!editingAdaptationId, () => setEditingAdaptationId(null));
  
  const characters = useMemo(() => session.wikiEntries.filter(e => e.category === 'Character'), [session.wikiEntries]);

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

  useEffect(() => {
    if (currentHistory.length > 0) {
        const existingIds = new Set(currentHistory.map(n => n.id));
        setAnimatedMessageIds(existingIds);
    }

    if ((!session.messageTree || Object.keys(session.messageTree).length === 0) && !isGenerating) {
      handleStartBriefing();
    }
  }, []); 

  useEffect(() => {
    const container = storyContainerRef.current;
    if (!container) return;
    
    const isScrolledToBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 150;
    
    if (!isGenerating && isScrolledToBottom) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [currentHistory.length, isGenerating]);
  
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    setGenerationError(null);
    if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  };

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
            suggestions: response.suggestions,
            sceneHeader: response.sceneHeader
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
    onUpdateSession({ messageTree: updatedTree, currentLeafId: userNode.id, lastModified: Date.now() });
    
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
            sceneHeader: response.sceneHeader,
            telltaleTags: response.telltaleTags,
            timestamp: Date.now()
        };

        updatedTree[aiNode.id] = aiNode;
        updatedTree[userNode.id] = { ...updatedTree[userNode.id], childrenIds: [aiNode.id] };

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
                 sceneHeader: response.sceneHeader,
                 telltaleTags: response.telltaleTags,
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
                     sceneHeader: response.sceneHeader,
                     telltaleTags: response.telltaleTags,
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
  
  const handleSaveAdaptation = () => {
    if (!editingAdaptationId || !editAdaptationValues) return;
    
    const currentMeta = session.worldMeta || { timeline: [], hierarchy: {}, entityAdaptations: {} };
    const newAdaptations = { ...currentMeta.entityAdaptations };
    newAdaptations[editingAdaptationId] = editAdaptationValues;
    
    onUpdateSession({ worldMeta: { ...currentMeta, entityAdaptations: newAdaptations } });
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
            
            {/* ACTOR SELECTOR */}
            {session.config.simulationMode === SimulationMode.Actor && (
                <div className="hidden sm:flex items-center gap-1 bg-[#770000] border border-white/30 rounded-none px-2 py-1">
                    <span className="text-xs font-bold text-white/70">PLAYING:</span>
                    <select
                        value={session.config.activeCharacterId || ''}
                        onChange={(e) => onUpdateSession({ config: { ...session.config, activeCharacterId: e.target.value } })}
                        className="bg-transparent text-white text-sm font-bold outline-none border-none cursor-pointer w-32"
                    >
                        <option value="" className="text-gray-900">None / Observer</option>
                        {characters.map(c => (
                            <option key={c.id} value={c.id} className="text-gray-900">{c.name}</option>
                        ))}
                    </select>
                </div>
            )}

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
                            
                            {/* TELLTALE CHOICE INDICATOR (Interactable) */}
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
                                            {typeof c !== 'string' && <span className="font-bold text-[#990000] font-mono shrink-0">{c.letter}</span>}
                                            <span className="break-words min-w-0">{typeof c === 'string' ? c : c.text}</span>
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
                        
                        {/* SCENE HEADER (Location/Time) */}
                        {session.config.showSceneHeaders && node.sceneHeader && !isUser && (
                            <SceneHeaderBlock header={node.sceneHeader} />
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
      
      {/* ... Other Modals ... */}
    </>
  );
};