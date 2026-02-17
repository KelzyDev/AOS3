
import { useEffect, useRef } from 'react';

export const useModalAccessibility = (isOpen: boolean, onClose: () => void) => {
  const modalRef = useRef<HTMLDivElement>(null);

  // Effect 1: Handle Event Listeners (Escape key and Tab trapping)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !modalRef.current) return;

      const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
        'a[href], button, textarea, input, select'
      );
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey) { // Shift + Tab
        if (document.activeElement === firstElement) {
          lastElement.focus();
          event.preventDefault();
        }
      } else { // Tab
        if (document.activeElement === lastElement) {
          firstElement.focus();
          event.preventDefault();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    
    const currentModal = modalRef.current;
    currentModal?.addEventListener('keydown', trapFocus);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      currentModal?.removeEventListener('keydown', trapFocus);
    };
  }, [isOpen, onClose]);

  // Effect 2: Handle Initial Focus
  // We explicitly DO NOT include onClose here. We only want to set focus 
  // when the modal first opens, not when the parent component updates.
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        const currentModal = modalRef.current;
        const focusableElements = currentModal?.querySelectorAll<HTMLElement>('a[href], button, textarea, input, select');
        // Prefer focusing the first input/textarea if available, otherwise the first button
        const firstInput = currentModal?.querySelector<HTMLElement>('input, textarea, select');
        if (firstInput) {
             firstInput.focus();
        } else {
             focusableElements?.[0]?.focus();
        }
      }, 50); 
    }
  }, [isOpen]);

  return modalRef;
};
