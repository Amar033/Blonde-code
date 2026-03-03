import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import terminalImage from 'terminal-image';
import { colors, icons } from '../design-system.js';
import fs from 'fs';

interface WelcomeScreenProps {
  onStart: (task: string) => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onStart }) => {
  const [task, setTask] = useState('');
  const [mascotImage, setMascotImage] = useState('');

  // Load mascot image on mount
  useEffect(() => {
    (async () => {
      try {
        // Put your salamander.png in src/ui/assets/
        const imageBuffer = fs.readFileSync('./src/ui/assets/blonde-mascot.png');
        const rendered = await terminalImage.buffer(imageBuffer, { 
          width: 20,  // Adjust size
          height: 10, 
        });
        setMascotImage(rendered);
      } catch (error) {
        console.error('Failed to load mascot:', error);
      }
    })();
  }, []);

  return (
    <Box flexDirection="column" height="100%">
      <Box
        borderStyle="single"
        borderColor={colors.border}
        paddingX={3}
        paddingY={1}
        flexDirection="row"
        justifyContent="space-between"
      >
        {/* Left: Welcome + Mascot */}
        <Box flexDirection="column">
          <Text bold>
            <Text color={colors.brand}>Blonde Agent</Text>
            <Text dimColor> v0.1.0</Text>
          </Text>
          <Text dimColor>Welcome back!</Text>
          
          {/* Display PNG mascot */}
          {mascotImage && (
            <Box marginTop={1}>
              <Text>{mascotImage}</Text>
            </Box>
          )}

          <Box marginTop={1}>
            <Text dimColor>
              Blonde Agent • Production AI Coding Assistant
            </Text>
          </Box>
        </Box>

        {/* Right: Tips */}
        <Box
          flexDirection="column"
          paddingLeft={4}
        >
          <Text bold color={colors.warning}>Tips for getting started</Text>
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>Ask Blonde to help with file analysis, code search,</Text>
            <Text dimColor>and automated tasks. Be as specific as you would</Text>
            <Text dimColor>with another engineer for the best results.</Text>
          </Box>

          <Box marginTop={2}>
            <Text bold dimColor>Recent activity</Text>
          </Box>
          <Box marginTop={0}>
            <Text dimColor>No recent activity</Text>
          </Box>
        </Box>
      </Box>

      {/* Input area */}
      <Box marginTop={2} paddingX={3}>
        <Box flexDirection="column" width="100%">
          <Text dimColor>{'>'} </Text>
          <TextInput 
            value={task} 
            onChange={setTask}
            onSubmit={() => {
              if (task.trim()) {
                onStart(task);
              }
            }}
            placeholder="What can I help you build today?"
          />
        </Box>
      </Box>

      {/* Examples */}
      <Box flexDirection="column" marginTop={2} paddingX={3}>
        <Text dimColor>Try asking:</Text>
        <Box flexDirection="column" marginTop={1}>
          <Text color={colors.textDim}>
            {icons.bullet} Read package.json and summarize dependencies
          </Text>
          <Text color={colors.textDim}>
            {icons.bullet} List all TypeScript files in src directory
          </Text>
          <Text color={colors.textDim}>
            {icons.bullet} Find all TODO comments in the codebase
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
