import React from 'react';
import {render,Text,Box} from 'ink';

const App=()=>{
  return (
  <Box flexDirection="column" padding={1}>
    <Text>Border styles:</Text>
      <Box marginTop={1} borderStyle="single" padding={1}>
        <Text>Single line border</Text>
      </Box>
      <Box marginTop={1} borderStyle="double" padding={1}>
        <Text>Double line border</Text>
      </Box>
      <Box marginTop={1} borderStyle="round" padding={1}>
        <Text>Rounded Corners</Text>
      </Box>
      <Box marginTop={1} borderStyle="bold" padding={1}>
        <Text>Bold border</Text>
      </Box>

      <Box marginTop={1} borderStyle="double" borderColor="#FF1493" paddingX={2} paddingY={1}>
        <Text>Coloured Border Green</Text>
      </Box>

      <Box marginTop={1} borderStyle="double" borderColor="#FF1493" paddingX={2} paddingY={1}>
        <Text bold color="cyan">Styled box with custom color</Text>
      </Box>
  </Box>
  );
};

render(<App></App>);
