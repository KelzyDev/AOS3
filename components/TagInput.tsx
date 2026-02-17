
import React, { useState } from 'react';
import { X, Plus, Tag } from 'lucide-react';

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  label?: string;
  icon?: React.ReactNode;
  className?: string;
}

export const TagInput: React.FC<TagInputProps> = ({ tags, onChange, placeholder, label, icon, className }) => {
  const [input, setInput] = useState('');

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  };

  const addTag = () => {
    const trimmed = input.trim().replace(/,$/, '');
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
      setInput('');
    }
  };

  const removeTag = (index: number) => {
    onChange(tags.filter((_, i) => i !== index));
  };

  return (
    <div className={className}>
      {label && (
        <label className="block font-bold text-gray-700 mb-2 flex items-center gap-2">
          {icon}
          {label}
        </label>
      )}
      <div className="flex flex-wrap gap-2 p-2 border border-gray-300 bg-white min-h-[42px] focus-within:border-[#990000] transition-colors rounded-none shadow-inner">
        {tags.map((tag, i) => (
          <span key={i} className="bg-gray-100 text-gray-700 text-sm px-2 py-1 rounded-none flex items-center gap-1 border border-gray-300 group">
            <span className="font-ao3-sans">{tag}</span>
            <button 
              onClick={() => removeTag(i)} 
              className="text-gray-400 hover:text-[#990000] rounded-none p-0.5 transition-colors"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={addTag}
          placeholder={tags.length === 0 ? placeholder : ''}
          className="flex-1 outline-none text-sm min-w-[120px] bg-transparent font-ao3-sans text-gray-900 placeholder:text-gray-400 py-1"
        />
      </div>
      <p className="text-[10px] text-gray-500 mt-1 italic">Press Enter or comma to add tags.</p>
    </div>
  );
};
