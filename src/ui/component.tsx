import React from 'react';
import {Text,render,Box} from 'ink';

/*  custom component */
interface StatusBadgeProps{
  status:string;
  color:string;
}

const StatusBadge: React.FC<StatusBadgeProps> =({status,color})=>{
  return (
  <Box borderStyle="round" borderColor={color} paddingX={1}>
    <Text color={color} bold>
      [*] {status.toUpperCase()}
    </Text>
  </Box>
  );
};

/* Main app using the component*/
const App=()=>{
  return (
  <Box flexDirection="column" padding={1}>
    <Text bold>Agent Status:</Text>
    <Box marginTop={1} flexDirection="row" gap={2}>
      <StatusBadge status="planning" color="yellow"></StatusBadge>
      <StatusBadge status="acting" color="blue"></StatusBadge>
      <StatusBadge status="completed" color="green"></StatusBadge>
      <StatusBadge status="error" color="red"></StatusBadge>
    </Box>
  </Box>
  );
};

render(<App></App>)
