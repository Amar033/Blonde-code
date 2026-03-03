import React from 'react';
import {render, Text,Box} from 'ink';


const App =()=>{
  return (
  <Box flexDirection= 'column'>
    <Text>Normal Text</Text>
      <Text color="green">Text green</Text>
      <Text color="red">Red text</Text>
      <Text color="#FF1493">Hex colour hot pink </Text>

      <Text bold>Bold</Text>
      <Text italic>Italic</Text>
      <Text underline> underlined</Text>
      <Text dimColor>Thinking...</Text>

      <Text color = "blue" bold>Blue and bold</Text>
  </Box>
  );
};

render(<App></App>)
