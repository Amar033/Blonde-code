import React, { useState, useEffect } from 'react';
import { Box, Text, useStdout } from 'ink';
import { colors } from '../design-system.js';

// Terminal size breakpoints
const BREAKPOINTS = {
  small: 40,   // Status bar only
  medium: 60,  // Compact header
  large: 80,   // Full header
};

// Header component that adapts to terminal size
interface HeaderProps {
  isAgentRunning: boolean;
  agentStatus: string;
  agentPlan?: { steps: string[]; currentStep?: number } | null;
  isFullscreen?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  isAgentRunning,
  agentStatus,
  agentPlan,
  isFullscreen = false,
}) => {
  const { stdout } = useStdout();
  const [width, setWidth] = useState(stdout?.columns || 80);
  
  useEffect(() => {
    const handleResize = () => {
      setWidth(stdout?.columns || 80);
    };
    
    if (stdout) {
      stdout.on('resize', handleResize);
      handleResize();
    }
    
    return () => {
      if (stdout) {
        stdout.off('resize', handleResize);
      }
    };
  }, [stdout]);
  
  const sizeCategory = width >= BREAKPOINTS.large ? 'large' 
    : width >= BREAKPOINTS.medium ? 'medium' 
    : 'small';
  
  // Full/expanded mode - show everything
  if (sizeCategory === 'large' || isFullscreen) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={isAgentRunning ? colors.warning : colors.border}
        paddingX={1}
        paddingY={0}
      >
        <Box>
          <Text bold color={colors.brand}>BLONDE</Text>
          <Text dimColor> / </Text>
          {isAgentRunning ? (
            <>
              <Text color={colors.thinking}>◐ Running</Text>
              <Text dimColor> ({agentStatus})</Text>
            </>
          ) : (
            <Text color={colors.success}>Ready</Text>
          )}
          <Text dimColor> {' │ '.padStart(width - 30)}</Text>
          <Text dimColor>Rows: {stdout?.rows || 0}</Text>
        </Box>
        
        {/* Show plan in large mode */}
        {agentPlan && isAgentRunning && (
          <Box marginTop={0} flexDirection="column">
            <Text dimColor>Plan: </Text>
            {agentPlan.steps.slice(0, 3).map((step, i) => (
              <Text key={i} dimColor>
                {i === agentPlan.currentStep ? '▸ ' : '· '}{step}
              </Text>
            ))}
            {agentPlan.steps.length > 3 && (
              <Text dimColor>... +{agentPlan.steps.length - 3} more</Text>
            )}
          </Box>
        )}
      </Box>
    );
  }
  
  // Medium mode - compact but with status
  if (sizeCategory === 'medium') {
    return (
      <Box
        borderStyle="round"
        borderColor={isAgentRunning ? colors.warning : colors.border}
        paddingX={1}
        paddingY={0}
      >
        <Text bold color={colors.brand}>BLONDE</Text>
        <Text dimColor> / </Text>
        {isAgentRunning ? (
          <>
            <Text color={colors.thinking}>◐ {agentStatus}</Text>
          </>
        ) : (
          <Text color={colors.success}>Ready</Text>
        )}
        <Text dimColor>{' '.repeat(Math.max(0, width - 20))}</Text>
      </Box>
    );
  }
  
  // Small mode - minimal status indicator
  return (
    <Box
      borderStyle="round"
      borderColor={isAgentRunning ? colors.warning : colors.border}
      paddingX={1}
      paddingY={0}
    >
      <Text bold color={colors.brand}>●</Text>
      <Text dimColor> </Text>
      <Text color={isAgentRunning ? colors.thinking : colors.success}>
        {isAgentRunning ? '●' : '○'}
      </Text>
    </Box>
  );
};

// Mascot component - owl eyes placeholder
export const Mascot: React.FC<{ size?: 'small' | 'medium' | 'large' }> = ({ size = 'medium' }) => {
  if (size === 'small') {
    return (
      <Text bold color={colors.brand}>🦉</Text>
    );
  }
  
  if (size === 'medium') {
    return (
      <Box flexDirection="column">
        <Text bold color={colors.brand}>  ___  </Text>
        <Text bold color={colors.brand}> ( o o) </Text>
        <Text bold color={colors.brand}> ( " )  </Text>
      </Box>
    );
  }
  
  // Large - detailed owl
  return (
    <Box flexDirection="column">
      <Text bold color={colors.brand}>      ______      </Text>
      <Text bold color={colors.brand}>     / o o \     </Text>
      <Text bold color={colors.brand}>    | ( " ) |    </Text>
      <Text bold color={colors.brand}>     \  ^  /     </Text>
      <Text bold color={colors.brand}>      \___/      </Text>
      <Text bold color={colors.brand}>      /   \      </Text>
      <Text bold color={colors.brand}>     /_____\     </Text>
    </Box>
  );
};

// Responsive wrapper that manages layout based on size
interface ResponsiveLayoutProps {
  children: React.ReactNode;
  showMascot?: boolean;
}

export const ResponsiveLayout: React.FC<ResponsiveLayoutProps> = ({
  children,
  showMascot = false,
}) => {
  const { stdout } = useStdout();
  const [dimensions, setDimensions] = useState({ width: 80, height: 24 });
  
  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        width: stdout?.columns || 80,
        height: stdout?.rows || 24,
      });
    };
    
    if (stdout) {
      stdout.on('resize', handleResize);
      handleResize();
    }
    
    return () => {
      if (stdout) {
        stdout.off('resize', handleResize);
      }
    };
  }, [stdout]);
  
  const sizeCategory = dimensions.width >= BREAKPOINTS.large ? 'large'
    : dimensions.width >= BREAKPOINTS.medium ? 'medium'
    : 'small';
  
  return (
    <Box flexDirection="column" width={dimensions.width} minHeight={dimensions.height}>
      {showMascot && sizeCategory !== 'small' && (
        <Box justifyContent="center" marginY={1}>
          <Mascot size={sizeCategory} />
        </Box>
      )}
      {children}
    </Box>
  );
};
