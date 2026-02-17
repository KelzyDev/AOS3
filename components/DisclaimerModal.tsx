
import React from 'react';
import { AlertTriangle, PenTool, Heart, HandMetal } from 'lucide-react';

interface DisclaimerModalProps {
  onClose: () => void;
}

export const DisclaimerModal: React.FC<DisclaimerModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white max-w-lg w-full rounded-none shadow-2xl border border-gray-400 overflow-hidden relative">
        <div className="bg-[#990000] p-4 flex items-center gap-3 text-white border-b border-[#770000]">
          <AlertTriangle size={24} className="text-yellow-400" />
          <h2 className="font-ao3-serif text-xl font-bold">Creative Integrity Notice</h2>
        </div>
        
        <div className="p-6 space-y-5 font-ao3-sans text-gray-800">
          <div className="flex items-start gap-3">
             <div className="bg-red-50 p-2 rounded-full border border-red-100 flex-shrink-0">
                <HandMetal size={20} className="text-[#990000]"/>
             </div>
             <div>
                <h3 className="font-bold text-lg text-gray-900">This is a Game, Not a Writer.</h3>
                <p className="text-sm text-gray-600 mt-1 leading-relaxed">
                    <strong>Archive of Our Sims</strong> is designed as an entertainment simulation engine—a "What If?" machine for roleplay scenarios. It is <strong>NOT</strong> intended to write your fanfiction novels for you.
                </p>
             </div>
          </div>

          <div className="border-l-4 border-[#990000] bg-gray-50 p-4 text-sm text-gray-700 italic">
            <p className="font-bold mb-1 not-italic text-[#990000] uppercase text-xs tracking-wide">Warning</p>
            "Please do not use this tool to generate stories for publication. AI models lack the lived experience, intent, and soul that make art meaningful. Using AI to replace writing stifles creativity."
          </div>

          <div className="flex items-start gap-3">
             <div className="bg-blue-50 p-2 rounded-full border border-blue-100 flex-shrink-0">
                <PenTool size={20} className="text-blue-700"/>
             </div>
             <div>
                <h3 className="font-bold text-lg text-gray-900">Support Human Creation</h3>
                <p className="text-sm text-gray-600 mt-1 leading-relaxed">
                    We strongly encourage you to <strong>write your own stories</strong>. The joy of fandom comes from human expression. Support real creators on <a href="https://archiveofourown.org" target="_blank" rel="noopener noreferrer" className="text-[#990000] hover:underline font-bold">Archive of Our Own (AO3)</a>.
                </p>
             </div>
          </div>
          
          <div className="flex justify-center pt-4">
            <button 
              onClick={onClose}
              className="bg-gray-800 hover:bg-gray-900 text-white font-bold py-3 px-6 rounded-none flex items-center gap-2 transition-colors shadow-sm w-full justify-center sm:w-auto"
            >
              <Heart size={18} className="text-red-400" fill="currentColor" />
              <span>I Understand & Support Human Creativity</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
