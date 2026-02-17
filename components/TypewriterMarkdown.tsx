
import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

export const TypewriterMarkdown = ({ content, onComplete }: { content: string, onComplete?: () => void }) => {
  const [displayLength, setDisplayLength] = useState(0);
  const SPEED = 10; // ms per chunk

  useEffect(() => {
    const interval = setInterval(() => {
      setDisplayLength(prev => {
        if (prev >= content.length) {
          clearInterval(interval);
          if (onComplete) onComplete();
          return content.length;
        }
        // Type faster if the text is long to avoid waiting too long
        const step = content.length > 500 ? 5 : 2; 
        return prev + step;
      });
    }, SPEED);

    return () => clearInterval(interval);
  }, [content, onComplete]);

  const textToRender = content.slice(0, displayLength);

  return (
    <div className="font-ao3-serif text-lg leading-relaxed text-gray-900 prose prose-p:my-4 prose-strong:text-gray-900 max-w-none">
       <ReactMarkdown>{textToRender}</ReactMarkdown>
       {displayLength < content.length && (
         <span className="inline-block w-2 h-5 bg-[#990000] ml-1 align-middle animate-pulse"></span>
       )}
    </div>
  );
};
