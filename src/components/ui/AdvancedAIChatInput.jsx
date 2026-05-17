import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { 
  ArrowUp, 
  Mic, 
  Paperclip, 
  Plus, 
  Zap, 
  Sparkles, 
  Search, 
  Terminal,
  CornerDownLeft
} from 'lucide-react';
import { cn } from '../../lib/utils';

export function AdvancedAIChatInput({ value, onChange, onSendMessage, disabled, placeholder }) {
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef(null);

  const handleInput = (e) => {
    onChange(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSendMessage();
    }
  };

  const suggestions = [
    { label: "Find 25 founders", icon: Search, text: "Find 25 fintech founders, put them in a sheet, then message them one by one on LinkedIn" },
    { label: "Plan my outreach", icon: Sparkles, text: "Plan an outreach campaign for my new SaaS product targeting marketing agencies" },
    { label: "Check task logs", icon: Terminal, text: "Show me the logs for the last executed task" }
  ];

  return (
    <div className="w-full space-y-8">
      {/* Top Tags */}
      <div className="flex items-center gap-4 justify-start ml-2">
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-zinc-900 border border-zinc-800 shadow-2xl">
          <Zap className="w-4 h-4 text-red-500" />
          <span className="text-xs font-black text-zinc-100 uppercase tracking-widest">Auto-Routing</span>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-zinc-900 border border-zinc-800 shadow-2xl">
          <Sparkles className="w-4 h-4 text-blue-500" />
          <span className="text-xs font-black text-zinc-100 uppercase tracking-widest">Smart Planning</span>
        </div>
      </div>

      {/* Main Input Area */}
      <div className={cn(
        "relative bg-[#09090b] border border-zinc-800 rounded-[3rem] p-6 transition-all duration-500 shadow-[0_30px_100px_rgba(0,0,0,0.5)]",
        isFocused ? "border-zinc-500 ring-8 ring-white/5" : ""
      )}>
        <div className="flex items-end gap-6">
          <button className="flex items-center justify-center w-9 h-9 rounded-xl hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors">
            <Paperclip className="w-5 h-5" />
          </button>
          
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={placeholder || "How can Cherry help you today?"}
            className="flex-1 min-h-[36px] max-h-[300px] py-1.5 bg-transparent border-none focus:ring-0 resize-none text-[15px] text-zinc-100 placeholder:text-zinc-500 outline-none font-medium leading-relaxed"
          />

          <div className="flex items-center gap-1 px-1 pb-1">
            <button className="flex items-center justify-center w-10 h-10 rounded-xl hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors">
              <Mic className="w-5 h-5" />
            </button>
            <AnimatePresence mode="wait">
              <motion.button
                initial={false}
                animate={{ 
                  backgroundColor: value.trim() ? "#fafafa" : "transparent",
                  color: value.trim() ? "#09090b" : "#a1a1aa"
                }}
                onClick={onSendMessage}
                disabled={disabled || !value.trim()}
                className={cn(
                  "flex items-center justify-center w-10 h-10 rounded-full transition-all active:scale-95",
                  !value.trim() && "hover:bg-zinc-800"
                )}
              >
                <ArrowUp className="w-5 h-5" strokeWidth={2.5} />
              </motion.button>
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Bottom Action Buttons */}
      <div className="flex flex-wrap items-center gap-2 pb-2">
        {suggestions.map((suggestion, idx) => (
          <button 
            key={idx}
            onClick={() => onChange(suggestion.text)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-400 text-[11px] font-bold hover:bg-zinc-900 hover:text-zinc-100 transition-all shadow-sm active:scale-95 whitespace-nowrap"
          >
            <suggestion.icon className="w-4 h-4" />
            {suggestion.label}
          </button>
        ))}
      </div>
    </div>
  );
}
