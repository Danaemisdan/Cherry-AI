import * as React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

// Function to parse the title and wrap the highlighted word in a span
const HighlightedTitle = ({ text }) => {
  const parts = text.split(/~/);
  return (
    <h2 className="text-4xl font-black tracking-tighter text-white sm:text-6xl">
      {parts.map((part, index) =>
        index === 1 ? (
          <span key={index} className="relative whitespace-nowrap">
            <span className="relative z-10">{part}</span>
            <svg
              aria-hidden="true"
              viewBox="0 0 418 42"
              className="absolute -bottom-4 left-0 h-auto w-full text-red-500 opacity-80"
              preserveAspectRatio="none"
            >
              <path
                d="M203.371.916c-26.013-2.078-76.686 1.98-114.243 8.919-37.556 6.939-78.622 17.103-122.256 28.703-43.633 11.6-4.984 14.306 43.123 7.021 48.107-7.285 93.638-16.096 146.446-17.742 52.808-1.646 105.706 5.429 158.649 14.13 52.943 8.701 105.886 19.342 158.826 29.483 52.94 10.141 52.94 10.141-11.41-19.043C371.18 14.363 322.753 5.488 281.339 2.143 239.925-1.201 203.371.916 203.371.916z"
                fill="currentColor"
              />
            </svg>
          </span>
        ) : (
          part
        ),
      )}
    </h2>
  );
};

export const IntegrationShowcase = React.forwardRef(
  ({ title, subtitle, illustrationSrc, illustrationAlt, integrations, className, onIntegrationClick, selectedIntegration }, ref) => {
    const containerVariants = {
      hidden: { opacity: 0 },
      visible: {
        opacity: 1,
        transition: {
          staggerChildren: 0.1,
        },
      },
    };

    const itemVariants = {
      hidden: { opacity: 0, y: 20 },
      visible: {
        opacity: 1,
        y: 0,
        transition: {
          duration: 0.5,
          ease: "easeOut",
        },
      },
    };

    return (
      <section ref={ref} className={cn('w-full py-16 sm:py-24', className)}>
        <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className={cn("grid grid-cols-1 items-start gap-x-12 gap-y-10", illustrationSrc ? "lg:grid-cols-2" : "lg:grid-cols-1")}>
            <div className={cn("text-left", !illustrationSrc && "max-w-2xl")}>
              <HighlightedTitle text={title} />
              <p className="mt-4 text-base text-zinc-400 sm:text-lg">
                {subtitle}
              </p>
            </div>
            {illustrationSrc && (
              <div className="flex items-center justify-center lg:justify-center">
                <img 
                  src={illustrationSrc} 
                  alt={illustrationAlt} 
                  className="w-64 h-64 object-contain opacity-80"
                />
              </div>
            )}
          </div>

          <motion.div
            className="mt-16 grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            {integrations.map((item) => (
              <motion.div 
                key={item.id} 
                variants={itemVariants} 
                onClick={() => onIntegrationClick?.(item.id)}
                className={cn(
                  "flex items-start space-x-6 p-8 rounded-[2rem] transition-all cursor-pointer border border-transparent hover:bg-zinc-900/50 hover:border-white/5",
                  selectedIntegration === item.id && "bg-zinc-900 border-white/10 shadow-2xl"
                )}
              >
                <div className="flex-shrink-0">
                  <div className="h-10 w-10 text-white flex items-center justify-center">
                    {typeof item.icon === 'function' ? (
                      <item.icon className="w-8 h-8" />
                    ) : (
                      <img 
                        src={item.iconSrc} 
                        alt={`${item.name} logo`} 
                        className="h-8 w-8 object-contain brightness-0 invert opacity-100" 
                      />
                    )}
                  </div>
                </div>
                <div>
                  <h3 className="text-base font-black text-white">{item.label || item.name}</h3>
                  <p className="mt-1 text-sm text-zinc-500 font-medium leading-relaxed">{item.description}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>
    );
  }
);

IntegrationShowcase.displayName = 'IntegrationShowcase';
