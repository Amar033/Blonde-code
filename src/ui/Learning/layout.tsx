import React from 'react';
import {render, Text,Box} from 'ink';

const App=()=>{
  return (
  <Box flexDirection='column'>
    <Text bold> Understand flex in terminal</Text>
    
    {/*Row Layout*/}
    <Box marginTop = {1}>
      
        <Text>Row Layout:</Text>
        <Box flexDirection= "row" gap= {2}>
          <Text colour = "red">Red</Text>
          <Text colour = "green">Green</Text>
          <Text colour = "blue">Blue</Text>
        </Box>
    </Box>

    {/*column layout*/}
    <Box marginTop={1} flexDirection = "column">
      <Text>Column Layout</Text>
        <Box flexDirection="column">
          <Text colour="red">Red</Text>
          <Text colour="green">Green</Text>
          <Text colour="blue"></Text>
        </Box>
    </Box>
      
     {/*spacing*/} 
      <Box marginTop={2} padding={1} borderStyle="round">
        <Text>Box with padding and border</Text>
      </Box>

      {/*justify*/}
      <Box marginTop={1} justifyContent="space-between" width={40}>
        <Text>Left</Text>
        <Text>Center</Text>
        <Text>Right</Text>
      </Box>
  </Box>
  );
};

render(<App></App>);
