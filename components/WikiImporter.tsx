
import React, { useState, useEffect, useRef } from 'react';
import { WikiEntry, MODEL_OPTIONS } from '../types';
import { analyzeWikiContent, scanWikiUrl, modifyEntryWithAI, DiscoveredEntity, generateOriginalCharacter } from '../services/geminiService';
import { Loader2, Plus, Globe, FileText, CheckCircle2, User, Map, X, Info, Trash2, Edit2, Save, Bookmark, BookOpen, Search, Radar, ArrowRight, ArrowLeft, ChevronRight, ChevronLeft, RefreshCw, History, ExternalLink, Cpu, CheckSquare, Square, Wand2, GripVertical, Filter, Play, Pause, AlertCircle, ListPlus, Clock, Sparkles } from 'lucide-react';
import { HoldToDeleteButton } from './HoldToDeleteButton';

interface WikiImporterProps {
  model: string;
  onImport: (entry: WikiEntry) => void;
  onUpdateEntry: (entry: WikiEntry) => void;
  onRemoveEntry: (id: string) => void;
  onClearAll: () => void;
  onReorder?: (draggedId: string, targetId: string) => void;
  onRestoreDefaults?: () => void;
  onFandomDetected?: (fandom: string) => void;
  existingEntries: WikiEntry[];
  library: WikiEntry[];
  onAddToLibrary: (entry: WikiEntry) => void;
  onRemoveFromLibrary: (id: string) => void;
}

interface QueueItem {
  id: string;
  type: 'character' | 'lore';
  category: WikiEntry['category'];
  mode: 'link' | 'text' | 'search' | 'oc_prompt';
  input: string;
  name: string;
  modifier: string;
  status: 'queued' | 'generating' | 'completed' | 'failed';
  error?: string;
  timestamp: number;
}

const ITEMS_PER_PAGE = 8;
const MAX_HISTORY = 5;

// Helper component for the Google-like search input
const SearchInput = ({ 
    value, 
    onChange, 
    onSearch, 
    placeholder, 
    historyKey, 
    suggestions = [],
    isLoading,
    onCancel
}: { 
    value: string, 
    onChange: (val: string) => void, 
    onSearch: (val: string) => void, 
    placeholder: string, 
    historyKey: string, 
    suggestions?: string[],
    isLoading: boolean,
    onCancel: () => void,
}) => {
    const [isFocused, setIsFocused] = useState(false);
    const [history, setHistory] = useState<string[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const saved = localStorage.getItem(historyKey);
        if (saved) setHistory(JSON.parse(saved));
        
        // Click outside handler
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsFocused(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [historyKey]);

    const handleSearchTrigger = (term: string) => {
        if (!term.trim() || isLoading) return;
        
        // Update history
        const newHistory = [term, ...history.filter(h => h !== term)].slice(0, MAX_HISTORY);
        setHistory(newHistory);
        localStorage.setItem(historyKey, JSON.stringify(newHistory));
        
        setIsFocused(false);
        onChange(term);
        onSearch(term);
    };

    const handleDeleteHistory = (e: React.MouseEvent, item: string) => {
        e.stopPropagation();
        const newHistory = history.filter(h => h !== item);
        setHistory(newHistory);
        localStorage.setItem(historyKey, JSON.stringify(newHistory));
    };

    // Filter suggestions based on input
    const filteredSuggestions = value.trim() 
        ? suggestions.filter(s => s.toLowerCase().includes(value.toLowerCase())).slice(0, 3) 
        : [];

    const showDropdown = isFocused && (history.length > 0 || filteredSuggestions.length > 0);

    return (
        <div className="relative" ref={wrapperRef}>
            <div className={`flex items-center border ${isFocused ? 'border-b-0 shadow-md border-gray-400' : 'border-gray-300 shadow-sm'} bg-white transition-all rounded-none`}>
                <div className="pl-4 text-gray-400">
                    <Search size={18} />
                </div>
                <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onFocus={() => setIsFocused(true)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearchTrigger(value)}
                    placeholder={placeholder}
                    className={`w-full p-3 outline-none font-ao3-sans bg-white text-gray-900 placeholder:text-gray-400 rounded-none`}
                    disabled={isLoading}
                />
                {value && !isLoading && (
                    <button onClick={() => onChange('')} className="pr-4 text-gray-400 hover:text-gray-600">
                        <X size={16} />
                    </button>
                )}
                 {isLoading && (
                    <button onClick={onCancel} title="Cancel Search" className="pr-4 text-gray-400 hover:text-red-600">
                        <X size={18} />
                    </button>
                )}
            </div>

            {/* Dropdown Results */}
            {showDropdown && (
                <div className="absolute top-full left-0 right-0 bg-white border border-t-0 border-gray-400 shadow-md z-50 overflow-hidden rounded-none">
                    <ul>
                        {/* Suggestions from Library/Wiki */}
                        {filteredSuggestions.map((s, idx) => (
                            <li key={`s-${idx}`}>
                                <button 
                                    onClick={() => handleSearchTrigger(s)}
                                    className="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center gap-3 text-sm text-[#990000] font-bold"
                                >
                                    <Search size={14} className="opacity-50" />
                                    <span>{s}</span>
                                </button>
                            </li>
                        ))}
                        
                        {filteredSuggestions.length > 0 && history.length > 0 && <li className="border-t border-gray-200 my-1"></li>}

                        {/* History */}
                        {history.map((h, idx) => (
                            <li key={`h-${idx}`}>
                                <button 
                                    onClick={() => handleSearchTrigger(h)}
                                    className="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center justify-between group"
                                >
                                    <div className="flex items-center gap-3 text-sm text-gray-700">
                                        <History size={14} className="text-gray-400" />
                                        <span>{h}</span>
                                    </div>
                                    <div 
                                        onClick={(e) => handleDeleteHistory(e, h)}
                                        className="text-gray-300 hover:text-red-600 p-1 rounded-none opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <X size={12} />
                                    </div>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};


export const WikiImporter: React.FC<WikiImporterProps> = ({ 
  model,
  onImport, 
  onUpdateEntry,
  onRemoveEntry,
  onClearAll,
  onReorder,
  onRestoreDefaults,
  onFandomDetected, 
  existingEntries,
  library,
  onAddToLibrary,
  onRemoveFromLibrary
}) => {
  const [activeTab, setActiveTab] = useState<'character' | 'lore' | 'scanner' | 'library' | 'generator'>('character');
  const [mode, setMode] = useState<'link' | 'text' | 'search'>('link');
  const [inputVal, setInputVal] = useState('');
  const [name, setName] = useState('');
  const [loreCategory, setLoreCategory] = useState<WikiEntry['category']>('World');
  const [modifier, setModifier] = useState('');
  
  // Scanner State
  const [selectedModel, setSelectedModel] = useState(model);
  const [scanUrl, setScanUrl] = useState('');
  const [scanFocus, setScanFocus] = useState<string>('All');
  const [scanMode, setScanMode] = useState<'link' | 'search'>('link');
  const [isScanning, setIsScanning] = useState(false);
  const [discoveredEntries, setDiscoveredEntries] = useState<{fandom: string, entities: DiscoveredEntity[]} | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedForImport, setSelectedForImport] = useState<Set<string>>(new Set());
  const [activeScanFilter, setActiveScanFilter] = useState<string>('All');
  const [scannerModifier, setScannerModifier] = useState('');

  // OC Factory State
  const [ocPrompt, setOcPrompt] = useState('');
  const [isGeneratingOc, setIsGeneratingOc] = useState(false); // Legacy single gen state, mostly unused if using queue

  // Library State
  const [libPage, setLibPage] = useState(1);
  const [libFilter, setLibFilter] = useState<string>('All');
  const [libSearch, setLibSearch] = useState('');

  // Queue State
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isQueueRunning, setIsQueueRunning] = useState(false);
  const [draggedQueueId, setDraggedQueueId] = useState<string | null>(null);

  // General State
  const [error, setError] = useState<string | null>(null);
  
  // DnD State (Main List)
  const [draggedEntryId, setDraggedEntryId] = useState<string | null>(null);

  // Modal State
  const [selectedEntry, setSelectedEntry] = useState<WikiEntry | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editName, setEditName] = useState('');
  
  // AI Modification State in Modal
  const [isAiModifying, setIsAiModifying] = useState(false);
  const [aiModifyPrompt, setAiModifyPrompt] = useState('');
  const [showAiModify, setShowAiModify] = useState(false);

  // Cancellation logic
  const abortControllerRef = useRef<AbortController | null>(null);

  // Sync prop model to local model
  useEffect(() => {
    setSelectedModel(model);
  }, [model]);

  // --- QUEUE PROCESSING EFFECT ---
  useEffect(() => {
    if (!isQueueRunning) return;

    // Check if anything is currently generating (avoid double process)
    if (queue.some(i => i.status === 'generating')) return;

    const processNext = async () => {
        const pendingIdx = queue.findIndex(i => i.status === 'queued');
        if (pendingIdx === -1) {
            setIsQueueRunning(false); // All done
            return;
        }

        const item = queue[pendingIdx];
        
        // Mark generating
        setQueue(prev => prev.map((q, i) => i === pendingIdx ? { ...q, status: 'generating' } : q));

        // Create new controller for this specific request
        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            if (item.mode === 'oc_prompt') {
                // HANDLE OC GENERATION
                const entry = await generateOriginalCharacter(item.input, existingEntries, selectedModel, controller.signal);
                
                // Update the queue item with the generated name so user sees "Specific OC" instead of "New OC"
                setQueue(prev => prev.map(q => q.id === item.id ? { ...q, name: entry.name } : q));
                
                onImport(entry);
            } else {
                // HANDLE STANDARD WIKI/SEARCH GENERATION
                const result = await analyzeWikiContent(item.input, item.category, selectedModel, controller.signal, item.mode, item.modifier);
                
                // Name refinement logic
                let finalName = item.name || item.input;
                if (item.mode === 'search' && item.category === 'Character') {
                    const nameMatch = result.content.match(/Full Canon Name:\s*(.+)/);
                    if (nameMatch && nameMatch[1]) finalName = nameMatch[1].trim();
                }

                const newEntry: WikiEntry = {
                    id: crypto.randomUUID(),
                    name: finalName,
                    category: item.category,
                    content: result.content,
                    fandom: result.fandom,
                    sourceUrl: item.mode === 'link' ? item.input : undefined
                };

                onImport(newEntry);
                if (result.fandom && onFandomDetected) onFandomDetected(result.fandom);
            }

            // Mark completed
            setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'completed' } : q));

        } catch (err: any) {
             if (err.name === 'AbortError') return;

             // Mark failed
             setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'failed', error: err.message || "Unknown error" } : q));
             
             // If quota error, pause queue
             if (err.message && (err.message.includes('429') || err.message.includes('Resource has been exhausted'))) {
                 setIsQueueRunning(false);
                 setError("Queue paused: Quota limit reached.");
             }
        } finally {
            abortControllerRef.current = null;
        }
    };

    processNext();
  }, [queue, isQueueRunning, selectedModel, onImport, onFandomDetected, existingEntries]);

  // Suggestions for autocomplete (mix of existing + library)
  const allKnownNames = Array.from(new Set([...existingEntries, ...library].map(e => e.name)));
  
  const handleCancelScan = () => {
    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
    }
    setIsScanning(false);
    setIsAiModifying(false);
    setIsGeneratingOc(false);
    // Queue items are handled via handleRemoveFromQueue which aborts individually
    setError("Operation cancelled.");
  };

  const handleAddToQueue = (overrideName?: string, overrideInput?: string, overrideCategory?: WikiEntry['category'], overrideMode?: QueueItem['mode'], overrideModifier?: string) => {
    const nameToUse = overrideName || name;
    const inputToUse = overrideInput || inputVal;
    const catToUse = overrideCategory || (activeTab === 'character' ? 'Character' : loreCategory);
    const modeToUse = overrideMode || mode;
    const modifierToUse = overrideModifier !== undefined ? overrideModifier : modifier;

    if (!inputToUse.trim() || (!nameToUse.trim() && modeToUse !== 'search' && modeToUse !== 'oc_prompt')) return;

    const newItem: QueueItem = {
        id: crypto.randomUUID(),
        type: activeTab === 'character' ? 'character' : 'lore',
        category: catToUse,
        mode: modeToUse,
        input: inputToUse,
        name: nameToUse,
        modifier: modifierToUse,
        status: 'queued',
        timestamp: Date.now()
    };

    setQueue(prev => [...prev, newItem]);
    setIsQueueRunning(true); // Auto-start queue

    // Clear inputs
    if (!overrideName) {
        setInputVal('');
        setName('');
        setModifier('');
    }
  };

  // Dedicated handler for OC Queueing to keep UI logic clean
  const handleAddOcToQueue = () => {
      if (!ocPrompt.trim()) return;
      
      const newItem: QueueItem = {
          id: crypto.randomUUID(),
          type: 'character',
          category: 'Character',
          mode: 'oc_prompt',
          input: ocPrompt,
          name: "New OC (Pending...)", 
          modifier: '',
          status: 'queued',
          timestamp: Date.now()
      };

      setQueue(prev => [...prev, newItem]);
      setIsQueueRunning(true);
      setOcPrompt(''); // Clear
  };

  const handleBulkAddFromScanner = async () => {
    const itemsToImport = discoveredEntries?.entities.filter(e => selectedForImport.has(e.name)) || [];
    if (itemsToImport.length === 0) return;

    const newItems: QueueItem[] = itemsToImport.map(item => ({
        id: crypto.randomUUID(),
        type: item.category === 'Character' ? 'character' : 'lore',
        category: item.category,
        mode: 'search',
        input: item.name,
        name: item.name,
        modifier: scannerModifier,
        status: 'queued',
        timestamp: Date.now()
    }));

    setQueue(prev => [...prev, ...newItems]);
    setIsQueueRunning(true);
    
    setSelectedForImport(new Set());
    setScannerModifier('');
  };

  // Queue Controls
  const handleRemoveFromQueue = (id: string) => {
      // If deleting currently generating item, abort it
      const item = queue.find(q => q.id === id);
      if (item?.status === 'generating' && abortControllerRef.current) {
          abortControllerRef.current.abort();
      }
      setQueue(prev => prev.filter(q => q.id !== id));
  };

  const handleRetryItem = (id: string) => {
      setQueue(prev => prev.map(q => q.id === id ? { ...q, status: 'queued', error: undefined } : q));
      setIsQueueRunning(true);
  };

  const handleClearCompleted = () => {
      setQueue(prev => prev.filter(q => q.status !== 'completed'));
  };

  const onDragStartQueue = (e: React.DragEvent, id: string) => {
      setDraggedQueueId(id);
      e.dataTransfer.effectAllowed = 'move';
  };

  const onDropQueue = (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      if (!draggedQueueId || draggedQueueId === targetId) return;
      
      setQueue(prev => {
          const list = [...prev];
          const srcIdx = list.findIndex(q => q.id === draggedQueueId);
          const tgtIdx = list.findIndex(q => q.id === targetId);
          if (srcIdx === -1 || tgtIdx === -1) return prev;
          
          const [removed] = list.splice(srcIdx, 1);
          list.splice(tgtIdx, 0, removed);
          return list;
      });
      setDraggedQueueId(null);
  };

  // --- SCANNER LOGIC ---
  const handleScanWiki = async (urlToScan?: string) => {
    const target = urlToScan || scanUrl;
    if (!target.trim()) return;

    handleCancelScan(); 
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsScanning(true);
    setError(null);
    setDiscoveredEntries(null);
    setCurrentPage(1);
    setSelectedForImport(new Set());

    try {
      const result = await scanWikiUrl(target, selectedModel, scanFocus, controller.signal, scanMode);
      setDiscoveredEntries(result);
      if (result.fandom && onFandomDetected) {
        onFandomDetected(result.fandom);
      }
    } catch (err) {
       if (err.name !== 'AbortError') {
         setError(err instanceof Error ? err.message : "Scan failed");
       }
    } finally {
      setIsScanning(false);
      abortControllerRef.current = null;
    }
  };

  // --- AI MODIFICATION LOGIC ---
  const handleAiModifyEntry = async () => {
      if (!selectedEntry || !aiModifyPrompt.trim()) return;
      
      handleCancelScan();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsAiModifying(true);
      
      try {
          const result = await modifyEntryWithAI(editName, editContent, aiModifyPrompt, selectedModel, controller.signal);
          setEditName(result.name);
          setEditContent(result.content);
          setAiModifyPrompt('');
          // Don't close editing, let user review
      } catch (err) {
           if (err.name !== 'AbortError') {
              console.error(err);
              setError("AI Modification failed.");
           }
      } finally {
          setIsAiModifying(false);
          abortControllerRef.current = null;
      }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddToQueue();
    }
  };

  const openEntry = (entry: WikiEntry) => {
    setSelectedEntry(entry);
    setEditName(entry.name);
    setEditContent(entry.content);
    setIsEditing(false);
    setShowAiModify(false);
  };

  const handleSaveChanges = () => {
    if (selectedEntry) {
      onUpdateEntry({
        ...selectedEntry,
        name: editName,
        content: editContent
      });
      setIsEditing(false);
      setSelectedEntry(null);
    }
  };

  const handleDeleteEntry = () => {
    if (selectedEntry) {
      onRemoveEntry(selectedEntry.id);
      setSelectedEntry(null);
    }
  };
  
  const handleClearAllConfirm = () => {
     onClearAll();
  };

  const isBookmarked = (id: string) => library.some(e => e.id === id);

  // Scanner Pagination & Filter Logic
  const filteredDiscovered = discoveredEntries?.entities.filter(e => activeScanFilter === 'All' || e.category === activeScanFilter) || [];
  const totalPages = Math.ceil(filteredDiscovered.length / ITEMS_PER_PAGE);
  const currentEntries = filteredDiscovered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const toggleSelection = (name: string) => {
    setSelectedForImport(prev => {
        const newSet = new Set(prev);
        if (newSet.has(name)) {
            newSet.delete(name);
        } else {
            newSet.add(name);
        }
        return newSet;
    });
  };

  const toggleSelectAllVisible = () => {
    const visibleNames = new Set(currentEntries.map(e => e.name));
    const allVisibleSelected = currentEntries.every(e => selectedForImport.has(e.name));

    if (allVisibleSelected) {
        setSelectedForImport(prev => {
            const newSet = new Set(prev);
            visibleNames.forEach(name => newSet.delete(name));
            return newSet;
        });
    } else {
        setSelectedForImport(prev => new Set([...prev, ...visibleNames]));
    }
  };
  
  // Library Pagination & Filtering Logic
  const filteredLibrary = library.filter(entry => {
      const matchCat = libFilter === 'All' || entry.category === libFilter;
      const matchSearch = !libSearch.trim() || entry.name.toLowerCase().includes(libSearch.toLowerCase());
      return matchCat && matchSearch;
  });
  
  const totalLibPages = Math.ceil(filteredLibrary.length / ITEMS_PER_PAGE);
  const currentLibEntries = filteredLibrary.slice((libPage - 1) * ITEMS_PER_PAGE, libPage * ITEMS_PER_PAGE);

  return (
    <>
      <div className="bg-white border border-gray-300 shadow-sm mb-6 relative rounded-none">
        <div className="flex border-b border-gray-200 overflow-x-auto">
          <button
            onClick={() => setActiveTab('character')}
            className={`flex-items-center gap-2 p-4 text-sm font-bold border-b-2 transition-colors ${activeTab === 'character' ? 'border-[#990000] text-[#990000]' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}>
            <User size={16} /> Add Character
          </button>
          <button
            onClick={() => setActiveTab('lore')}
            className={`flex items-center gap-2 p-4 text-sm font-bold border-b-2 transition-colors ${activeTab === 'lore' ? 'border-[#990000] text-[#990000]' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}>
            <Map size={16} /> Add World/Lore
          </button>
          <button
            onClick={() => setActiveTab('generator')}
            className={`flex items-center gap-2 p-4 text-sm font-bold border-b-2 transition-colors ${activeTab === 'generator' ? 'border-[#990000] text-[#990000]' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}>
            <Sparkles size={16} /> OC Factory
          </button>
          <button
            onClick={() => setActiveTab('scanner')}
            className={`flex items-center gap-2 p-4 text-sm font-bold border-b-2 transition-colors ${activeTab === 'scanner' ? 'border-[#990000] text-[#990000]' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}>
            <Radar size={16} /> Fandom Scanner
          </button>
          <button
            onClick={() => setActiveTab('library')}
            className={`flex items-center gap-2 p-4 text-sm font-bold border-b-2 transition-colors ${activeTab === 'library' ? 'border-[#990000] text-[#990000]' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}>
            <BookOpen size={16} /> Library
          </button>
        </div>
        
        {/* Model Indicator & Selector */}
        <div className="absolute top-2 right-2 hidden md:flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-100 text-xs font-bold text-gray-500 border border-gray-200 rounded-none">
                <Cpu size={12} />
                <select 
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="bg-transparent outline-none border-none cursor-pointer text-gray-800 max-w-[120px]"
                    title="Select AI Model for Import"
                >
                    {MODEL_OPTIONS.map(opt => (
                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                    ))}
                </select>
            </div>
        </div>

        {/* --- CHARACTER/LORE TAB --- */}
        {(activeTab === 'character' || activeTab === 'lore') && (
          <div className="p-6">
            <div className="flex gap-0 mb-4 border border-gray-300 w-max bg-gray-50 rounded-none overflow-hidden">
              <button onClick={() => setMode('link')} className={`px-4 py-1 text-sm font-bold rounded-none ${mode === 'link' ? 'bg-[#990000] text-white' : 'text-gray-600 hover:bg-gray-200'}`}>Paste Link</button>
              <button onClick={() => setMode('search')} className={`px-4 py-1 text-sm font-bold rounded-none border-x border-gray-300 ${mode === 'search' ? 'bg-[#990000] text-white border-[#990000]' : 'text-gray-600 hover:bg-gray-200'}`}>Search Web</button>
              <button onClick={() => setMode('text')} className={`px-4 py-1 text-sm font-bold rounded-none ${mode === 'text' ? 'bg-[#990000] text-white' : 'text-gray-600 hover:bg-gray-200'}`}>Paste Text</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
              {/* Left Side: Name and Category */}
              <div className="md:col-span-1 space-y-4">
                {mode !== 'search' && (
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={activeTab === 'character' ? "e.g. Connor" : "e.g. Jericho"}
                            className="w-full p-2 border border-gray-300 focus:border-[#990000] outline-none font-ao3-sans bg-white text-gray-900 rounded-none shadow-inner"
                        />
                    </div>
                )}
                
                {activeTab === 'lore' && (
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">Category</label>
                    <select
                      value={loreCategory}
                      onChange={(e) => setLoreCategory(e.target.value as WikiEntry['category'])}
                      className="w-full p-2 border border-gray-300 focus:border-[#990000] outline-none font-ao3-sans bg-white text-gray-900 rounded-none shadow-inner"
                    >
                      <option value="World">World / Location</option>
                      <option value="Lore">Lore / History</option>
                      <option value="Facility">Facility / Building</option>
                      <option value="Species">Species</option>
                      <option value="Religion">Religion</option>
                      <option value="Country">Country / Faction</option>
                    </select>
                  </div>
                )}
              </div>
              
              {/* Right Side: Input */}
              <div className="md:col-span-2">
                 {mode === 'text' ? (
                  <>
                    <label className="block text-sm font-bold text-gray-700 mb-1">Content</label>
                    <textarea
                      value={inputVal}
                      onChange={(e) => setInputVal(e.target.value)}
                      placeholder="Paste wiki content or a detailed description here."
                      className="w-full p-2 border border-gray-300 h-24 focus:border-[#990000] outline-none font-ao3-sans bg-white text-gray-900 rounded-none shadow-inner"
                    />
                  </>
                 ) : (
                    <>
                        <label className="block text-sm font-bold text-gray-700 mb-1">
                            {mode === 'link' ? "Wiki Page URL" : "Search Query"}
                        </label>
                        <SearchInput
                            value={inputVal}
                            onChange={setInputVal}
                            onSearch={() => handleAddToQueue()}
                            placeholder={mode === 'link' ? 'https://... (Fandom, Miraheze)' : 'Search for "Jericho Detroit"'}
                            historyKey={mode === 'link' ? 'ao3sim_link_history' : 'ao3sim_search_history'}
                            suggestions={mode === 'search' ? allKnownNames : []}
                            isLoading={false}
                            onCancel={() => {}}
                        />
                    </>
                 )}
              </div>
            </div>

            {/* MODIFIER FIELD */}
            <div className="mt-4">
                 <label className="block text-sm font-bold text-gray-700 mb-1 flex items-center gap-1">
                    <Wand2 size={14} className="text-[#990000]"/> User Overrides (Modifiers)
                 </label>
                 <input 
                    type="text"
                    value={modifier}
                    onChange={(e) => setModifier(e.target.value)}
                    placeholder="e.g. 'Make them strictly canonical', 'Reimagine as a villain', 'Ignore their death in canon'"
                    className="w-full p-2 border border-gray-300 bg-white focus:border-[#990000] outline-none font-ao3-sans text-sm text-gray-900 rounded-none shadow-inner"
                 />
                 <p className="text-[10px] text-gray-500 mt-1">Instructions for the AI to alter the character/lore during generation.</p>
            </div>

            <div className="flex justify-end items-center gap-4 mt-4">
              <button
                onClick={() => handleAddToQueue()}
                className="bg-[#990000] text-white px-6 py-2 font-bold hover:bg-[#770000] flex items-center gap-2 rounded-none shadow-sm"
              >
                <Plus size={18} />
                Add to Queue
              </button>
            </div>
          </div>
        )}

        {/* --- OC FACTORY TAB --- */}
        {activeTab === 'generator' && (
            <div className="p-6">
                <div className="bg-purple-50 border border-purple-200 p-4 mb-4 rounded-none">
                    <div className="flex items-start gap-3">
                        <Sparkles className="text-purple-600 mt-1" size={20} />
                        <div>
                            <h3 className="text-purple-900 font-bold text-sm mb-1">OC Factory</h3>
                            <p className="text-xs text-purple-700">
                                This tool generates characters that fit the <strong>current world context</strong>. 
                                It reads your existing World Lore and Fandom entries to ensure the character fits the setting.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                     <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">Character Concept / Archetype</label>
                        <textarea
                            value={ocPrompt}
                            onChange={(e) => setOcPrompt(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleAddOcToQueue()}
                            placeholder="e.g. A gritty detective who uses blood magic. They hate the ruling faction."
                            className="w-full p-3 border border-gray-300 focus:border-purple-600 outline-none font-ao3-sans bg-white text-gray-900 rounded-none shadow-inner h-32"
                        />
                     </div>
                     
                     <div className="flex justify-end">
                        <button 
                            onClick={handleAddOcToQueue}
                            disabled={!ocPrompt.trim()}
                            className="bg-purple-700 text-white px-6 py-2 font-bold hover:bg-purple-800 flex items-center gap-2 rounded-none shadow-sm disabled:opacity-50"
                        >
                            <Plus size={18} /> Add to Queue
                        </button>
                     </div>
                     {error && <p className="text-red-600 text-sm font-bold text-right">{error}</p>}
                </div>
            </div>
        )}

        {/* --- SCANNER TAB --- */}
        {activeTab === 'scanner' && (
            <div className="p-6">
                <div className="flex gap-0 mb-4 border border-gray-300 w-max bg-gray-50 rounded-none overflow-hidden">
                    <button onClick={() => setScanMode('link')} className={`px-4 py-1 text-sm font-bold rounded-none ${scanMode === 'link' ? 'bg-[#990000] text-white' : 'text-gray-600 hover:bg-gray-200'}`}>Paste Link</button>
                    <button onClick={() => setScanMode('search')} className={`px-4 py-1 text-sm font-bold rounded-none border-l border-gray-300 ${scanMode === 'search' ? 'bg-[#990000] text-white border-[#990000]' : 'text-gray-600 hover:bg-gray-200'}`}>Search Web</button>
                </div>

                <div className="flex items-center gap-4 mb-4">
                    <div className="w-[140px] flex-shrink-0">
                         <div className="relative">
                             <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"/>
                             <select 
                                value={scanFocus}
                                onChange={(e) => setScanFocus(e.target.value)}
                                className="w-full pl-8 p-3 border border-gray-300 rounded-none bg-white text-sm font-bold text-gray-700 outline-none focus:border-[#990000] shadow-inner"
                                title="Scan Focus"
                             >
                                 <option value="All">Everything</option>
                                 <option value="Character">Characters</option>
                                 <option value="Location">Places</option>
                                 <option value="Lore">Lore/History</option>
                                 <option value="Faction">Factions</option>
                             </select>
                         </div>
                    </div>
                    <div className="flex-1">
                       <SearchInput 
                           value={scanUrl}
                           onChange={setScanUrl}
                           onSearch={handleScanWiki}
                           placeholder={scanMode === 'search' ? "Search e.g. 'Star Wars Characters'" : "Paste Wiki URL..."}
                           historyKey={scanMode === 'search' ? "ao3sim_scan_search_history" : "ao3sim_scan_link_history"}
                           isLoading={isScanning}
                           onCancel={handleCancelScan}
                       />
                    </div>
                     {isScanning ? (
                        <button onClick={handleCancelScan} className="bg-gray-200 text-gray-700 px-6 py-3 font-bold hover:bg-gray-300 self-start flex items-center gap-2 rounded-none">
                            <X size={16} /> Cancel
                        </button>
                     ) : (
                        <button
                            onClick={() => handleScanWiki()}
                            disabled={isScanning}
                            className="bg-[#990000] text-white px-6 py-3 font-bold hover:bg-[#770000] disabled:opacity-50 flex items-center gap-2 self-start rounded-none shadow-sm"
                        >
                            <Radar size={18} />
                            {scanMode === 'search' ? 'Search & Scan' : 'Scan'}
                        </button>
                     )}
                </div>
                
                {error && <div className="text-red-700 bg-red-50 border border-red-300 p-3 mt-4 text-sm font-bold rounded-none">{error}</div>}
                
                {isScanning && (
                    <div className="text-center p-8 text-gray-500">
                        <Loader2 className="animate-spin inline-block mr-2 text-[#990000]" /> {scanMode === 'search' ? 'Searching & Scanning...' : 'Accessing Wiki...'}
                    </div>
                )}
                
                {discoveredEntries && (
                    <div className="mt-6">
                        <div className="flex justify-between items-start mb-4 flex-wrap gap-2">
                            <h3 className="font-ao3-serif text-xl">
                                Discovered <span className="font-bold text-[#990000]">{discoveredEntries.fandom}</span> Entries
                            </h3>
                             <div className="flex items-center gap-0 border border-gray-300 bg-gray-50 p-0 rounded-none overflow-hidden">
                                {['All', 'Character', 'World', 'Lore'].map(filter => (
                                    <button 
                                        key={filter}
                                        onClick={() => { setActiveScanFilter(filter); setCurrentPage(1); }}
                                        className={`px-3 py-1 font-bold text-xs rounded-none border-r border-gray-200 last:border-r-0 ${activeScanFilter === filter ? 'bg-[#990000] text-white' : 'text-gray-600 hover:bg-gray-200'}`}
                                    >
                                        {filter}
                                    </button>
                                ))}
                             </div>
                        </div>

                         {/* SCANNER MODIFIER FIELD */}
                        <div className="mb-4">
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1 flex items-center gap-1">
                                <Wand2 size={12} className="text-[#990000]"/> Apply Modifier to Selection
                            </label>
                            <input 
                                type="text"
                                value={scannerModifier}
                                onChange={(e) => setScannerModifier(e.target.value)}
                                placeholder="e.g. 'Make all selected characters Zombies', 'Set in a Cyberpunk AU'"
                                className="w-full p-2 border border-gray-300 bg-white focus:border-[#990000] outline-none font-ao3-sans text-sm text-gray-900 placeholder:text-gray-400 rounded-none shadow-inner"
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {currentEntries.map((item, i) => (
                                <div key={i} className="bg-white p-3 border border-gray-300 flex items-center group shadow-sm rounded-none hover:border-[#990000]">
                                    <button onClick={() => toggleSelection(item.name)} className="p-2 mr-2">
                                        {selectedForImport.has(item.name) ? <CheckSquare className="text-[#990000]" /> : <Square className="text-gray-400 group-hover:text-gray-600"/>}
                                    </button>
                                    <div className="flex-1">
                                        <div className="font-bold text-gray-900">{item.name}</div>
                                        <div className="text-xs text-gray-500 uppercase font-bold">{item.category}</div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {filteredDiscovered.length === 0 && !isScanning && (
                             <div className="text-center p-8 text-gray-500 italic">No entries found for this filter.</div>
                        )}

                        {/* Pagination & Bulk Import */}
                        <div className="flex justify-between items-center gap-4 mt-4 text-sm">
                             <button onClick={toggleSelectAllVisible} className="text-xs font-bold text-gray-500 hover:text-gray-800 p-2 hover:bg-gray-100 border border-transparent hover:border-gray-300 rounded-none">
                                Select/Deselect All Visible
                             </button>
                            {totalPages > 1 && (
                                <div className="flex justify-center items-center gap-0 border border-gray-300 rounded-none overflow-hidden">
                                    <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-2 disabled:opacity-30 hover:bg-gray-100 border-r border-gray-300"><ChevronLeft size={16}/></button>
                                    <span className="px-3 py-1 bg-gray-50 text-xs font-bold text-gray-600">Page {currentPage} of {totalPages}</span>
                                    <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="p-2 disabled:opacity-30 hover:bg-gray-100 border-l border-gray-300"><ChevronRight size={16}/></button>
                                </div>
                            )}
                             <button onClick={handleBulkAddFromScanner} disabled={selectedForImport.size === 0} className="bg-green-700 text-white font-bold text-sm px-4 py-2 rounded-none hover:bg-green-800 disabled:opacity-50 flex items-center gap-2 shadow-sm">
                                <ListPlus size={16}/> Import Selected ({selectedForImport.size})
                            </button>
                        </div>
                    </div>
                )}
            </div>
        )}
        
        {/* --- LIBRARY TAB --- */}
        {activeTab === 'library' && (
            <div className="p-6">
                 <div className="flex justify-between items-end mb-4 flex-wrap gap-4">
                     <h3 className="font-ao3-serif text-xl">Bookmarked Entries</h3>
                     
                     <div className="flex items-center gap-2 flex-1 justify-end min-w-[300px]">
                         {/* Category Filter */}
                         <div className="relative">
                             <Filter size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500"/>
                             <select 
                                value={libFilter}
                                onChange={(e) => { setLibFilter(e.target.value); setLibPage(1); }}
                                className="pl-7 pr-4 py-2 border border-gray-300 rounded-none bg-white text-xs font-bold text-gray-700 outline-none focus:border-[#990000] shadow-sm h-10"
                             >
                                 <option value="All">All Categories</option>
                                 <option value="Character">Characters</option>
                                 <option value="World">World/Locations</option>
                                 <option value="Lore">Lore</option>
                                 <option value="Facility">Facilities</option>
                                 <option value="Species">Species</option>
                                 <option value="Religion">Religions</option>
                                 <option value="Country">Countries</option>
                             </select>
                         </div>
                         
                         {/* Search */}
                         <div className="relative flex-1 max-w-xs">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input 
                                type="text" 
                                placeholder="Search library..."
                                value={libSearch}
                                onChange={(e) => { setLibSearch(e.target.value); setLibPage(1); }}
                                className="w-full pl-9 p-2 border border-gray-300 text-sm bg-white rounded-none focus:border-[#990000] outline-none shadow-sm h-10"
                            />
                            {libSearch && (
                                <button onClick={() => setLibSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                                    <X size={12}/>
                                </button>
                            )}
                         </div>
                     </div>
                 </div>

                 {library.length === 0 ? (
                     <p className="text-gray-500 italic">Your library is empty. Add entries from the list below to save them for later.</p>
                 ) : (
                    <>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {currentLibEntries.map(entry => (
                                 <div key={entry.id} className="bg-white p-3 border border-gray-300 flex justify-between items-center group shadow-sm rounded-none hover:border-[#990000]">
                                    <div>
                                        <div className="font-bold text-gray-900">{entry.name}</div>
                                        <div className="text-xs text-gray-500 uppercase font-bold">{entry.category}</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                         <button
                                            onClick={() => onRemoveFromLibrary(entry.id)}
                                            className="text-gray-400 hover:text-red-600 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                            title="Remove from Library"
                                        >
                                            <X size={14}/>
                                        </button>
                                        <button
                                            onClick={() => onImport(entry)}
                                            className="bg-gray-100 border border-gray-300 text-gray-700 px-3 py-1 text-sm font-bold hover:bg-gray-200 hover:text-black opacity-0 group-hover:opacity-100 transition-opacity rounded-none"
                                        >
                                            Import
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        
                        {filteredLibrary.length === 0 && (
                            <div className="text-center p-8 text-gray-400 italic">No entries match your search.</div>
                        )}
                        
                        {/* Library Pagination */}
                        {totalLibPages > 1 && (
                            <div className="flex justify-center items-center gap-0 border border-gray-300 rounded-none overflow-hidden mt-6 w-fit mx-auto shadow-sm">
                                <button onClick={() => setLibPage(p => Math.max(1, p - 1))} disabled={libPage === 1} className="p-2 disabled:opacity-30 hover:bg-gray-100 border-r border-gray-300"><ChevronLeft size={16}/></button>
                                <span className="px-3 py-1 bg-gray-50 text-xs font-bold text-gray-600">Page {libPage} of {totalLibPages}</span>
                                <button onClick={() => setLibPage(p => Math.min(totalLibPages, p + 1))} disabled={libPage === totalLibPages} className="p-2 disabled:opacity-30 hover:bg-gray-100 border-l border-gray-300"><ChevronRight size={16}/></button>
                            </div>
                        )}
                    </>
                 )}
            </div>
        )}
        
        {/* --- GENERATION QUEUE --- */}
        {queue.length > 0 && (
            <div className="border-t border-gray-300 bg-gray-50">
                <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-100">
                    <h3 className="font-bold text-gray-800 flex items-center gap-2 uppercase text-xs tracking-wide">
                        <Loader2 size={14} className={isQueueRunning ? "animate-spin text-[#990000]" : "text-gray-400"} />
                        Generation Queue ({queue.filter(q => q.status === 'completed').length}/{queue.length})
                    </h3>
                    <div className="flex gap-2">
                        {isQueueRunning ? (
                            <button onClick={() => setIsQueueRunning(false)} className="px-3 py-1 bg-white border border-gray-300 text-xs font-bold flex items-center gap-1 hover:bg-gray-100 rounded-none shadow-sm">
                                <Pause size={12}/> Pause
                            </button>
                        ) : (
                            <button onClick={() => setIsQueueRunning(true)} className="px-3 py-1 bg-[#990000] text-white border border-[#990000] text-xs font-bold flex items-center gap-1 hover:bg-[#770000] rounded-none shadow-sm">
                                <Play size={12}/> Start
                            </button>
                        )}
                        <button onClick={handleClearCompleted} className="px-3 py-1 bg-white border border-gray-300 text-xs font-bold flex items-center gap-1 hover:bg-gray-100 text-gray-500 rounded-none shadow-sm">
                            Clear Completed
                        </button>
                    </div>
                </div>
                
                <div className="max-h-60 overflow-y-auto">
                    {queue.map((item, idx) => (
                        <div 
                            key={item.id} 
                            className={`p-3 border-b border-gray-200 flex items-center gap-3 transition-colors ${item.status === 'generating' ? 'bg-blue-50' : item.status === 'failed' ? 'bg-red-50' : item.status === 'completed' ? 'bg-green-50 opacity-70' : 'bg-white'}`}
                            draggable={item.status === 'queued'}
                            onDragStart={(e) => onDragStartQueue(e, item.id)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => onDropQueue(e, item.id)}
                        >
                            <div className={`cursor-grab text-gray-300 hover:text-gray-500 ${item.status !== 'queued' ? 'invisible' : ''}`}>
                                <GripVertical size={14} />
                            </div>
                            
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="font-bold text-sm text-gray-800">{item.name || (item.mode === 'oc_prompt' ? "New OC (Pending...)" : item.input)}</span>
                                    <span className="text-[10px] uppercase font-bold px-1 border rounded-none text-gray-500 bg-white">{item.category}</span>
                                    {item.mode === 'oc_prompt' && <span className="text-[10px] uppercase font-bold px-1 border rounded-none text-purple-600 border-purple-200 bg-purple-50">OC</span>}
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                    {item.status === 'queued' && <span className="text-xs text-gray-500 flex items-center gap-1"><Clock size={10}/> Queued</span>}
                                    {item.status === 'generating' && <span className="text-xs text-blue-600 font-bold flex items-center gap-1"><Loader2 size={10} className="animate-spin"/> Generating...</span>}
                                    {item.status === 'completed' && <span className="text-xs text-green-700 font-bold flex items-center gap-1"><CheckCircle2 size={10}/> Completed</span>}
                                    {item.status === 'failed' && <span className="text-xs text-red-600 font-bold flex items-center gap-1"><AlertCircle size={10}/> Failed: {item.error}</span>}
                                    
                                    {item.modifier && <span className="text-[10px] text-gray-400 italic border-l border-gray-300 pl-2">Mod: {item.modifier.substring(0, 30)}...</span>}
                                </div>
                            </div>

                            <div className="flex items-center gap-1">
                                {item.status === 'failed' && (
                                    <button onClick={() => handleRetryItem(item.id)} className="p-1 text-blue-600 hover:bg-blue-100 rounded-none" title="Retry">
                                        <RefreshCw size={14}/>
                                    </button>
                                )}
                                <button onClick={() => handleRemoveFromQueue(item.id)} className="p-1 text-gray-400 hover:text-red-600 hover:bg-gray-100 rounded-none" title="Remove from Queue">
                                    <X size={14}/>
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )}
      </div>

      <div className="border border-gray-300 shadow-sm mt-6 rounded-none">
          <div className="p-4 bg-gray-50 border-b border-gray-300 flex justify-between items-center">
            <h3 className="font-ao3-serif text-xl text-gray-800">Current Simulation Entries</h3>
            <div className="flex gap-2">
                {onRestoreDefaults && (
                    <button onClick={onRestoreDefaults} className="text-xs text-gray-500 hover:underline flex items-center gap-1">
                        <RefreshCw size={12}/> Restore Defaults
                    </button>
                )}
                <HoldToDeleteButton 
                    onDelete={handleClearAllConfirm}
                    className="text-xs text-red-600 hover:bg-red-50 flex items-center gap-1 px-2 py-1 rounded-none border border-transparent hover:border-red-200 transition-colors"
                    label="Hold to Clear All"
                >
                    <Trash2 size={12}/> Clear All
                </HoldToDeleteButton>
            </div>
          </div>
          <div className="p-4 max-h-96 overflow-y-auto bg-gray-100">
            {existingEntries.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {existingEntries.map((entry, idx) => (
                  <div 
                    key={entry.id} 
                    draggable
                    onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', entry.id); 
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                        e.preventDefault();
                        const draggedId = e.dataTransfer.getData('text/plain');
                        if (onReorder && draggedId && draggedId !== entry.id) {
                            onReorder(draggedId, entry.id);
                        }
                    }}
                    className={`p-3 border rounded-none flex justify-between items-center group cursor-grab active:cursor-grabbing transition-colors shadow-sm ${entry.isSystem ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-300 hover:border-[#990000]'}`}
                  >
                    <div className="mr-2 text-gray-300 cursor-grab active:cursor-grabbing group-hover:text-gray-400">
                        <GripVertical size={14} />
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <p className="font-bold text-gray-900 truncate">{entry.name}</p>
                      <span className="text-xs text-gray-500 uppercase font-bold">{entry.fandom} / {entry.category}</span>
                    </div>
                    <div className="flex items-center gap-1 pl-2">
                      <button onClick={() => openEntry(entry)} className="p-1 text-gray-400 hover:text-gray-800"><Info size={14}/></button>
                      <button onClick={() => onRemoveEntry(entry.id)} className="p-1 text-gray-400 hover:text-red-600"><Trash2 size={14}/></button>
                      {!entry.isSystem && (
                         isBookmarked(entry.id) ? (
                                <button onClick={() => onRemoveFromLibrary(entry.id)} className="p-1 text-yellow-500" title="Remove from Library"><Bookmark size={14} fill="currentColor" /></button>
                           ) : (
                                <button onClick={() => onAddToLibrary(entry)} className="p-1 text-gray-400 hover:text-yellow-500" title="Add to Library"><Bookmark size={14}/></button>
                           )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center p-8 text-gray-500 italic font-ao3-serif">
                No entries added. Use the importer above to add characters and lore.
              </div>
            )}
          </div>
      </div>

      {/* Modal for viewing/editing entry */}
      {selectedEntry && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl rounded-none border border-gray-300">
             <div className="p-4 border-b border-[#990000] flex justify-between items-center bg-gray-50">
                <h3 className="font-ao3-serif text-lg font-bold text-[#990000]">{isEditing ? "Editing Entry" : selectedEntry.name}</h3>
                <button onClick={() => setSelectedEntry(null)} className="text-gray-500 hover:text-[#990000]"><X size={20}/></button>
             </div>
             
             <div className="flex-1 overflow-y-auto p-6 font-ao3-sans">
                {isEditing ? (
                  <>
                     {/* AI Modification Section inside Editor */}
                     <div className="mb-6 bg-gray-50 border border-gray-200 p-4 rounded-none">
                         <button 
                            onClick={() => setShowAiModify(!showAiModify)} 
                            className="text-xs font-bold uppercase text-gray-500 flex items-center gap-1 hover:text-[#990000]"
                         >
                            <Wand2 size={12}/> AI Modification (Magic Edit)
                         </button>
                         {showAiModify && (
                             <div className="mt-3">
                                 <textarea 
                                    className="w-full p-2 text-sm border border-gray-300 bg-white rounded-none outline-none focus:border-[#990000]"
                                    placeholder="e.g. 'Rewrite this to be a steampunk version', 'Make them a villain', 'Summarize history'"
                                    value={aiModifyPrompt}
                                    onChange={e => setAiModifyPrompt(e.target.value)}
                                    rows={2}
                                 />
                                 <div className="flex justify-end mt-2">
                                     <button 
                                        onClick={handleAiModifyEntry}
                                        disabled={isAiModifying || !aiModifyPrompt.trim()}
                                        className="bg-gray-800 text-white px-3 py-1 text-xs font-bold rounded-none hover:bg-gray-900 flex items-center gap-1 disabled:opacity-50"
                                     >
                                        {isAiModifying ? <Loader2 size={12} className="animate-spin"/> : <Wand2 size={12}/>}
                                        Auto-Modify Content
                                     </button>
                                 </div>
                             </div>
                         )}
                     </div>

                    <label className="block text-sm font-bold mb-1 text-gray-700">Name</label>
                    <input 
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full p-2 border border-gray-300 mb-4 bg-white text-gray-900 rounded-none focus:border-[#990000] outline-none"
                    />
                    <label className="block text-sm font-bold mb-1 text-gray-700">Content</label>
                    <textarea 
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full p-2 border border-gray-300 h-64 bg-white text-gray-900 rounded-none focus:border-[#990000] outline-none"
                    />
                  </>
                ) : (
                  <div className="prose max-w-none font-ao3-serif whitespace-pre-wrap text-gray-900 text-lg leading-relaxed">
                     <p>{selectedEntry.content}</p>
                  </div>
                )}
             </div>

             <div className="p-4 bg-gray-50 border-t border-gray-300 flex justify-between">
                <div>
                   {selectedEntry.sourceUrl && (
                      <a href={selectedEntry.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[#990000] hover:underline flex items-center gap-1 font-bold">
                          Source Link <ExternalLink size={12} />
                      </a>
                   )}
                </div>
                <div className="flex gap-2">
                    <button 
                        onClick={() => handleDeleteEntry()}
                        className="text-xs font-bold text-red-600 px-3 py-2 rounded-none hover:bg-red-50 border border-transparent hover:border-red-200"
                    >
                        DELETE
                    </button>
                    {isEditing ? (
                      <button 
                        onClick={handleSaveChanges} 
                        className="bg-green-700 text-white px-4 py-2 text-sm font-bold rounded-none flex items-center gap-1 hover:bg-green-800 shadow-sm"
                      >
                        <Save size={14}/> Save
                      </button>
                    ) : (
                      <button 
                        onClick={() => setIsEditing(true)} 
                        className="bg-gray-800 text-white px-4 py-2 text-sm font-bold rounded-none flex items-center gap-1 hover:bg-gray-900 shadow-sm"
                      >
                        <Edit2 size={14}/> Edit
                      </button>
                    )}
                </div>
             </div>
          </div>
        </div>
      )}
    </>
  );
};
