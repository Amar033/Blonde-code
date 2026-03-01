import React, {useState,useEffect }from 'react';
import {Text, render, Box} from 'ink';


const App=()=>{
  // state: data that changes overtime
  const [count, setCount]=useState(0);
  const [status, setStatus]=useState('waiting');

  // Effect 
  useEffect(()=>{
    const interval = setInterval(()=>{
      setCount(prev=>prev+1);
    }, 1000);

    // cleanup when component unmounts
    return ()=> clearInterval(interval);
  }, []);  // empty array = run once on mount 

  // status change based on count 
  useEffect(()=>{
    if(count<3){
      setStatus('waiting');
    }else if (count<6){
      setStatus('working');
    }else{
      setStatus('done');
    }
  }, [count]); // rerun when count changed

  return (
  <Box flexDirection="column" padding={1}>
    <Text bold> Real Time updates demo</Text>
    <Box marginTop={1}>
      <Text>
        Count:<Text color="cyan" bold>{count}</Text>
      </Text>
    </Box>
    <Box marginTop={1}>
      <Text>
        Count:<Text color="yellow" bold>{status}</Text>
      </Text>
    </Box>
    <Box marginTop={1} backgroundColor={status==='done'? 'green': 'black'} padding={1}>
      <Text color='white'>
        {status==='done'? 'Complete!': 'working'}      
      </Text>
    </Box>      
  </Box>
  );
};

render(<App></App>);
