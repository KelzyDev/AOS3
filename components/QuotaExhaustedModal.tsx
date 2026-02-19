
import React from 'react';
import { X, ExternalLink, Download, LayoutDashboard, Leaf, Gamepad2, PenTool, Users, Dumbbell, Palette } from 'lucide-react';

interface QuotaExhaustedModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: () => void;
  onReturnToDashboard: () => void;
}

export const QuotaExhaustedModal: React.FC<QuotaExhaustedModalProps> = ({ isOpen, onClose, onExport, onReturnToDashboard }) => {
  if (!isOpen) return null;

  const activities: { icon: React.ReactNode; text: string }[] = [
    { icon: <Leaf size={18} className="text-green-600"/>, text: "Touch grass — step outside, stretch, breathe" },
    { icon: <Gamepad2 size={18} className="text-purple-600"/>, text: "Quick game — play some games at steam, epic, etc" },
    { icon: <PenTool size={18} className="text-[#990000]"/>, text: "Read AO3 — support creators & get inspiration" },
    { icon: <Users size={18} className="text-blue-600"/>, text: "Socialize — message a friend or hang out" },
    { icon: <Dumbbell size={18} className="text-orange-600"/>, text: "Exercise — do a quick workout or walk" },
    { icon: <Palette size={18} className="text-pink-600"/>, text: "Creative Hobby — draw, knit, or cook something" },
  ];

  return (
    <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white max-w-lg w-full rounded-none shadow-2xl overflow-hidden border border-gray-400">
        
        {/* Header */}
        <div className="bg-[#990000] p-6 border-b border-[#770000] flex justify-between items-start text-white">
          <div>
            <h2 className="font-ao3-serif text-2xl font-bold mb-1">Quota exhausted</h2>
            <p className="text-xs font-bold text-white/80 uppercase tracking-wide">Simulation Limit Reached</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white">
            <X size={24} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          <p className="font-ao3-serif text-gray-800 leading-relaxed mb-6 text-lg">
            You’ve reached your simulation limit for now. You can upgrade to continue instantly, or try any of these fun things while you wait to come back.
            <br/><br/>
            <span className="text-sm text-gray-500 italic">(We also recommend supporting real fan creators on AO3 — they make the worlds you love.)</span>
          </p>

          {/* Primary CTA */}
          <a 
            href="https://aistudio.google.com/app/plan_information" 
            target="_blank" 
            rel="noopener noreferrer"
            className="block w-full bg-[#990000] hover:bg-[#770000] text-white text-center font-bold py-3 px-4 rounded-none shadow-md transition-colors mb-6 flex items-center justify-center gap-2"
          >
            Upgrade Google AI Tier <ExternalLink size={16} />
          </a>

          {/* Suggested Activities */}
          <div className="bg-gray-50 border border-gray-200 rounded-none p-4 mb-6">
            <h3 className="text-xs font-bold text-gray-500 uppercase mb-3">While you wait...</h3>
            <div className="space-y-3">
              {activities.map((activity, idx) => (
                <div key={idx} className="flex items-center gap-3 text-sm text-gray-700">
                  {activity.icon}
                  <span>{activity.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Secondary CTAs */}
          <div className="grid grid-cols-2 gap-3">
             <button 
                onClick={onExport}
                className="flex items-center justify-center gap-2 px-3 py-2 border border-gray-300 rounded-none text-sm font-bold text-gray-600 hover:bg-gray-100 hover:text-gray-900"
             >
               <Download size={14} /> Export Session
             </button>
             <button 
                onClick={onReturnToDashboard}
                className="flex items-center justify-center gap-2 px-3 py-2 border border-gray-300 rounded-none text-sm font-bold text-gray-600 hover:bg-gray-100 hover:text-gray-900"
             >
               <LayoutDashboard size={14} /> Dashboard
             </button>
          </div>
          
          <div className="mt-3 text-center">
             <a href="https://archiveofourown.org/" target="_blank" rel="noopener noreferrer" className="text-xs text-[#990000] hover:underline inline-flex items-center gap-1 font-bold">
                Search AO3 (Open in new tab) <ExternalLink size={10} />
             </a>
          </div>

        </div>
      </div>
    </div>
  );
};
